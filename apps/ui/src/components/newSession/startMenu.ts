import { matches, type ShortcutId } from '../../lib/shortcuts.ts';

/** What New session's Start button (and the palette's prompt step) can do with the prompt. */
export type StartAction = 'start' | 'start-one' | 'queue' | 'schedule' | 'trigger' | 'pipeline' | 'start-worktree';

export interface StartButtonInput {
  /** Why nothing can go anywhere: connecting, no folder yet. */
  blocked: string | null;
  /** On its way: every part waits. */
  sending: boolean;
  /** Something to start with: text, images or context. */
  hasMessage: boolean;
  /** Something to queue: text or context (images stay behind). */
  hasText: boolean;
  /** Why starting can't while queueing still can (the focus limit in Strict mode). */
  startBlocked: string | null;
  /** Why starting on this checkout can't, while a new worktree still can (the branch is checked out in another worktree). */
  branchBlocked?: string | null;
  /** The folder is a git repository, so a new worktree is possible. */
  canWorktree: boolean;
  /** The route already is a new worktree. */
  worktree: boolean;
  /** A quick question: it asks rather than starts. */
  question: boolean;
  /**
   * Opened to follow a session (Start after this one…): the main part adds to the queue, and starting moves into the
   * menu.
   */
  queueFirst?: boolean;
  /** Opened with Schedule a session (Upcoming): the main part is Schedule…, and starting moves into the menu. */
  scheduleFirst?: boolean;
  /** Offer Schedule… (New session; the palette's prompt step has no dialog for it). */
  canSchedule?: boolean;
  /** A schedule is open (Edit…): Schedule… becomes Save schedule. */
  editingSchedule?: boolean;
  /** Offer Start when… (New session, with a project): the prompt and its choices in a new trigger. */
  canTrigger?: boolean;
  /** A pipeline can run here (New session, in a git repository): the Run as chip shows, and `runAs` counts (#179). */
  canPipeline?: boolean;
  /** The pipeline the Run as chip picked: Start runs it with the prompt as its task. Null: one session. */
  runAs?: { id: string; name: string } | null;
  /**
   * Another provider runs it (a GitHub Copilot profile), which has no queue, schedules, triggers or worktrees yet: those
   * items stay in the menu, off, with this as their reason ("Not with GitHub Copilot yet").
   */
  notWith?: string | null;
}

export interface StartMenuItem {
  action: StartAction;
  label: string;
  /** The key that does the same without the menu. */
  shortcut?: ShortcutId;
  disabled: boolean;
  /** Why it can't be picked now, when that isn't the whole button's reason. */
  reason?: string;
}

export interface StartButtonState {
  /** What the main part does: start, or add to the queue (`queueFirst`). */
  main: StartAction;
  /** The main part's key; Schedule… has none. */
  shortcut: ShortcutId | null;
  label: string;
  /** On its way: the label says so, without the shortcut. */
  sending: boolean;
  /** The main part. */
  disabled: boolean;
  /** The ▾: usable while any of its items is. */
  menuDisabled: boolean;
  /** Why the main part is unavailable, shown over the whole button. */
  reason: string | null;
  items: StartMenuItem[];
}

/**
 * The split Start button: the main part starts, the ▾ opens Start session, Add to queue, Schedule…, Start when… and (in a
 * git repository on the current checkout) Start in a new worktree. A reason that stops everything disables the whole
 * button; one that only stops starting leaves the ▾ for Add to queue. With a pipeline picked in the Run as chip, the main
 * part is Run pipeline, and the ▾ starts with Start one session; the chip is the one place to pick a pipeline.
 */
