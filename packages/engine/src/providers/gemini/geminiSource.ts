import { createHash } from 'node:crypto';
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { RawSessionInfo, SessionSource } from '../../claude/sessionSource.ts';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { geminiMessages, geminiTool, promptText } from './geminiMessages.ts';
import { isIgnoredPrompt, parseConversation, type GeminiConversation } from './geminiRecords.ts';

/** The folder Gemini CLI keeps everything in, inside its home. */
export const GEMINI_DIR = '.gemini';

/**
 * Gemini CLI's own folder: `$GEMINI_CLI_HOME/.gemini`, else `~/.gemini`. `GEMINI_CLI_HOME` stands in for the user's
 * home folder (Gemini puts its `.gemini` inside it), unlike `CODEX_HOME`, which is Codex's folder itself.
 */
export function geminiHome(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.GEMINI_CLI_HOME || home, GEMINI_DIR);
}

/**
 * Where a profile's folder keeps Gemini's files: the folder itself when it is a `.gemini` (the default), else the
 * `.gemini` inside it (a profile folder of its own is Gemini's home).
 */
export const geminiDataDir = (profileHome: string): string => (basename(profileHome) === GEMINI_DIR ? profileHome : join(profileHome, GEMINI_DIR));

/**
 * The `GEMINI_CLI_HOME` that makes Gemini CLI use a profile's folder; null for `~/.gemini` itself, which it uses
 * without one (as the built-in Claude profile gets no `CLAUDE_CONFIG_DIR`).
 */
export function geminiCliHome(profileHome: string, userHome: string): string | null {
  const home = basename(profileHome) === GEMINI_DIR ? dirname(profileHome) : profileHome;
  return home === userHome ? null : home;
}

/** A session id as Gemini CLI makes them (a UUID). */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A session's file in a project's `chats` folder: `session-<YYYY-MM-DDTHH-MM>-<first 8 of its id>.jsonl` (`.json` before 0.4x). */
export const SESSION_FILE = /^session-[0-9A-Za-z-]+\.jsonl?$/;

/** A changed file in Gemini's `tmp` folder (relative to it) that is a session's file. */
const CHANGED_FILE = /^([^\\/]+)[\\/]chats[\\/](session-[0-9A-Za-z-]+\.jsonl?)$/;

/** How much of a file's start holds its id: the header line, or an older `.json`'s first key. */
const HEAD_BYTES = 4096;

function readHead(path: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** The session id a file names in its header; null for one that isn't a session's (a subagent's) or can't be read. */
function headerId(path: string): string | null {
  const head = readHead(path);
  const id = /"sessionId"\s*:\s*"([^"]+)"/.exec(head)?.[1];
  if (!id || !SESSION_ID.test(id)) return null;
  // A subagent's file says so in its header (they are kept in their own folders, but say so in case one isn't).
  if (/"kind"\s*:\s*"subagent"/.test(head.split('\n')[0] ?? '')) return null;
  return id;
}

const time = (value: string | undefined | null): number | undefined => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * The folder of each of Gemini's project folders (`tmp/<project>`). Gemini names a project's folder after the folder's
 * name and writes the path in its `.project_root`, and lists them in `projects.json`; older versions named it by a
 * SHA-256 of the path, which is matched against the paths `projects.json` lists. Unknown: left out.
 */
function projectRoots(dataDir: string, projects: readonly string[]): Map<string, string> {
  const roots = new Map<string, string>();
  let known: Record<string, string> = {};
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')) as { projects?: Record<string, string> };
    known = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {};
  } catch {}
  const bySlug = new Map(Object.entries(known).map(([path, slug]) => [slug, path]));
  const byHash = new Map(Object.keys(known).map((path) => [createHash('sha256').update(path).digest('hex'), path]));
  for (const project of projects) {
    let root: string | undefined;
    try {
      root = readFileSync(join(dataDir, 'tmp', project, '.project_root'), 'utf8').trim() || undefined;
    } catch {}
    root ??= bySlug.get(project) ?? byHash.get(project);
    if (root) roots.set(project, root);
  }
  return roots;
}

export interface GeminiSessionFiles {
  /** Every session's file by its id; where both an older `.json` and the `.jsonl` Gemini moved it to are there, the `.jsonl`. */
  files(): Map<string, string>;
  /** The session a changed file (relative to `tmp`) is, and its file. */
  sessionOf(relativePath: string): { sessionId: string; file: string } | null;
  /** A session's file, looked for again when it isn't known yet (a session just started). */
  fileOf(sessionId: string): string | undefined;
}

