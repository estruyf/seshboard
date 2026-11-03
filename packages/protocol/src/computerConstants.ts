import type { MethodName } from './rpc.ts';
import type { RemoteContract } from './remote.ts';

/** Other computers' constants, without zod, for the app's windows too (see `computers.ts`). */

/**
 * The `Origin` this Seshboard sends when it connects to another computer's Remote. A browser page can't send it,
 * so it never widens what a website can reach; it is no lock either (any program can send any `Origin`): the
 * handshake with the paired device key is.
 */
export const REMOTE_DESKTOP_ORIGIN = 'switchboard-desktop://switchboard';

/**
 * The colours a paired computer can have, to tell computers apart (Settings › Remote, Other computers). `violet` is
 * the `remote` token, what every computer has until you pick another; the others use the profile colours' tokens.
 */
export const COMPUTER_COLORS = ['violet', 'blue', 'green', 'yellow', 'orange', 'red', 'gray'] as const;
export type ComputerColor = (typeof COMPUTER_COLORS)[number];

/**
 * Which of a paired computer's notifications this one shows (Settings › Remote, Other computers): `all` (needs you,
 * finished and failed, as for a session here), `needs-you` (only a session that waits for you), or `off`. Its sessions
 * still show in the sidebar either way.
 */
export const COMPUTER_NOTIFY = ['all', 'needs-you', 'off'] as const;
export type ComputerNotify = (typeof COMPUTER_NOTIFY)[number];

/** The longest name you can give a paired computer here. */
export const COMPUTER_NAME_MAX = 60;

/**
 * What a window may ask another computer. Not `hello` (the engine says it once per connection), and not push
 * notifications or `device.visibility`, which are a browser's: this computer stays connected and tells you itself.
 */
export const COMPUTER_METHODS = [
  'sessions.list',
  'projects.list',
  'projects.branches',
  'transcript.get',
  'transcript.watch',
  'transcript.unwatch',
  'session.send',
  'session.queue.remove',
  'session.queue.sendNow',
  'session.interrupt',
  'session.stopTask',
  'session.respond',
  'session.create',
  'later.add',
  'session.ask',
  'session.askThreads',
  'session.markRead',
  'session.markUnread',
  'session.setFlags',
  'session.setModel',
  'session.setEffort',
  'session.setPermissionMode',
  'options.get',
  'providers.ready',
  'usage.get',
  'usage.tokens',
  'usage.sessionCost',
  'usage.windowCosts',
  'limits.get',
  'limits.resume',
  'limits.arm',
  'catchup.get',
  'changes.get',
  'changes.diff',
  'changes.commit',
  'projects.clonePlan',
  'projects.clone',
  'projects.cancelClone',
  'pipelines.list',
  'pipelines.run',
  'runs.continue',
  'runs.retryStep',
  'runs.anotherRound',
  'runs.skipStep',
  'runs.stop',
  'runs.pushPreview',
] as const satisfies ReadonlyArray<MethodName<RemoteContract>>;
export type ComputerMethod = (typeof COMPUTER_METHODS)[number];
