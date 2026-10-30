import type { OptionalProvider } from '@seshboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';

/** How a provider keeps its sessions on disk, as far as the session index needs to know. */
export interface ProviderFiles {
  /**
   * The session a changed file belongs to (its path relative to the provider's folder, as the folder's watcher reports
   * it), and the file that stands for the session; null for any other file.
   */
  sessionOf(relativePath: string): { sessionId: string; file: string } | null;
  /** Every session's file, by session id: what a full scan finds. */
  files(): Map<string, string>;
}

/**
 * Everything Seshboard knows about one agent besides Claude Code. Adding a provider is one module that returns this,
 * its id and name in `@seshboard/protocol`'s `providerConstants.ts`, and one line in `registry.ts`; the session index,
 * the sidebar, search, the transcript view and Settings › Providers take it from there (docs/providers.md).
 *
 * Providers are read-only for now: `source` lists and reads sessions, and nothing else of Seshboard's (sending,
 * forking, deleting) reaches them. Starting and steering sessions will be a further, optional part of this interface.
 */
export interface ProviderAdapter {
  id: OptionalProvider;
  /** The folder its sessions are in. Watched once the provider is allowed; Seshboard never creates or writes it. */
  folder: string;
  files: ProviderFiles;
  /** Lists and reads its sessions, as Claude Code's transcript messages (`RawSessionMessage`). */
  source: SessionSource;
  /** The command that continues a session in the provider's own CLI, with `{sessionId}` where the id goes. */
  resumeCommand: string;
}
