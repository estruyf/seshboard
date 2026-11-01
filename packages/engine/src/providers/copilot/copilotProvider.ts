import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderAdapter } from '../provider.ts';
import { findCopilot } from './copilotBinary.ts';
import { forkBoundary } from './copilotActions.ts';
import { copilotSubagent } from './copilotEvents.ts';
import { copilotDriver, type CreateCopilotClient } from './copilotDriver.ts';
import { isAlive, liveStatusOf, lockPids, openSessions, tailEvents } from './copilotInUse.ts';
import { copilotSessionsDir, copilotSessionSource, EVENTS_FILE, SESSION_ID } from './copilotSource.ts';

/** Continues a session in Copilot CLI. */
export const COPILOT_RESUME = 'copilot --resume={sessionId}';

/** Installs Copilot CLI (GitHub's own instructions; it needs Node). */
export const COPILOT_INSTALL = 'npm install -g @github/copilot';

/** A file in a session's folder that changes what the sidebar shows: its events, or its title and folder. */
const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/](?:events\.jsonl|workspace\.yaml)$/i;

export interface CopilotProviderOptions {
  /** The Copilot profile this is (Settings › Profiles). */
  profileId: string;
  /** The profile's `COPILOT_HOME`: its config, login and sessions. */
  copilotHome: string;
  /** The user's home folder, where Copilot CLI's installer puts it. */
  userHome: string;
  /** The login shell's environment, for finding and running `copilot`. Without it, the process's own. */
  shellEnv?: () => Promise<Record<string, string | undefined>>;
  createClient?: CreateCopilotClient;
  /** Where `copilot` is (tests); found on PATH and in the usual places otherwise. */
  binary?: () => Promise<{ path: string; version: string | null } | null>;
}

/**
 * One GitHub Copilot profile: one folder per session under `<COPILOT_HOME>/session-state`, read from disk, and run
 * through the Copilot SDK with the user's own `copilot` and the profile's own login (its `COPILOT_HOME`). While its
 * runtime runs, conversations are read and open sessions found through Copilot's own API, with the files as the
 * fallback. Forking and renaming go through Copilot too.
 */
export function copilotProvider({ profileId, copilotHome, userHome, shellEnv = async () => process.env, createClient, binary }: CopilotProviderOptions): ProviderAdapter {
  const dir = copilotSessionsDir(copilotHome);
  const eventsOf = (id: string) => join(dir, id, EVENTS_FILE);
  const driver = copilotDriver({
    // Looked up each time until found: installing Copilot CLI works without restarting Seshboard.
    binary: binary ?? (async () => findCopilot(await shellEnv(), userHome)),
    // The profile's Copilot home: its login, and the folder read here, so what it writes is what the sidebar reads.
    env: async () => ({ ...(await shellEnv()), COPILOT_HOME: copilotHome }),
    ...(createClient ? { createClient } : {}),
  });
  /** Seshboard's own `copilot`: its locks don't mean the session is open elsewhere. */
  const own = () => new Set([driver.runtimePid()].filter((pid): pid is number => pid !== null));
  /** The process of another app that has a session open, from its locks (Copilot's answer has no process). */
  const holder = (sessionId: string) => lockPids(join(dir, sessionId)).find((pid) => !own().has(pid) && isAlive(pid));
  /** Which sessions another app has open: Copilot's answer while its runtime runs, else the lock files. */
  const openElsewhere = async (sessionIds: readonly string[]): Promise<Set<string>> => {
    const ids = sessionIds.filter((id) => SESSION_ID.test(id));
    const asked = await driver.inUse(ids).catch(() => null);
    return asked ?? new Set(ids.filter((id) => holder(id) !== undefined));
  };
  const source = copilotSessionSource(dir, { readEvents: (id) => driver.readEvents(id) });
  return {
    id: 'copilot',
    profileId,
    home: copilotHome,
    folder: dir,
    source: {
      ...source,
      // Copilot keeps the events before the boundary, so the fork ends just after the message (and its tools' results).
      async fork(sessionId, upToMessageId) {
        const boundary = forkBoundary(await source.events(sessionId), upToMessageId);
        if (boundary === undefined) throw new Error('That message is not in this session');
        return driver.fork(sessionId, boundary);
      },
      // Not running here: resumed just for the new name, which Copilot CLI shows too.
      async rename(sessionId, title) {
        const cwd = (await source.info(sessionId))?.cwd;
        if (!cwd) throw new Error('Unknown session, or its folder is not recorded');
        if ((await openElsewhere([sessionId])).has(sessionId)) throw new Error('This session is open in Copilot CLI right now. Rename it there, or close it first.');
        await driver.renameSession(sessionId, cwd, title);
      },
    },
    resumeCommand: COPILOT_RESUME,
    signInCommand: 'copilot login',
    driver,
    inUse: async (sessionId) => (await openElsewhere([sessionId])).has(sessionId),
    async live(sessionIds) {
      const asked = await driver.inUse(sessionIds.filter((id) => SESSION_ID.test(id))).catch(() => null);
      if (!asked) return openSessions(dir, sessionIds.filter((id) => SESSION_ID.test(id)), own());
      return [...asked].map((sessionId) => {
        const { events, updatedAt } = tailEvents(join(dir, sessionId, EVENTS_FILE));
        return { sessionId, pid: holder(sessionId) ?? 0, status: liveStatusOf(events), updatedAt };
      });
    },
    subagent: async (sessionId, toolUseId) => copilotSubagent(await source.events(sessionId), toolUseId),
    // The session's whole folder: its events, workspace.yaml and Copilot's file-change captures.
    trashPaths: (sessionId) => (SESSION_ID.test(sessionId) ? [join(dir, sessionId)] : []),
    files: {
      sessionOf(relativePath) {
        const match = SESSION_FILE.exec(relativePath);
        return match ? { sessionId: match[1]!, file: eventsOf(match[1]!) } : null;
      },
      files() {
        const files = new Map<string, string>();
        let names: string[];
        try {
          names = readdirSync(dir);
        } catch {
          return files;
        }
        for (const id of names) {
          if (SESSION_ID.test(id) && statSync(eventsOf(id), { throwIfNoEntry: false })?.isFile()) files.set(id, eventsOf(id));
        }
        return files;
      },
    },
  };
}
