/**
 * Remote's limits that the remote app needs as values too, without zod (see `remoteClient.ts`).
 *
 * The most images one message from a phone takes, and the most base64 each may be. The phone resizes a photo to
 * 2,000px on its longest side (JPEG at 0.8) first, so a few fit in one line of the channel (4 MB, `remoteServer.ts`),
 * which splits it into frames itself.
 */
export const REMOTE_MAX_IMAGES = 4;
export const REMOTE_IMAGE_BYTES = 900_000;

/**
 * Files a message takes besides its images (a PDF, a log, a spreadsheet), sent as they are: the other computer keeps
 * them in its data folder and the prompt mentions them by path. A message's images and files take at most
 * `REMOTE_ATTACHMENT_BYTES` of base64 together, so the line stays under the channel's 4 MB.
 */
export const REMOTE_MAX_FILES = 4;
export const REMOTE_ATTACHMENT_BYTES = 3_600_000;

/** The longest name a paired device or computer may have (`DeviceName`): a computer pairing with another sends its own. */
export const REMOTE_DEVICE_NAME_MAX = 60;

/** In `hello`'s `features`: `session.send` takes files, and `session.create` images and files. */
export const REMOTE_FEATURE_ATTACHMENTS = 'attachments';

/** In `hello`'s `features`: `usage.tokens` answers, so the Usage view can count that computer's tokens. */
export const REMOTE_FEATURE_USAGE_TOKENS = 'usage.tokens';

/** In `hello`'s `features`: `activity.range` answers, so Activity can count that computer's sessions. */
export const REMOTE_FEATURE_ACTIVITY = 'activity.range';

/** In `hello`'s `features`: `projects.branches` answers, and `session.create` and `later.add` take `checkoutBranch`. */
export const REMOTE_FEATURE_BRANCHES = 'branches';

/**
 * In `hello`'s `features`: `projects.branches` lists the remote branches too, and `session.create` and `later.add` take
 * `worktreeBase`, so a new worktree can start from another branch than the default.
 */
export const REMOTE_FEATURE_WORKTREE_BASE = 'worktree.base';

/** In `hello`'s `features`: `session.markUnread` answers, so Mark as read can be undone. */
export const REMOTE_FEATURE_MARK_UNREAD = 'session.markUnread';

/** In `hello`'s `features`: `projects.clonePlan`, `projects.clone` and `projects.cancelClone` answer (Clone from GitHub). */
export const REMOTE_FEATURE_CLONE = 'projects.clone';

/**
 * In `hello`'s `features`: `push.subscribe` takes the device's own VAPID key (and a label), and pushes carry the
 * device's id. A phone paired with more than one computer gives them all the same key, so one subscription gets every
 * computer's notifications.
 */
export const REMOTE_FEATURE_PUSH_KEY = 'push.vapid';

/**
 * In `hello`'s `features`: `usage.sessionCost` and `usage.windowCosts` answer, and `usage.tokens` rows carry their
 * `cost`, so a session there and the plan windows show their estimated API cost here.
 */
export const REMOTE_FEATURE_COSTS = 'costs';

/** In `hello`'s `features`: `limits.get`, `limits.resume` and `limits.arm` answer, and `limits.changed` follows a watched session. */
export const REMOTE_FEATURE_LIMITS = 'limits';

/**
 * In `hello`'s `features`: pipelines (#179). `sessions.list` has the runs and each session's `parentId`, and
 * `pipelines.list`, `pipelines.run` and the `runs.*` methods answer: start a run, its buttons, Push and a run row's
 * message box.
 */
export const REMOTE_FEATURE_PIPELINES = 'pipelines';

/** In `hello`'s `features`: `session.queue.sendNow` answers, so a message in Up next can be sent now (Claude stops first). */
export const REMOTE_FEATURE_QUEUE_SEND_NOW = 'session.queue.sendNow';
/** In `hello`'s `features`: `session.send` takes images or files without text, as a message on the computer does. */
export const REMOTE_FEATURE_SEND_ATTACHMENTS_ONLY = 'session.send.attachmentsOnly';
/** In `hello`'s `features`: `theme.get` answers and `theme.changed` follows, so the phone can look like this computer. */
export const REMOTE_FEATURE_THEME = 'theme';

/**
 * In `hello`'s `features`: each listed session says who started it (`RemoteSession.startedBy`), so another computer
 * sharing this one can name the other people's sessions. Without it, a session's starter isn't known.
 */
export const REMOTE_FEATURE_STARTED_BY = 'sessions.startedBy';

/**
 * In `hello`'s `features`: `app.update.get`, `app.update.check`, `app.update.install` and `app.update.cancel` answer
 * and `app.update.changed` follows, so Seshboard on another paired computer can update Seshboard there (never a phone).
 */
export const REMOTE_FEATURE_UPDATE = 'app.update';

/** In `hello`'s `features`: `sessions.archived` answers, and `session.setFlags` reopens a session it lists. */
export const REMOTE_FEATURE_ARCHIVED = 'sessions.archived';

/**
 * In `hello`'s `features`: `files.read` and `files.image` answer, so a file the session made (a Write of Claude's, or
 * one in the session's scratchpad) opens on the phone or on another computer.
 */
export const REMOTE_FEATURE_FILES = 'files.read';

/**
 * The most text of a file `files.read` sends (1 MB) and the largest image `files.image` sends (2.5 MB, 3.4 MB as
 * base64), so an answer stays under the channel's 4 MB line. A bigger text file comes with its size and no content.
 */
export const REMOTE_FILE_TEXT_BYTES = 1_000_000;
export const REMOTE_FILE_IMAGE_BYTES = 2_500_000;

/** The first version that can be updated from another computer (`REMOTE_FEATURE_UPDATE`), for "needs … or later". */
export const REMOTE_UPDATE_SINCE = '1.3.0';
