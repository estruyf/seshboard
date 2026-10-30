import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionOrigin } from '@seshboard/protocol';
import type { RawSessionInfo, SessionSource } from '../../claude/sessionSource.ts';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { ACTIVITY_EVENTS, copilotMessages, parseEvents, userText, type CopilotEvent } from './copilotEvents.ts';
import { parseWorkspaceYaml } from './workspaceYaml.ts';

/** Copilot CLI's data folder: `$COPILOT_HOME`, else `~/.copilot`. */
export function copilotHome(env: NodeJS.ProcessEnv, home: string): string {
  return env.COPILOT_HOME || join(home, '.copilot');
}

/** Where Copilot CLI keeps its sessions, one folder each. */
export const copilotSessionsDir = (copilotHomeDir: string) => join(copilotHomeDir, 'session-state');

/** A session's events, the file the index watches and reads. */
export const EVENTS_FILE = 'events.jsonl';

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How much of the start of `events.jsonl` is read for the folder and the first prompt (a long system prompt comes first). */
const HEAD_BYTES = 256 * 1024;
/** How much of the end is read for the last activity. */
const TAIL_BYTES = 64 * 1024;

/** Copilot's `client_name` → where the session was started. */
function originOf(client: string | undefined): SessionOrigin {
  if (client === 'github/cli') return 'cli';
  if (client === 'vscode') return 'ide';
  return 'unknown';
}

function readRange(path: string, start: number, length: number): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** The whole lines in a slice of the file (the first and last may be cut). */
function eventsIn(text: string, cutStart: boolean): CopilotEvent[] {
  const lines = text.split('\n');
  if (cutStart) lines.shift();
  return parseEvents(lines.join('\n'));
}

const time = (value: string | undefined | null): number | undefined => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Reads GitHub Copilot CLI's sessions, read-only, from `<COPILOT_HOME>/session-state/<id>/`: `workspace.yaml` for the
 * title, folder and branch, `events.jsonl` for the conversation. The Copilot SDK can list sessions, but only reads one
 * by resuming it in a runtime (which writes to it, and clashes with a terminal that has it open), so the files are
 * read directly. Both are undocumented: a field that's missing or changed leaves the session with less, never an error.
 * Only sessions with an `events.jsonl` and a prompt are listed (the Copilot desktop app keeps others there too).
 */
export function copilotSessionSource(sessionsDir: string): SessionSource & { eventsPath(sessionId: string): string } {
  // Reading heads and tails is the cost of a scan: kept per session until its events change.
  const cache = new Map<string, { mtime: number; size: number; yamlMtime: number; info: RawSessionInfo }>();
  const eventsPath = (id: string) => join(sessionsDir, id, EVENTS_FILE);

  const info = async (sessionId: string): Promise<RawSessionInfo | undefined> => {
    if (!SESSION_ID.test(sessionId)) return undefined;
    const path = eventsPath(sessionId);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      cache.delete(sessionId);
      return undefined;
    }
    const yamlPath = join(sessionsDir, sessionId, 'workspace.yaml');
    const yamlMtime = statSync(yamlPath, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    const cached = cache.get(sessionId);
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size && cached.yamlMtime === yamlMtime) return cached.info;

    let yaml: Record<string, string> = {};
    try {
      yaml = parseWorkspaceYaml(readFileSync(yamlPath, 'utf8'));
    } catch {
      // Older sessions have no workspace.yaml: the events have the folder and the first prompt.
    }
    const head = eventsIn(readRange(path, 0, Math.min(stat.size, HEAD_BYTES)), false);
    const start = head.find((e) => e.type === 'session.start')?.data ?? {};
    const context = (start.context ?? {}) as Record<string, unknown>;
    const firstUser = head.find((e) => e.type === 'user.message' && !(e.data as { parentToolCallId?: unknown } | undefined)?.parentToolCallId);
    const firstPrompt = typeof firstUser?.data?.content === 'string' ? userText(firstUser.data.content) : undefined;
    const tail = stat.size > TAIL_BYTES ? eventsIn(readRange(path, stat.size - TAIL_BYTES, TAIL_BYTES), true) : head;
    const lastActive = [...tail].reverse().find((e) => ACTIVITY_EVENTS.has(e.type) && time(e.timestamp) !== undefined);

    const name = yaml.name?.trim();
    const summary = yaml.summary?.trim();
    // Nothing asked yet (a session just started, or one Copilot opened for itself): it shows up with its first prompt.
    if (!name && !summary && !firstPrompt) {
      cache.delete(sessionId);
      return undefined;
    }
    const result: RawSessionInfo = {
      sessionId,
      summary: name || summary || firstPrompt || '',
      ...(name && yaml.user_named === 'true' ? { customTitle: name } : {}),
      ...(firstPrompt ? { firstPrompt } : {}),
      lastModified: time(lastActive?.timestamp) ?? time(yaml.updated_at) ?? Math.round(stat.mtimeMs),
      fileSize: stat.size,
      cwd: yaml.cwd || (typeof context.cwd === 'string' ? context.cwd : undefined),
      gitBranch: yaml.branch || (typeof context.branch === 'string' ? context.branch : undefined),
      createdAt: time(yaml.created_at) ?? time(typeof start.startTime === 'string' ? start.startTime : undefined),
      provider: 'copilot',
      origin: originOf(yaml.client_name),
    };
    for (const key of Object.keys(result) as Array<keyof RawSessionInfo>) if (result[key] === undefined) delete result[key];
    cache.set(sessionId, { mtime: stat.mtimeMs, size: stat.size, yamlMtime, info: result });
    return result;
  };

  return {
    eventsPath,
    async list() {
      let names: string[];
      try {
        names = readdirSync(sessionsDir);
      } catch {
        return [];
      }
      const known = new Set(names);
      for (const id of cache.keys()) if (!known.has(id)) cache.delete(id);
      const infos = await Promise.all(names.filter((n) => SESSION_ID.test(n)).map((id) => info(id).catch(() => undefined)));
      return infos.filter((i): i is RawSessionInfo => !!i);
    },
    info,
    async messages(sessionId: string): Promise<RawSessionMessage[]> {
      if (!SESSION_ID.test(sessionId)) return [];
      let text: string;
      try {
        text = await readFile(eventsPath(sessionId), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      return copilotMessages(parseEvents(text));
    },
  };
}
