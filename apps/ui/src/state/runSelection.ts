/**
 * A pipeline's run row (#179): a run started from New session, before it has a session of its own. It is a row of the
 * sidebar and a pane like a session, keyed by the run's id, which the engine starts with `run-` (session ids are UUIDs,
 * so the two never collide). Code for this computer's sessions takes a pane's id through `localSessionId`, which is
 * null for a run row. Pure, so it can be tested.
 */

const PREFIX = 'run-';

/** Whether a row's or a pane's id is a run row's. */
export const isRunRowId = (id: string | null | undefined): id is string => !!id && id.startsWith(PREFIX);
