import type { ProviderAdapter } from './provider.ts';
import type { CreateCopilotClient } from './copilot/copilotDriver.ts';
import { copilotProvider } from './copilot/copilotProvider.ts';

export interface ProviderOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  /** The login shell's environment, which providers' CLIs run with (their own config and login are found through it). */
  shellEnv: () => Promise<Record<string, string | undefined>>;
  /** Another folder for a provider's sessions (tests, the demo home). */
  folders?: Partial<Record<ProviderAdapter['id'], string>>;
  /** A fake Copilot SDK (tests). */
  copilotClient?: CreateCopilotClient;
}

/** Every provider Seshboard supports besides Claude Code, in the order Settings › Providers lists them. */
export function createProviders({ env, home, shellEnv, folders = {}, copilotClient }: ProviderOptions): ProviderAdapter[] {
  return [copilotProvider({ env, home, shellEnv, ...(folders.copilot ? { folder: folders.copilot } : {}), ...(copilotClient ? { createClient: copilotClient } : {}) })];
}
