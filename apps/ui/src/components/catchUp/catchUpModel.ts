/**
 * The catch-up's logic, without React or the DOM, so it can be tested: when the banner shows, what it says, which actions
 * it offers in which order, and what a key press does. `CatchUpBanner` and `CatchUpStrip` draw it.
 */
import { cleanNote, type CatchUp, type CatchUpNeedKind } from '@seshboard/protocol/client';

/** How the catch-up shows in the session: in full (the banner), folded into the strip, or not at all. */
export type CatchUpShow = 'full' | 'strip' | null;

export interface ShowContext {
  /** Settings › Conversation: "Write catch-up summaries with Haiku". Off, a catch-up only shows when you ask for one. */
  enabled: boolean;
  /** Settings › Conversation: "Show catch-ups folded". On, an unread turn starts as the strip too. */
  folded: boolean;
  /** The session has news you haven't looked at. */
  unread: boolean;
  /** Claude is working in it (a card from before is stale until the engine clears it). */
  working: boolean;
  /** A permission or question is open for it right now. */
  waiting: boolean;
  /** You folded this turn's banner (true) or opened it from the strip (false); null when you did neither. */
  collapsed: boolean | null;
}

/**
 * The banner shows when a turn ended and there is something to decide: you haven't read it, or it stopped with an error.
 * A read session keeps the strip, so the briefing is one key away and never in the way; with "Show catch-ups folded" on,
 * an unread one does too, and only an error opens the banner by itself. A session that waits for a
 * permission or an answer has no catch-up: the card above the message box asks, and its Why? explains. With summaries
 * off there is none either, unless you ask for it (Catch up on this session); folding it then hides it.
 */
export function catchUpShow(card: CatchUp | null, ctx: ShowContext): CatchUpShow {
  if (!card || ctx.working || ctx.waiting || card.state === 'waiting') return null;
  if (!ctx.enabled) return ctx.collapsed === false ? 'full' : null;
  if (ctx.collapsed !== null) return ctx.collapsed ? 'strip' : 'full';
  return card.state === 'error' || (ctx.unread && !ctx.folded) ? 'full' : 'strip';
}

/** The colours of the card, all from the status tokens. */
export type CatchUpTone = 'unread' | 'error' | 'warn' | 'ok' | 'caution' | 'neutral';

/** The state at the start of the banner: "Finished", "Finished with errors", or "Committed" after a commit. */
export function stateLabel(card: CatchUp, committed: boolean): { label: string; tone: CatchUpTone } {
  if (committed) return { label: 'Committed', tone: 'ok' };
  if (card.state === 'error') return { label: 'Finished with errors', tone: 'error' };
  return { label: 'Finished', tone: 'unread' };
}

/** "~2 min to review", or "Nothing to review" when the turn needs nothing from you. */
export const reviewLabel = (card: CatchUp) => (card.need.kind === 'none' ? 'Nothing to review' : `~${card.reviewMinutes} min to review`);

