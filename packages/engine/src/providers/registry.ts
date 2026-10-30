import type { ProviderAdapter } from './provider.ts';
import { copilotProvider } from './copilot/copilotProvider.ts';

export interface ProviderOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  /** Another folder for a provider's sessions (tests, the demo home). */
  folders?: Partial<Record<ProviderAdapter['id'], string>>;
}

/** Every provider Seshboard supports besides Claude Code, in the order Settings › Providers lists them. */
export function createProviders({ env, home, folders = {} }: ProviderOptions): ProviderAdapter[] {
  return [copilotProvider({ env, home, ...(folders.copilot ? { folder: folders.copilot } : {}) })];
}
