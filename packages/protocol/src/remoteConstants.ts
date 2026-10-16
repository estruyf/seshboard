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

/** In `hello`'s `features`: `session.send` takes files, and `session.create` images and files. */
export const REMOTE_FEATURE_ATTACHMENTS = 'attachments';

/** In `hello`'s `features`: `usage.tokens` answers, so the Usage view can count that computer's tokens. */
export const REMOTE_FEATURE_USAGE_TOKENS = 'usage.tokens';

/** In `hello`'s `features`: `projects.branches` answers, and `session.create` and `later.add` take `checkoutBranch`. */
export const REMOTE_FEATURE_BRANCHES = 'branches';

/** In `hello`'s `features`: `session.markUnread` answers, so Mark as read can be undone. */
export const REMOTE_FEATURE_MARK_UNREAD = 'session.markUnread';

/**
 * In `hello`'s `features`: `usage.sessionCost` and `usage.windowCosts` answer, and `usage.tokens` rows carry their
 * `cost`, so a session there and the plan windows show their estimated API cost here.
 */
export const REMOTE_FEATURE_COSTS = 'costs';
