/** How long after the first Esc a second one still stops the agent. */
export const ESCAPE_AGAIN_MS = 2000;

/**
 * What an Esc in the message box does while the agent works. With `twice` (Settings › Conversation), the first one
 * only arms the stop (`arm`, the box says to press it again) and a second within `ESCAPE_AGAIN_MS` stops the agent.
 * `armedAt` is when the first was pressed, or null.
 */
export function escapeToStop(armedAt: number | null, now: number, twice: boolean): 'stop' | 'arm' {
  if (!twice) return 'stop';
  return armedAt !== null && now - armedAt <= ESCAPE_AGAIN_MS ? 'stop' : 'arm';
}

/** Settings › Conversation's "Press Esc twice to stop", in the settings and in their search. */
export const ESCAPE_TWICE_DETAIL = 'While the agent is working, the first Esc in the message box asks you to press it again, so a stray Esc never stops a turn. Off, one Esc stops the agent. The Stop button always stops at once.';
