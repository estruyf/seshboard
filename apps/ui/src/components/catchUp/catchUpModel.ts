/**
 * The catch-up's logic, without React or the DOM, so it can be tested: when the card shows, what it says, which actions
 * it offers in which order, and what a key press does. `CatchUpCard`, `CatchUpBanner` and `CatchUpStrip` draw it.
 */
import type { CatchUpLayout } from '@switchboard/protocol/bridge';
import type { CatchUp, CatchUpNeedKind } from '@switchboard/protocol/client';

/** How the catch-up shows in the session: in full (the card or the banner), folded into the strip, or not at all. */
export type CatchUpShow = 'full' | 'strip' | null;

export interface ShowContext {
  layout: CatchUpLayout;
  /** The session has news you haven't looked at. */
  unread: boolean;
  /** Claude is working in it (a card from before is stale until the engine clears it). */
  working: boolean;
  /** A permission or question is open for it right now. */
  waiting: boolean;
  /** You folded this turn's card (true) or opened it from the strip (false); null when you did neither. */
  collapsed: boolean | null;
}

/**
 * The card shows in full when there is something to decide: the turn finished and you haven't read it, it stopped with an
 * error, or the session waits for you. A read session keeps the strip, so the briefing is one key away and never in the
 * way. A waiting card whose request is gone (the app restarted) isn't shown.
 */
export function catchUpShow(card: CatchUp | null, ctx: ShowContext): CatchUpShow {
  if (!card || ctx.layout === 'off' || ctx.working) return null;
  if (card.state === 'waiting' && !ctx.waiting) return null;
  if (ctx.collapsed !== null) return ctx.collapsed ? 'strip' : 'full';
  return card.state === 'waiting' || card.state === 'error' || ctx.unread ? 'full' : 'strip';
}

/** The colours of the card, all from the status tokens. */
export type CatchUpTone = 'unread' | 'error' | 'warn' | 'ok' | 'caution' | 'neutral';

/** The state in the card's header: "Finished", "Finished with errors", "Needs you · question", or "Committed" after a commit. */
export function stateLabel(card: CatchUp, committed: boolean): { label: string; tone: CatchUpTone } {
  if (committed) return { label: 'Committed', tone: 'ok' };
  if (card.state === 'waiting') return { label: `Needs you · ${card.need.kind === 'question' ? 'question' : 'permission'}`, tone: 'warn' };
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

/** Everything the card can do. */
export type CatchUpActionId = 'commit' | 'review' | 'reply' | 'read' | 'archive' | 'expand' | 'allow' | 'deny' | 'answer';

/** The letter that runs each action (↩ runs the primary one too); Allow and Send answer have only ↩, Deny none. */
export const ACTION_KEYS: Partial<Record<CatchUpActionId, string>> = { commit: 'c', review: 'd', reply: 'r', read: 'u', archive: 'e', expand: 'space' };

/** The primary action(s) for what the turn needs; after a commit there is only archiving left. */
export function primaryActions(kind: CatchUpNeedKind, committed: boolean): CatchUpActionId[] {
  if (committed) return ['archive'];
  switch (kind) {
    case 'commit':
      return ['commit'];
    case 'reply':
      return ['reply'];
    case 'permission':
      return ['allow', 'deny'];
    case 'question':
      return ['answer'];
    case 'review':
      return ['review'];
    default:
      return ['archive'];
  }
}

export interface ActionContext {
  unread: boolean;
  committed: boolean;
}

/**
 * The quieter actions after the primary one, in a fixed order, leaving out the primary and what doesn't apply: Review
 * changes only with a diff, Commit only when the turn finished with changes, Reply, Mark as read and Archive only once the
 * session doesn't wait for you, Mark as read only while unread, and Expand conversation always.
 */
export function secondaryActions(card: CatchUp, ctx: ActionContext): CatchUpActionId[] {
  const primary = new Set(primaryActions(card.need.kind, ctx.committed));
  const hasDiff = (card.signals.diff?.files ?? 0) > 0;
  const waiting = card.state === 'waiting';
  const applies: Record<'review' | 'commit' | 'reply' | 'read' | 'archive' | 'expand', boolean> = {
    review: hasDiff,
    commit: !waiting && hasDiff && !ctx.committed,
    reply: !waiting,
    read: !waiting && ctx.unread,
    archive: !waiting,
    expand: true,
  };
  return (['review', 'commit', 'reply', 'read', 'archive', 'expand'] as const).filter((id) => applies[id] && !primary.has(id));
}

/** A button's label: Review changes says Hide changes while the panel is open. */
export function actionLabel(id: CatchUpActionId, ctx: { changesOpen: boolean; layout: 'card' | 'banner' }): string {
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
      return 'Archive';
    case 'expand':
      return 'Expand conversation';
    case 'allow':
      return 'Allow';
    case 'deny':
      return 'Deny';
    case 'answer':
      return 'Send answer';
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
  | { type: 'action'; id: Exclude<CatchUpActionId, 'allow' | 'deny' | 'answer'> }
  | { type: 'option'; step: 1 | -1 }
  | { type: 'pick'; index: number };

const LETTERS: Record<string, Exclude<CatchUpActionId, 'allow' | 'deny' | 'answer'>> = { d: 'review', c: 'commit', r: 'reply', u: 'read', e: 'archive' };

/**
 * What a key does to the catch-up on screen, or null when it isn't the catch-up's: a key typed into the message box or
 * any other field, with a modifier, or while a dialog or menu is open is never taken. Enter and Space on a focused button
 * press that button instead. `show` is how the catch-up shows; `question` is set while it asks a question.
 */
export function catchUpKey(event: KeyLike, ctx: { target: KeyTarget; overlay: boolean; show: CatchUpShow; question: boolean; options: number }): CatchUpKey | null {
  if (!ctx.show || ctx.overlay || ctx.target === 'elsewhere' || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key;
  if (key === 'Escape') return { type: 'escape' };
  if (event.shiftKey) return null;
  if (key === ' ') return ctx.target === 'control' ? null : { type: 'action', id: 'expand' };
  // Folded into the strip, only Space (show it) and its primary action work; the letters are for the card.
  if (ctx.show === 'strip') return key === 'Enter' && ctx.target !== 'control' ? { type: 'primary' } : null;
  if (key === 'Enter') return ctx.target === 'control' ? null : { type: 'primary' };
  if (ctx.question && (key === 'ArrowDown' || key === 'ArrowUp')) return { type: 'option', step: key === 'ArrowDown' ? 1 : -1 };
  if (ctx.question && /^[1-9]$/.test(key)) return Number(key) <= ctx.options ? { type: 'pick', index: Number(key) - 1 } : null;
  const id = LETTERS[key.toLowerCase()];
  return id ? { type: 'action', id } : null;
}

/** What Esc closes next, innermost first: the message box you went to reply in, the Changes panel, Details, then the card. */
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

/** The session to open after archiving one: the next in the sidebar's order, else the one before, else none. */
export function nextAfterArchive(order: readonly string[], archived: string): string | null {
  const at = order.indexOf(archived);
  const rest = order.filter((id) => id !== archived);
  if (rest.length === 0) return null;
  if (at === -1) return rest[0]!;
  return rest[Math.min(at, rest.length - 1)]!;
}