/** The colour of what the card needs from you. */
export const NEED_TONE: Record<CatchUpNeedKind, CatchUpTone> = { commit: 'ok', reply: 'error', permission: 'warn', question: 'warn', review: 'caution', none: 'neutral' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface Chip {
  id: 'tests' | 'diff' | 'scope' | 'plan';
  text: string;
  tone: CatchUpTone;
  tooltip?: string;
}

/** The trust signals as chips: tests always, the diff when there is one, out of scope and the plan only when they apply. */
export function chipsOf(card: CatchUp): Chip[] {
  const { tests, diff, outOfScope, scope, plan } = card.signals;
  const chips: Chip[] = [];
  if (tests.state === 'passed') chips.push({ id: 'tests', text: tests.passed ? `${plural(tests.passed, 'test')} passed` : 'Tests passed', tone: 'ok', tooltip: tests.command });
  else if (tests.state === 'failed') {
    const total = (tests.passed ?? 0) + (tests.failed ?? 0);
    chips.push({ id: 'tests', text: tests.failed ? `${tests.failed} of ${total} ${total === 1 ? 'test fails' : 'tests fail'}` : 'Tests failed', tone: 'error', tooltip: tests.command });
  } else chips.push({ id: 'tests', text: 'No tests run', tone: 'neutral' });
  if (diff && diff.files > 0) chips.push({ id: 'diff', text: `+${diff.add} −${diff.del} · ${plural(diff.files, 'file')}`, tone: 'neutral' });
  if (outOfScope.length > 0) chips.push({ id: 'scope', text: `${plural(outOfScope.length, 'file')} outside ${scope ?? (plan !== null ? 'the plan' : 'the project')}`, tone: 'caution', tooltip: outOfScope.slice(0, 12).join('\n') });
  if (plan === 'followed') chips.push({ id: 'plan', text: 'Followed the plan', tone: 'ok' });
  if (plan === 'deviated') chips.push({ id: 'plan', text: 'Deviated from the plan', tone: 'caution' });
  return chips;
}

/** Everything the banner can do. */
export type CatchUpActionId = 'commit' | 'review' | 'reply' | 'read' | 'archive';

/** The letter that runs each action; ↩ runs the primary one too. */
export const ACTION_KEYS: Record<CatchUpActionId, string> = { commit: 'c', review: 'd', reply: 'r', read: 'u', archive: 'e' };

/** The primary action for what the turn needs; after a commit there is only archiving left. */
export function primaryAction(kind: CatchUpNeedKind, committed: boolean): CatchUpActionId {
  if (committed) return 'archive';
  switch (kind) {
    case 'commit':
      return 'commit';
    case 'reply':
      return 'reply';
    case 'review':
      return 'review';
    default:
      return 'archive';
  }
}

export interface ActionContext {
  unread: boolean;
  committed: boolean;
}

/**
 * The quieter actions after the primary one, in a fixed order, leaving out the primary and what doesn't apply: Review
 * changes and Commit only with a diff (Commit not after a commit), Mark as read only while unread.
 */
export function secondaryActions(card: CatchUp, ctx: ActionContext): CatchUpActionId[] {
  const primary = primaryAction(card.need.kind, ctx.committed);
  const hasDiff = (card.signals.diff?.files ?? 0) > 0;
  const applies: Record<CatchUpActionId, boolean> = { review: hasDiff, commit: hasDiff && !ctx.committed, reply: true, read: ctx.unread, archive: true };
  return (['review', 'commit', 'reply', 'read', 'archive'] as const).filter((id) => applies[id] && id !== primary);
}

/** A button's label: Review changes says Hide changes while the panel is open. */
export function actionLabel(id: CatchUpActionId, ctx: { changesOpen: boolean }): string {
  switch (id) {
    case 'commit':
      return 'Commit';
    case 'review':
      return ctx.changesOpen ? 'Hide changes' : 'Review changes';
    case 'reply':
      return 'Reply';
    case 'read':
      return 'Mark as read';
    case 'archive':
      return 'Done';
  }
}

/** Where a key was pressed, as far as the catch-up cares. */
export type KeyTarget =
  /** Nothing in particular has focus, or something in this session's view that isn't a field. */
  | 'view'
  /** A button or link (Enter and Space press it). */
  | 'control'
  /** A text field, the message box, or anywhere outside this session's view: never the catch-up's. */
  | 'elsewhere';

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

export type CatchUpKey =
  | { type: 'primary' }
  | { type: 'escape' }
  /** Space: Details in the banner, or the banner from the strip. */
  | { type: 'space' }
  /** S: on to the next session to go through, leaving this one as it is. */
  | { type: 'skip' }
  /** N: write what's left in the session (banner only). */
  | { type: 'note' }
  /** L: remind me later, then on to the next session (banner only). */
  | { type: 'remind' }
  | { type: 'action'; id: CatchUpActionId };

/** The letter that skips to the next session, in the banner and the strip. */
export const SKIP_KEY = 's';
/** The letter that opens the session's note, in the banner. */
export const NOTE_KEY = 'n';
/** The letter for Remind me later, in the banner. */
export const REMIND_KEY = 'l';

const LETTERS: Record<string, CatchUpActionId> = Object.fromEntries(Object.entries(ACTION_KEYS).map(([id, key]) => [key, id as CatchUpActionId]));

/**
 * What a key does to the catch-up on screen, or null when it isn't the catch-up's: a key typed into the message box or
 * any other field, with a modifier, or while a dialog or menu is open is never taken. Enter and Space on a focused button
 * press that button instead. `show` is how the catch-up shows.
 */
export function catchUpKey(event: KeyLike, ctx: { target: KeyTarget; overlay: boolean; show: CatchUpShow }): CatchUpKey | null {
  if (!ctx.show || ctx.overlay || ctx.target === 'elsewhere' || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key;
  if (key === 'Escape') return { type: 'escape' };
  if (event.shiftKey) return null;
  if (key === ' ') return ctx.target === 'control' ? null : { type: 'space' };
  // Skip works folded too: going through Open sessions, which are read, meets their strips.
  if (key.toLowerCase() === SKIP_KEY) return { type: 'skip' };
  // Folded into the strip, only Space (show it), Skip and its primary action work; the other letters are for the banner.
  if (ctx.show === 'strip') return key === 'Enter' && ctx.target !== 'control' ? { type: 'primary' } : null;
  if (key === 'Enter') return ctx.target === 'control' ? null : { type: 'primary' };
  if (key.toLowerCase() === NOTE_KEY) return { type: 'note' };
  if (key.toLowerCase() === REMIND_KEY) return { type: 'remind' };
  const id = LETTERS[key.toLowerCase()];
  return id ? { type: 'action', id } : null;
}

/** What Esc closes next, innermost first: the message box you went to reply in, the Changes panel, Details, then the banner. */
export type EscapeStep = 'leave-reply' | 'close-changes' | 'close-details' | 'collapse';

export function escapeStep(state: { replying: boolean; changesOpen: boolean; detailsOpen: boolean; show: CatchUpShow }): EscapeStep | null {
  if (state.replying) return 'leave-reply';
  if (!state.show) return null;
  if (state.changesOpen) return 'close-changes';
  if (state.detailsOpen) return 'close-details';
  return state.show === 'full' ? 'collapse' : null;
}

/** "Reply to Claude about <title>…", the message box's placeholder after Reply. */
export const replyPlaceholder = (title: string) => `Reply to Claude about ${title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title}…`;

/**
 * What the catch-up offers as the session's note ("Use as note"): what it needs from you, in its own words, unless it
 * needs nothing or the note says that already. Only offered: a note is never set by itself.
 */
export function suggestedNote(card: CatchUp, note: string | null | undefined): string | null {
  if (card.need.kind === 'none') return null;
  const suggestion = cleanNote(card.need.title);
  return suggestion && suggestion !== note ? suggestion : null;
}

/** Where you are in a pass through the sessions to go through (Skip and Done move it on). */
export interface PassState {
  /** The session the pass is on. */
  current: string;
  /** The ones you skipped: the pass doesn't come back to them. */
  skipped: ReadonlySet<string>;
  /** How many you skipped or archived so far. */
  handled: number;
}

/**
 * The session a pass goes to next: the first in `order` (To review, then Open, in the sidebar's order) that isn't the
 * current one and that you haven't skipped. From the top each time, because reading a session moves it from To review
 * to Open, further down. Null when there is none left.
 */
export function nextInPass(order: readonly string[], current: string, skipped: ReadonlySet<string>): string | null {
  return order.find((id) => id !== current && !skipped.has(id)) ?? null;
}

/** The pass after skipping or archiving the current session, on `next`; null when there is nothing left. */
export function advancePass(pass: PassState | null, from: string, how: 'skip' | 'done', order: readonly string[]): PassState | null {
  // Skipping from a session the pass isn't on starts a new pass there.
  const base = pass?.current === from ? pass : { current: from, skipped: new Set<string>(), handled: 0 };
  const skipped = how === 'skip' ? new Set([...base.skipped, from]) : base.skipped;
  const next = nextInPass(order, from, skipped);
  return next ? { current: next, skipped, handled: base.handled + 1 } : null;
}

/** "2 of 7" while a pass is on this session: those handled, this one, and those still to come. Null outside a pass. */
export function passPosition(pass: PassState | null, sessionId: string, order: readonly string[]): { position: number; total: number } | null {
  if (!pass || pass.current !== sessionId) return null;
  const left = order.filter((id) => id !== sessionId && !pass.skipped.has(id)).length;
  return { position: pass.handled + 1, total: pass.handled + 1 + left };
}
