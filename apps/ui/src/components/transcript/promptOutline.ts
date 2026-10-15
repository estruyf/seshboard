import type { DisplayItem, RenderItem } from './displayItems.ts';

// The prompt outline: a rail beside the conversation with a mark for each of your prompts. Everything here is
// pure, so the view only measures and draws.

/** Where a prompt lands below the top of the view after a jump, in pixels. */
export const LAND_OFFSET = 24;
/** Marks keep at least this many pixels apart on the rail. */
export const MARK_GAP = 6;
/** The rail shows from this many prompts. */
export const MIN_PROMPTS = 3;
/** The rail shows in a conversation at least this wide (a narrow split pane has no room for it). */
export const MIN_WIDTH = 600;
/** How far below the landing spot a prompt still counts as at the top (rounding, a row a few pixels off). */
const SLACK = 8;

type UserItem = Extract<DisplayItem, { kind: 'user' }>;

/**
 * One of your own prompts: a top-level `user` item. Slash commands are `command` items, prompts Claude gave a
 * subagent are `subagent`, and messages waiting in Up next aren't in the transcript yet, so none of them count.
 * The command palette's prompt list (Fork…, Rewind…) uses the same rule.
 */
export const isPrompt = (item: DisplayItem | RenderItem): item is UserItem => item.kind === 'user' && !item.subagent;

export interface OutlinePrompt {
  key: string;
  /** The row in the rendered list (the virtualizer's index). */
  index: number;
  text: string;
  at: number | null;
  hasImage: boolean;
  /** How many images the prompt had. */
  images: number;
}

/** Your prompts in the rendered list, oldest first. Prompts are never folded into a run of activity, so each has a row. */
export function outlinePrompts(items: readonly RenderItem[]): OutlinePrompt[] {
  const prompts: OutlinePrompt[] = [];
  items.forEach((item, index) => {
    if (isPrompt(item)) prompts.push({ key: item.key, index, text: item.text, at: item.at, hasImage: item.images.length > 0, images: item.images.length });
  });
  return prompts;
}

export interface OutlineMark extends OutlinePrompt {
  /** Where the mark sits on the rail, from 0 (top) to 1 (bottom). */
  top: number;
}

export interface OutlineLayout {
  marks: OutlineMark[];
  /** More marks than the rail has room for at `MARK_GAP`: they are drawn shorter, and hover picks the nearest. */
  dense: boolean;
}

/**
 * Places a mark for each prompt where its row starts in the transcript (`start(index)` over `total`, the
 * virtualizer's measurements, estimates for rows not measured yet), on a rail `height` pixels tall. Marks keep
 * `MARK_GAP` apart: a mark too close to the one before moves down, and a run that hits the bottom is pulled back
 * up. When even that doesn't fit, the marks share the rail evenly.
 */
export function layoutMarks(prompts: readonly OutlinePrompt[], rows: { start(index: number): number; total: number }, height: number): OutlineLayout {
  const n = prompts.length;
  if (n === 0) return { marks: [], dense: false };
  const span = Math.max(0, height);
  const total = rows.total > 0 ? rows.total : 1;
  const wanted = prompts.map((p) => Math.min(1, Math.max(0, rows.start(p.index) / total)) * span);
  const dense = n > 1 && (n - 1) * MARK_GAP > span;
  let px: number[];
  if (dense) {
    const step = n > 1 ? span / (n - 1) : 0;
    px = wanted.map((_, i) => i * step);
  } else {
    px = [...wanted];
    // Down: each mark at least a gap below the one before.
    for (let i = 1; i < n; i++) px[i] = Math.max(px[i]!, px[i - 1]! + MARK_GAP);
    // Up: the last one inside the rail, each one at least a gap above the next.
    px[n - 1] = Math.min(px[n - 1]!, span);
    for (let i = n - 2; i >= 0; i--) px[i] = Math.min(px[i]!, px[i + 1]! - MARK_GAP);
  }
  return {
    marks: prompts.map((p, i) => ({ ...p, top: span > 0 ? Math.min(1, Math.max(0, px[i]! / span)) : 0 })),
    dense,
  };
}

/** The mark nearest a point on the rail (`y` in the same units as the marks' `top`), or -1 without marks. */
export function nearestMark(marks: readonly { top: number }[], y: number): number {
  if (marks.length === 0) return -1;
  // Marks are in order: find the first at or below y, then compare it with the one above.
  let lo = 0;
  let hi = marks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid]!.top < y) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(marks[lo - 1]!.top - y) <= Math.abs(marks[lo]!.top - y)) return lo - 1;
  return lo;
}

/** The line a prompt has to be at or above to be the current one: the landing spot, give or take a few pixels. */
const lineFor = (viewTop: number) => viewTop + LAND_OFFSET + SLACK;

/**
 * The current prompt: the one whose row is nearest the top of the view, at or above it (`starts` are the prompts'
 * row starts, in order). Before the first prompt, the first one. -1 without prompts.
 */
export function currentPrompt(starts: readonly number[], viewTop: number): number {
  if (starts.length === 0) return -1;
  const line = lineFor(viewTop);
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= line) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/**
 * Where Next prompt goes from `current`: the prompt after it, `end` from the last one (the end of the
 * conversation), or the first prompt while the view is still above it. Null without prompts.
 */
export function nextPrompt(starts: readonly number[], viewTop: number, current: number): number | 'end' | null {
  if (starts.length === 0 || current < 0) return null;
  if (starts[current]! > lineFor(viewTop)) return current;
  return current + 1 < starts.length ? current + 1 : 'end';
}

/**
 * Where Previous prompt goes from `current`: back to the top of the current prompt when it has scrolled off above
 * the view, otherwise the prompt before it. Null at the first prompt, already in view.
 */
export function previousPrompt(starts: readonly number[], viewTop: number, current: number): number | null {
  if (starts.length === 0 || current < 0) return null;
  if (starts[current]! < viewTop - 1) return current;
  return current > 0 ? current - 1 : null;
}

/** What `promptKeysBlocked` reads of the focused element. */
export interface FocusedField {
  tagName?: string;
  type?: string;
  value?: string;
  isContentEditable?: boolean;
  textContent?: string | null;
}

/** Inputs that hold text, where ⌘⇧↑ and ⌘⇧↓ select to the start and the end. */
const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', '']);

/**
 * Previous prompt and Next prompt stay out of a text field that has text: there the keys select to the start or
 * the end. In an empty field (the message box before you type) they work.
 */
export function promptKeysBlocked(focused: FocusedField | null | undefined): boolean {
  if (!focused) return false;
  const tag = focused.tagName?.toUpperCase();
  if (tag === 'TEXTAREA') return (focused.value ?? '') !== '';
  if (tag === 'INPUT') return TEXT_INPUTS.has((focused.type ?? '').toLowerCase()) && (focused.value ?? '') !== '';
  if (focused.isContentEditable) return (focused.textContent ?? '').trim() !== '';
  return false;
}

/** "Prompt 6 of 9" plus the start of the prompt, for a mark's accessible name. */
export function markLabel(index: number, count: number, text: string, images = 0): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const start = flat.length > 80 ? `${flat.slice(0, 80).trimEnd()}…` : flat;
  const body = start || (images > 0 ? (images === 1 ? '1 image' : `${images} images`) : '');
  return `Prompt ${index + 1} of ${count}${body ? `: ${body}` : ''}`;
}

/** When a prompt was sent, for the tooltip: the time today, the date and time on another day. */
export function promptTime(at: number | null, now = Date.now()): string | null {
  if (at === null) return null;
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
}
