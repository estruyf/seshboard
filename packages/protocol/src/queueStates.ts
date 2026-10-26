import type { LaterItem, QueueStarted, QueueWaitFor, SessionOutcome } from './later.ts';
import { safeLocale } from './locale.ts';
import { trimTrailingSeparators } from './paths.ts';
import type { UsageLimitHit } from './usageLimit.ts';

// The queue's states, without React, the stores or the engine: what each item waits for, whether that is busy, and
// whether an item that starts by itself may. Shared: the UI shows these states, and the engine uses the same rules to
// decide what starts (`QueueAutoStarter`). Nothing here starts anything.

/** How a queued item stands. `queued` is an item that waits for nothing: never ready, always startable. */
export type QueueStateKind = 'ready' | 'waiting' | 'queued';

/** A session as the queue sees it. */
export interface QueueSession {
  id: string;
  title: string;
  projectRoot: string;
  /** Starting, running or waiting for you: what the sidebar shows under Needs you and Working. */
  busy: boolean;
  /**
   * Where it runs when Seshboard doesn't run it: `terminal` (Claude Code in a terminal) or `app` (another app).
   * Seshboard sees such a session go idle, but not how its turn ended. Null for its own sessions and closed ones.
   */
  elsewhere?: 'terminal' | 'app' | null;
}

export interface QueueEntry {
  item: LaterItem;
  state: QueueStateKind;
  /**
   * In a few words, for the sidebar: why it is ready ("switchboard is free"), what it waits for ("after “Fix
   * the parser”", "starts after the item above", "switchboard has a session working"); null while queued.
   */
  label: string | null;
  /** The same for Home's longer line: "Ready: switchboard is free", "Waits for “Fix the parser”". Null while queued. */
  detail: string | null;
  /** The busy sessions it waits on: when one of them finishes and the item turns ready, that one is "the finished session". */
  blockers: string[];
  /** The state without the usage limit: an item at a limit is `waiting`, whatever this says. */
  baseState: QueueStateKind;
  /** It starts by itself: `autoStart` is on, it waits for something, and Seshboard can tell when that finishes. */
  autoStart: boolean;
  /** Why it can't start by itself (it waits for nothing, or for a session in the terminal); null when it can. */
  autoBlocked: string | null;
  /** Ready because this session finished, and how its turn ended (null when that isn't known). */
  finished: { sessionId: string; outcome: SessionOutcome | null } | null;
  /** Ready and would start by itself, but it waits: for a free slot under the focus limit, or for a usage limit. */
  hold: 'focus' | 'limit' | null;
}

export interface QueueInputs {
  /** The queue in order. */
  items: readonly LaterItem[];
  /** Started items and their sessions. */
  started: readonly QueueStarted[];
  /** The sessions the sidebar lists, with their live state. */
  sessions: readonly QueueSession[];
  /** A project's name for a folder. */
  projectName(root: string): string;
  /** The usage limit the item's Claude profile is at, or null: a session started there now would stop on it. */
  limitOf?(item: LaterItem): UsageLimitHit | null;
  /** The time, for whether a limit has reset. */
  now?: number;
  /** How a session's last turn ended (from the engine); null when it isn't known. */
  outcomeOf?(sessionId: string): SessionOutcome | null;
  /** Items the engine holds at the focus limit: ready, but waiting for a free slot. */
  focusHeld?: ReadonlySet<string>;
}

export interface QueueSummary {
  entries: QueueEntry[];
  readyCount: number;
  /** The first ready item in queue order, for "Start next in queue". */
  firstReady: QueueEntry | null;
}

/** A worktree inside a project (`<root>/.claude/worktrees/<name>/…`) counts as the project. */
export const projectOf = (path: string) => trimTrailingSeparators(path.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+.*$/, ''));

