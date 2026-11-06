import type { ProviderDriver } from '../provider.ts';
import type { AppServer, CodexBinary } from './appServer.ts';

export interface CodexDriverOptions {
  /** The profile's app-server, shared with reading its sessions. */
  server: AppServer;
  /** Where `codex` is, and its version (status, models). */
  binary: () => Promise<CodexBinary | null>;
}

/**
 * Runs Codex sessions through the profile's `codex app-server`: `thread/start` or `thread/resume`, then a `turn/start`
 * per message with the mode's sandbox and approval policy (`codexModes.ts`), the model and the effort. Notifications go
 * through `CodexLive`, Codex's approvals and questions through `codexPermissions.ts`. Signing in stays Codex's own.
 */
export function codexDriver(_options: CodexDriverOptions): ProviderDriver {
  throw new Error('codexDriver: not built yet');
}
