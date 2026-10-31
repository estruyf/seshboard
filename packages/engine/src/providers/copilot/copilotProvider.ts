import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderAdapter } from '../provider.ts';
import { findCopilot } from './copilotBinary.ts';
import { copilotDriver, type CreateCopilotClient } from './copilotDriver.ts';
import { isAlive, lockPids, openSessions } from './copilotInUse.ts';
import { copilotSessionsDir, copilotSessionSource, EVENTS_FILE, SESSION_ID } from './copilotSource.ts';

/** Continues a session in Copilot CLI. */
export const COPILOT_RESUME = 'copilot --resume={sessionId}';

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
 * through the Copilot SDK with the user's own `copilot` and the profile's own login (its `COPILOT_HOME`).
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
  return {
    id: 'copilot',
    profileId,
    home: copilotHome,
    folder: dir,
    source: copilotSessionSource(dir),
    resumeCommand: COPILOT_RESUME,
    signInCommand: 'copilot login',
    driver,
    inUse: (sessionId) => SESSION_ID.test(sessionId) && lockPids(join(dir, sessionId)).some((pid) => !own().has(pid) && isAlive(pid)),
    live: (sessionIds) => openSessions(dir, sessionIds.filter((id) => SESSION_ID.test(id)), own()),
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
