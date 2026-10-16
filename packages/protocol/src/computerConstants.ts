import type { MethodName } from './rpc.ts';
import type { RemoteContract } from './remote.ts';

/** Other computers' constants, without zod, for the app's windows too (see `computers.ts`). */

/**
 * The `Origin` this Switchboard sends when it connects to another computer's Remote. A browser page can't send it,
 * so it never widens what a website can reach; it is no lock either (any program can send any `Origin`): the
 * handshake with the paired device key is.
 */
export const REMOTE_DESKTOP_ORIGIN = 'switchboard-desktop://switchboard';

/**
 * What a window may ask another computer. Not `hello` (the engine says it once per connection), and not push
 * notifications or `device.visibility`, which are a browser's: this computer stays connected and tells you itself.
 */
export const COMPUTER_METHODS = [
  'sessions.list',
  'projects.list',
  'transcript.get',
  'transcript.watch',
  'transcript.unwatch',
  'session.send',
  'session.queue.remove',
  'session.interrupt',
  'session.stopTask',
  'session.respond',
  'session.create',
  'later.add',
  'session.ask',
  'session.askThreads',
  'session.markRead',
  'session.setFlags',
  'session.setModel',
  'session.setEffort',
  'session.setPermissionMode',
  'options.get',
  'usage.get',
  'usage.tokens',
  'catchup.get',
  'changes.get',
  'changes.diff',
  'changes.commit',
] as const satisfies ReadonlyArray<MethodName<RemoteContract>>;
export type ComputerMethod = (typeof COMPUTER_METHODS)[number];
