import type { CodexBinary } from './appServer.ts';

// STUB (feat/codex-source): a placeholder so this branch compiles. The app-server branch writes the real
// `findCodex`; when the branches meet, take that file and drop this one.

/** Where the user's own `codex` is (PATH, then the usual install places), with its version; null when it isn't installed. */
export async function findCodex(_env: Record<string, string | undefined>, _home: string): Promise<CodexBinary | null> {
  return null;
}
