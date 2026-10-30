import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProviderAdapter } from '../provider.ts';
import { findCopilot } from './copilotBinary.ts';
import { copilotDriver, type CreateCopilotClient } from './copilotDriver.ts';
import { copilotHome, copilotSessionsDir, copilotSessionSource, EVENTS_FILE, SESSION_ID } from './copilotSource.ts';

/** A file in a session's folder that changes what the sidebar shows: its events, or its title and folder. */
const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/](?:events\.jsonl|workspace\.yaml)$/i;

interface CopilotProviderOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  /** The login shell's environment, for finding and running `copilot`. Without it, the process's own. */
  shellEnv?: () => Promise<Record<string, string | undefined>>;
  folder?: string;
  createClient?: CreateCopilotClient;
  /** Where `copilot` is (tests); found on PATH and in the usual places otherwise. */
  binary?: () => Promise<{ path: string; version: string | null } | null>;
}

/**
 * GitHub Copilot CLI: one folder per session under `<COPILOT_HOME>/session-state`, read from disk, and run through
 * the Copilot SDK with the user's own `copilot` and its own login.
 */
export function copilotProvider({ env, home, shellEnv = async () => env, folder, createClient, binary }: CopilotProviderOptions): ProviderAdapter {
  const dir = folder ?? copilotSessionsDir(copilotHome(env, home));
  const eventsOf = (id: string) => join(dir, id, EVENTS_FILE);
  return {
    id: 'copilot',
    folder: dir,
    source: copilotSessionSource(dir),
    resumeCommand: 'copilot --resume={sessionId}',
    driver: copilotDriver({
      // Looked up each time until found: installing Copilot CLI works without restarting Seshboard.
      binary: binary ?? (async () => findCopilot(await shellEnv(), home)),
      // The same Copilot home as the folder read here, so what it writes is what the sidebar reads.
      env: async () => ({ ...(await shellEnv()), COPILOT_HOME: dirname(dir) }),
      ...(createClient ? { createClient } : {}),
    }),
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
