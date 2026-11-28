import type { CanvasListed, CanvasLogLine } from '@seshboard/protocol/client';

/*
 * A project's canvas in a session's side panel (docs/canvases.md): what the panel shows, as pure functions of what the
 * engine lists and what this panel is doing.
 */

/** What the panel shows: the question before a first run, the wait, the page, why it failed, or that it is stopped. */
export type CanvasView = 'trust' | 'starting' | 'page' | 'failed' | 'stopped';

/** `opening`: this panel asked for the page and waits. `error`: its last ask failed. */
export function canvasView(canvas: Pick<CanvasListed, 'trusted' | 'state' | 'url'>, opening: boolean, error: string | null): CanvasView {
  if (!canvas.trusted) return 'trust';
  if (canvas.state === 'running' && canvas.url) return 'page';
  if (opening || canvas.state === 'starting') return 'starting';
  if (error !== null || canvas.state === 'failed') return 'failed';
  return 'stopped';
}

/**
 * Whether the panel starts the canvas by itself: trusted, not running, not failed (a failure waits for Try again) and
 * not stopped by you (that waits for Start).
 */
export const canvasStartsItself = (canvas: Pick<CanvasListed, 'trusted' | 'state' | 'held'>, error: string | null): boolean => canvas.trusted && canvas.state === 'stopped' && !canvas.held && error === null;

/** The open canvases after a click on one: opened at the end, or closed. */
export const toggleCanvas = (open: readonly string[], id: string, on: boolean): string[] => (on ? (open.includes(id) ? [...open] : [...open, id]) : open.filter((other) => other !== id));

/**
 * Whether what a canvas composed goes to this panel's session: the panel whose page has the keyboard takes it (you
 * clicked there), else the one in the active pane, unless another canvas's page has the keyboard.
 */
export function composeHere(focused: { tagName?: string } | null, page: unknown, active: boolean): boolean {
  if (page !== null && focused === page) return true;
  return active && focused?.tagName !== 'WEBVIEW';
}

/** The letter on a canvas's rail button. */
export const canvasInitial = (name: string): string => (name.trim().charAt(0) || 'C').toUpperCase();

/** A log line's time of day, as `09:05:07`. */
export const logTime = (at: number): string => {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':');
};

/** How a log line reads: Seshboard's own lines are quiet, the canvas's warnings and errors stand out. */
export const logTone = (line: Pick<CanvasLogLine, 'level' | 'from'>): 'quiet' | 'plain' | 'warn' | 'error' => (line.level === 'error' ? 'error' : line.level === 'warn' ? 'warn' : line.from === 'seshboard' ? 'quiet' : 'plain');

/** Whether the log's end is in view (within a line of it), so new lines keep it there. */
export const atLogEnd = (scrollTop: number, clientHeight: number, scrollHeight: number): boolean => scrollHeight - scrollTop - clientHeight < 24;