/**
 * Finds Gemini CLI's session files: `<.gemini>/tmp/<project>/chats/session-*.jsonl`, one per session, not the subagents'
 * (`chats/<parent id>/<id>.jsonl`). A file's name has only the first 8 characters of its id, so the id comes from its
 * header line, read once per file.
 */
export function geminiSessionFiles(dataDir: string): GeminiSessionFiles {
  const tmp = join(dataDir, 'tmp');
  const ids = new Map<string, string | null>();
  const idOf = (path: string): string | null => {
    if (!ids.has(path)) ids.set(path, headerId(path));
    return ids.get(path) ?? null;
  };
  /** The last scan's files, by session id. */
  let known = new Map<string, string>();
  const files = () => {
    const found = new Map<string, string>();
    let projects: string[];
    try {
      projects = readdirSync(tmp);
    } catch {
      return found;
    }
    const seen = new Set<string>();
    for (const project of projects) {
      const chats = join(tmp, project, 'chats');
      let names: string[];
      try {
        names = readdirSync(chats);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!SESSION_FILE.test(name)) continue;
        const path = join(chats, name);
        seen.add(path);
        if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue;
        const id = idOf(path);
        if (!id) continue;
        const other = found.get(id);
        if (!other || (other.endsWith('.json') && path.endsWith('.jsonl'))) found.set(id, path);
      }
    }
    for (const path of ids.keys()) if (!seen.has(path)) ids.delete(path);
    known = found;
    return new Map(found);
  };
  return {
    files,
    sessionOf(relativePath) {
      const match = CHANGED_FILE.exec(relativePath);
      if (!match) return null;
      const path = join(tmp, match[1]!, 'chats', match[2]!);
      // A new file's header may not be written yet: asked again on its next change.
      if (ids.get(path) === null) ids.delete(path);
      const id = idOf(path);
      if (!id) return null;
      // An older `.json` that Gemini moved to a `.jsonl` stands for nothing: the `.jsonl` does.
      const file = path.endsWith('.json') && statSync(`${path}l`, { throwIfNoEntry: false })?.isFile() ? `${path}l` : path;
      known.set(id, file);
      return { sessionId: id, file };
    },
    fileOf(sessionId) {
      const path = known.get(sessionId);
      // Gemini moves an older `.json` to a `.jsonl` when it continues the session.
      if (path?.endsWith('.json') && statSync(`${path}l`, { throwIfNoEntry: false })?.isFile()) return `${path}l`;
      if (path && statSync(path, { throwIfNoEntry: false })?.isFile()) return path;
      files();
      return known.get(sessionId);
    },
  };
}

/** The first prompt you wrote in a session (not the context Gemini CLI adds, a slash command or `?`). */
function firstPromptOf(conversation: GeminiConversation): string | undefined {
  for (const message of conversation.messages) {
    if (message.type !== 'user') continue;
    const text = promptText(message);
    if (!isIgnoredPrompt(text)) return text;
  }
  return undefined;
}

/** When the session last did something: its last prompt or reply, else when Gemini last updated it. */
function lastActive(conversation: GeminiConversation): number | undefined {
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const message = conversation.messages[i]!;
    if (message.type !== 'user' && message.type !== 'gemini') continue;
    const at = time(message.timestamp);
    if (at !== undefined) return at;
  }
  return time(conversation.lastUpdated);
}

export type GeminiSource = SessionSource & {
  files: GeminiSessionFiles;
  /** A session as Gemini CLI would load it; null when it isn't there. */
  conversation(sessionId: string): Promise<GeminiConversation | null>;
  /** A subagent's own conversation, by the tool call that started it (its `chats/<session>/<agent>.jsonl`). */
  subagent(sessionId: string, toolUseId: string): Promise<{ agentType: string | null; messages: RawSessionMessage[] }>;
};

/**
 * Reads Gemini CLI's sessions, read-only, from its files (Gemini has no API that lists or reads them): the list, each
 * session's title (Gemini's `summary`, else the first prompt) and folder (its project's `.project_root`), and the
 * conversation. Only sessions with a prompt are listed: Gemini writes a file as soon as a session starts, even one that
 * never gets a prompt (or failed to start). A field that's missing or changed leaves the session with less, never an
 * error.
 */
