import { join } from 'node:path';
import type { ProviderAdapter } from '../provider.ts';
import type { CodexBinary } from './appServer.ts';

/** Continues a session in Codex CLI. */
export const CODEX_RESUME = 'codex resume {sessionId}';

/** Installs Codex CLI (OpenAI's own instructions). */
export const CODEX_INSTALL = 'npm install -g @openai/codex';

/** Codex CLI's data folder: `$CODEX_HOME`, else `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  return env.CODEX_HOME || join(home, '.codex');
}

export interface CodexProviderOptions {
  /** The Codex profile this is (Settings › Profiles). */
  profileId: string;
  /** The profile's `CODEX_HOME`: its config, login and sessions. */
  codexHome: string;
  /** The user's home folder, where Codex's installers put it. */
  userHome: string;
  /** The login shell's environment, for finding and running `codex`. Without it, the process's own. */
  shellEnv?: () => Promise<Record<string, string | undefined>>;
  /** Where `codex` is (tests and the demo); found on PATH and in the usual places otherwise. */
  binary?: () => Promise<CodexBinary | null>;
}

/** One Codex profile: its sessions read through `codex app-server`, with the profile's own `CODEX_HOME`. */
export function codexProvider(_options: CodexProviderOptions): ProviderAdapter {
  throw new Error('codexProvider: not built yet');
}