/** A prompt's first line, shortened for a label. */
export function promptLabel(prompt: string, max = 48): string {
  const line = prompt.trim().split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** "15:16" today, or "Mon 15:16" further away. `locale` is for tests; the app uses the system's. */
export function clockTime(at: number, now = Date.now(), locale?: string): string {
  locale = safeLocale(locale);
  const time = new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return sameDay ? time : `${new Date(at).toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
}

/** Whether a usage limit still holds by the clock (it has no reset time, or that is still ahead). */
/** Claude Code's limit kinds in plain words. */
const KIND_NAME: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly Opus limit',
  seven_day_sonnet: 'Weekly Sonnet limit',
  seven_day_overage_included: 'Weekly limit',
  overage: 'Extra usage limit',
};

/** "5-hour limit", "Weekly Opus limit"; "Usage limit" when Claude Code didn't say which. */
export function limitKindName(kind: string | null): string {
  return (kind && KIND_NAME[kind]) || 'Usage limit';
}

export const limitAhead = (limit: UsageLimitHit, now = Date.now()) => limit.resetsAt === null || limit.resetsAt > now;

const quoted = (text: string) => `“${text}”`;
const sessionTitle = (session: { title: string } | undefined) => promptLabel(session?.title || 'Untitled session');

/** What the row says for an item that waits for a free slot. */
export const FOCUS_HELD_LABEL = 'waits for a free slot (focus limit)';

/**
 * Why an item can't start by itself, or null when it can: it waits for nothing, or what it waits for runs outside
 * Seshboard, which sees it go idle but can't tell whether its turn ended cleanly. New session asks before the
 * item exists, with the wait it would get.
 */
export function autoStartBlock(waitFor: QueueWaitFor, inputs: { cwd: string; sessions: readonly QueueSession[]; started: readonly QueueStarted[] }): string | null {
  if (waitFor.kind === 'none') return 'Choose what it waits for first.';
  const byId = new Map(inputs.sessions.map((s) => [s.id, s]));
  const outside = (session: QueueSession | undefined) =>
    session?.elsewhere
      ? `${quoted(sessionTitle(session))} runs ${session.elsewhere === 'terminal' ? 'in the terminal' : 'in another app'}, so Seshboard can't tell when it finishes. Start this one yourself.`
      : null;
  switch (waitFor.kind) {
    case 'session':
      return outside(byId.get(waitFor.sessionId));
    case 'item': {
      const sessionId = inputs.started.find((s) => s.itemId === waitFor.itemId)?.sessionId;
      return sessionId ? outside(byId.get(sessionId)) : null;
    }
    case 'project': {
      const root = projectOf(inputs.cwd);
      const elsewhere = inputs.sessions.find((s) => s.busy && s.elsewhere && projectOf(s.projectRoot) === root);
      return outside(elsewhere);
    }
  }
}

/** Every item's state, in queue order, with how many are ready and the first of them. */
export function queueStates(inputs: QueueInputs): QueueSummary {
  const byId = new Map(inputs.sessions.map((s) => [s.id, s]));
  const busyIn = new Map<string, QueueSession[]>();
  for (const session of inputs.sessions) {
    if (!session.busy) continue;
    // A session in a worktree of the project counts for the project.
    const root = projectOf(session.projectRoot);
    const list = busyIn.get(root);
    if (list) list.push(session);
    else busyIn.set(root, [session]);
  }
  const startedAs = new Map(inputs.started.map((s) => [s.itemId, s.sessionId]));
  const index = new Map(inputs.items.map((item, i) => [item.id, i]));

  const entries = inputs.items.map((item, i): QueueEntry => {
    const name = inputs.projectName(item.cwd);
    const wait: QueueWaitFor = item.waitFor;
    const autoBlocked = autoStartBlock(wait, { cwd: item.cwd, sessions: inputs.sessions, started: inputs.started });
    const auto = item.autoStart && autoBlocked === null;
    // "starts after “Fix login”" for an item that starts by itself, "after “Fix login”" for one you start.
    const after = auto ? 'starts after' : 'after';
    const After = auto ? 'Starts after' : 'Waits for';
    type Base = Pick<QueueEntry, 'state' | 'label' | 'detail' | 'blockers' | 'finished'>;
    const ready = (label: string, finished: QueueEntry['finished'] = null): Base => ({ state: 'ready', label, detail: `Ready: ${label}`, blockers: [], finished });
    const onSession = (sessionId: string): Base => {
      const session = byId.get(sessionId);
      if (!session || !session.busy) {
        if (!session) return ready(`${name} is free`);
        const finished = { sessionId, outcome: inputs.outcomeOf?.(sessionId) ?? null };
        const title = quoted(sessionTitle(session));
        // It would have started by itself, but that session's turn didn't end cleanly.
        if (auto && finished.outcome === 'error') return ready(`${title} ended with an error, so it didn't start`, finished);
        if (auto && finished.outcome === 'stopped') return ready(`${title} was stopped, so it didn't start`, finished);
        return ready(`${title} finished`, finished);
      }
      const title = quoted(sessionTitle(session));
      return { state: 'waiting', label: `${after} ${title}`, detail: `${After} ${title}`, blockers: [sessionId], finished: null };
    };
    const base = ((): Base => {
      switch (wait.kind) {
        case 'none':
          return { state: 'queued', label: null, detail: null, blockers: [], finished: null };
        case 'project': {
          const busy = busyIn.get(projectOf(item.cwd)) ?? [];
          if (busy.length === 0) return ready(`${name} is free`);
          const blockers = busy.map((s) => s.id);
          if (auto) {
            const label = busy.length === 1 ? `starts after ${quoted(sessionTitle(busy[0]))}` : `starts when ${name} is free`;
            return { state: 'waiting', label, detail: label[0]!.toUpperCase() + label.slice(1), blockers, finished: null };
          }
          const label = busy.length === 1 ? `${name} has a session working` : `${name} has ${busy.length} sessions working`;
          const detail = busy.length === 1 ? `Waits for ${quoted(sessionTitle(busy[0]))}` : `Waits for ${busy.length} sessions in ${name}`;
          return { state: 'waiting', label, detail, blockers, finished: null };
        }
        case 'session':
          return onSession(wait.sessionId);
        case 'item': {
          const at = index.get(wait.itemId);
          if (at !== undefined) {
            // Still queued: it hasn't started, so this one can't follow it yet.
            const above = at === i - 1;
            const target = above ? 'the item above' : quoted(promptLabel(inputs.items[at]!.prompt));
            return { state: 'waiting', label: `${after} ${target}`, detail: `${After} ${target}`, blockers: [], finished: null };
          }
          const sessionId = startedAs.get(wait.itemId);
          // Removed without starting: there is nothing left to wait for.
          return sessionId ? onSession(sessionId) : ready('nothing to wait for');
        }
      }
    })();
    const entry: QueueEntry = { item, ...base, baseState: base.state, autoStart: auto, autoBlocked, hold: null };
    // Its profile is at a usage limit: it waits for the reset, whatever else it waits for.
    const limit = inputs.limitOf?.(item) ?? null;
    if (limit && limitAhead(limit, inputs.now)) {
      const at = limit.resetsAt === null ? null : clockTime(limit.resetsAt, inputs.now);
      return {
        ...entry,
        state: 'waiting',
        label: at ? `usage limit until ${at}` : 'usage limit',
        detail: at ? `Waits for the usage limit to reset at ${at}` : 'Waits for the usage limit to reset',
        hold: auto && base.state === 'ready' ? 'limit' : null,
      };
    }
    // Ready, but the engine keeps it until a slot frees under the focus limit.
    if (auto && base.state === 'ready' && inputs.focusHeld?.has(item.id)) {
      return { ...entry, state: 'waiting', label: FOCUS_HELD_LABEL, detail: 'Waits for a free slot (focus limit)', hold: 'focus' };
    }
    return entry;
  });
  const readyEntries = entries.filter((e) => e.state === 'ready');
  return { entries, readyCount: readyEntries.length, firstReady: readyEntries[0] ?? null };
}

/**
 * The words a screen reader says for an item's row: its prompt, then "Starts by itself after Fix login" for an item
 * that starts by itself, else what the row says.
 */
export function queueRowLabel(entry: QueueEntry): string {
  const prompt = promptLabel(entry.item.prompt, 80);
  if (entry.autoStart && entry.state === 'waiting') {
    if (entry.label?.startsWith('starts ')) return `${prompt}. Starts by itself ${entry.label.slice('starts '.length).replace(/[“”]/g, '')}`;
    return `${prompt}. Starts by itself, ${entry.label}`;
  }
  return entry.label ? `${prompt}. ${entry.label[0]!.toUpperCase()}${entry.label.slice(1)}` : prompt;
}