export function geminiSessionSource(dataDir: string): GeminiSource {
  const files = geminiSessionFiles(dataDir);
  const tmp = join(dataDir, 'tmp');
  // Parsing a file is the cost of a scan: kept per session until its file changes.
  const cache = new Map<string, { path: string; mtime: number; size: number; info: RawSessionInfo | null }>();
  let roots: { at: number; map: Map<string, string> } | null = null;
  /** The project folders, read again at most every few seconds (a scan asks for each session's). */
  const rootOf = (project: string): string | undefined => {
    if (!roots || Date.now() - roots.at > 5000 || !roots.map.has(project)) {
      let projects: string[] = [];
      try {
        projects = readdirSync(tmp);
      } catch {}
      roots = { at: Date.now(), map: projectRoots(dataDir, projects) };
    }
    return roots.map.get(project);
  };

  const read = async (path: string): Promise<GeminiConversation | null> => {
    try {
      return parseConversation(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };

  const conversation = async (sessionId: string): Promise<GeminiConversation | null> => {
    if (!SESSION_ID.test(sessionId)) return null;
    const path = files.fileOf(sessionId);
    return path ? read(path) : null;
  };

  const info = async (sessionId: string): Promise<RawSessionInfo | undefined> => {
    if (!SESSION_ID.test(sessionId)) return undefined;
    const path = files.fileOf(sessionId);
    const stat = path ? statSync(path, { throwIfNoEntry: false }) : undefined;
    if (!path || !stat?.isFile()) {
      cache.delete(sessionId);
      return undefined;
    }
    const cached = cache.get(sessionId);
    if (cached && cached.path === path && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.info ?? undefined;
    const record = await read(path);
    const firstPrompt = record && record.sessionId === sessionId && record.kind !== 'subagent' ? firstPromptOf(record) : undefined;
    let result: RawSessionInfo | null = null;
    if (record && firstPrompt) {
      const project = basename(dirname(dirname(path)));
      const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
      result = {
        sessionId,
        summary: summary || firstPrompt,
        firstPrompt,
        lastModified: lastActive(record) ?? Math.round(stat.mtimeMs),
        fileSize: stat.size,
        provider: 'gemini',
        // Gemini records nothing about what started a session (its CLI, an editor over ACP, Seshboard).
        origin: 'unknown',
      };
      const cwd = rootOf(project) ?? record.directories?.find((d) => typeof d === 'string');
      if (cwd) result.cwd = cwd;
      const createdAt = time(record.startTime);
      if (createdAt !== undefined) result.createdAt = createdAt;
    }
    cache.set(sessionId, { path, mtime: stat.mtimeMs, size: stat.size, info: result });
    return result ?? undefined;
  };

  return {
    files,
    conversation,
    info,
    async list() {
      const all = files.files();
      for (const id of cache.keys()) if (!all.has(id)) cache.delete(id);
      const infos = await Promise.all([...all.keys()].map((id) => info(id).catch(() => undefined)));
      return infos.filter((i): i is RawSessionInfo => !!i);
    },
    async messages(sessionId) {
      return geminiMessages(await conversation(sessionId));
    },
    async subagent(sessionId, toolUseId) {
      const record = await conversation(sessionId);
      const call = record?.messages.flatMap((m) => m.toolCalls ?? []).find((c) => c.id === toolUseId);
      const path = files.fileOf(sessionId);
      if (!call || !path) return { agentType: null, messages: [] };
      const tool = geminiTool(call.name, call.args, call.agentId);
      const agentType = typeof tool.input.subagent_type === 'string' ? tool.input.subagent_type : (call.displayName ?? null);
      if (!call.agentId) return { agentType, messages: [] };
      const folder = join(dirname(path), sessionId);
      let file: string | undefined = join(folder, `${call.agentId}.jsonl`);
      if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
        // Named otherwise: the one whose header has the agent's id.
        let names: string[] = [];
        try {
          names = readdirSync(folder).filter((n) => n.endsWith('.jsonl'));
        } catch {}
        file = names.map((n) => join(folder, n)).find((p) => new RegExp(`"sessionId"\\s*:\\s*"${call.agentId!.replace(/[^0-9A-Za-z_-]/g, '')}"`).test(readHead(p)));
      }
      return { agentType, messages: file ? geminiMessages(await read(file)) : [] };
    },
  };
}