export function startButtonState(input: StartButtonInput): StartButtonState {
  const { blocked, sending, hasMessage, hasText, startBlocked } = input;
  const canStart = !blocked && !sending && hasMessage && !startBlocked;
  const canStartHere = canStart && !input.branchBlocked;
  const canQueue = !blocked && !sending && hasText;
  const verb = input.question ? 'Ask' : 'Start';
  const off = input.notWith ?? null;
  /** An item another provider can't do yet: off, saying so. */
  const unless = (disabled: boolean) => (off ? { disabled: true, reason: off } : { disabled });
  const items: StartMenuItem[] = [
    { action: 'start', label: input.question ? 'Ask' : 'Start session', shortcut: 'new-session.start', disabled: !canStartHere },
    { action: 'queue', label: 'Add to queue', shortcut: 'new-session.queue', ...unless(!canQueue) },
  ];
  // A schedule keeps the prompt with its choices, like a queued item, and runs it at set times (#173).
  if (input.canSchedule && !input.question) items.push({ action: 'schedule', label: input.editingSchedule ? 'Save schedule' : 'Schedule…', ...unless(!canQueue) });
  // A trigger starts it when there is work: a CI failure, an issue for you (#180).
  if (input.canTrigger && !input.question && !input.editingSchedule) items.push({ action: 'trigger', label: 'Start when…', ...unless(!canQueue) });
  if (input.canWorktree && !input.worktree && !input.question) items.push({ action: 'start-worktree', label: 'Start in a new worktree', ...unless(!canStart) });
  // A pipeline runs with the prompt as its task, in a worktree of its own: the branch and the focus limit don't stop it
  // (#179). Start when… makes a trigger that starts it (#185); a queued item or a schedule is one session.
  const runAs = input.canPipeline && !input.question && !input.editingSchedule && !off ? (input.runAs ?? null) : null;
  if (runAs) {
    const one: StartMenuItem = { action: 'start-one', label: 'Start one session', disabled: !canStartHere };
    const rest = items.slice(1);
    return {
      main: 'pipeline',
      shortcut: 'new-session.start',
      label: sending ? 'Starting…' : 'Run pipeline',
      sending,
      disabled: !canQueue,
      menuDisabled: [one, ...rest].every((item) => item.disabled),
      reason: sending ? null : (blocked ?? (!hasText ? 'Type the task first' : null)),
      items: [one, ...rest],
    };
  }
  if (input.scheduleFirst && input.canSchedule && !input.question && !off) {
    const schedule = items.find((item) => item.action === 'schedule')!;
    return {
      main: 'schedule',
      shortcut: null,
      label: schedule.label,
      sending,
      disabled: !canQueue,
      menuDisabled: items.every((item) => item.disabled),
      reason: sending ? null : (blocked ?? (!hasText ? 'Type a message first' : null)),
      items: [schedule, ...items.filter((item) => item !== schedule)],
    };
  }
  if (input.queueFirst && !input.question && !off) {
    return {
      main: 'queue',
      shortcut: 'new-session.queue',
      label: sending ? 'Adding…' : 'Add to queue',
      sending,
      disabled: !canQueue,
      menuDisabled: items.every((item) => item.disabled),
      reason: sending ? null : (blocked ?? (!hasText ? 'Type a message first' : null)),
      items: [items[1]!, items[0]!, ...items.slice(2)],
    };
  }
  return {
    main: 'start',
    shortcut: 'new-session.start',
    label: sending ? `${input.question ? 'Asking' : 'Starting'}…` : verb,
    sending,
    disabled: !canStartHere,
    menuDisabled: items.every((item) => item.disabled),
    reason: sending ? null : (blocked ?? (!hasMessage ? 'Type a message first' : (startBlocked ?? input.branchBlocked ?? null))),
    items,
  };
}

/** Why starting waits at the focus limit: only in Strict mode (Nudge asks first instead). Null under the limit or with it off. */
export function focusStartBlock(focus: { limit: number | null; count: number; mode: 'nudge' | 'strict' }): string | null {
  return focus.limit !== null && focus.count >= focus.limit && focus.mode === 'strict' ? "You're at your focus limit. Finish or settle a session first." : null;
}

type KeyPress = Parameters<typeof matches>[0];

/**
 * What a key in the message box sends: the second action's shortcut first (⌘⇧↵ Add to queue, which
 * also holds ⌘↵), then Send (↵ or ⌘↵). Null for anything else, such as ⇧↵ for a new line.
 */
export function submitKey(event: KeyPress, secondary?: ShortcutId): 'secondary' | 'send' | null {
  if (secondary && matches(event, secondary)) return 'secondary';
  if (matches(event, 'composer.send')) return 'send';
  return null;
}
