import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderAdapter } from '../provider.ts';
import { copilotHome, copilotSessionsDir, copilotSessionSource, EVENTS_FILE, SESSION_ID } from './copilotSource.ts';

/** A file in a session's folder that changes what the sidebar shows: its events, or its title and folder. */
const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/](?:events\.jsonl|workspace\.yaml)$/i;

/** GitHub Copilot CLI: one folder per session under `<COPILOT_HOME>/session-state`, read-only. */
export function copilotProvider({ env, home, folder }: { env: NodeJS.ProcessEnv; home: string; folder?: string }): ProviderAdapter {
  const dir = folder ?? copilotSessionsDir(copilotHome(env, home));
  const eventsOf = (id: string) => join(dir, id, EVENTS_FILE);
  return {
    id: 'copilot',
    folder: dir,
    source: copilotSessionSource(dir),
    resumeCommand: 'copilot --resume={sessionId}',
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
