import type { DisplayItem, ReplyUsage } from './displayItems.ts';

/**
 * Turns: your prompt plus everything Claude did until it stopped and waited for you again. Pure, so the grouping and
 * the sums can be tested; `useTurns` keeps them up to date while Claude works without regrouping the whole
 * conversation for every message that lands.
 */

export type TurnOutcome = 'done' | 'stopped' | 'failed';

/** A turn's tokens: every reply in it, its subagents' included. */
export interface TurnTokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  /** API responses (Claude's and its subagents'). */
  replies: number;
  /** The model, when every reply used the same one. */
  model: string | null;
}

export interface Turn {
  /** The prompt's item key. */
  key: string;
  /** Where the turn starts and ends in the items (inclusive). */
  start: number;
  end: number;
  /** When you sent the prompt. */
  startedAt: number | null;
  /** When its last item was written (a tool's result, for a tool call). */
  endedAt: number | null;
  /** `endedAt` minus `startedAt`, waiting on you included. */
  durationMs: number | null;
  /** How long a permission prompt, question or plan waited on you in the turn; left out when it isn't known. */
  waitingMs?: number;
  outcome: TurnOutcome;
  /** Null when no reply in it reported usage (old sessions, other computers): no token part, never "0 tokens". */
  tokens: TurnTokens | null;
  /** The last reply of the turn, where its line goes; null when Claude didn't write one. */
  replyKey: string | null;
}

/** A permission prompt you answered: when it asked and when you answered, and the tool call it was about. */
export interface Wait {
  toolUseId: string | null;
  from: number;
  to: number;
}

/** The tokens of a subagent, from its own transcript (`transcript.agentUsage`). */
export interface AgentTokens {
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  replies: number;
}

/** What the transcript alone doesn't say about turns. */
export interface TurnContext {
  /** Permission prompts answered in this window. */
  waits?: readonly Wait[];
  /** Subagents' tokens by the tool call that started them. */
  agents?: ReadonlyMap<string, AgentTokens>;
}

/** A top-level prompt of yours, as the palette's digest counts them. Messages to subagents don't start a turn. */
export const isTurnPrompt = (item: DisplayItem) => item.kind === 'user' && !item.subagent;

/** Tools that only wait for your answer: the time between the call and its result is yours. */
const ASKS_YOU = new Set(['AskUserQuestion', 'ExitPlanMode']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);
/**
 * A prompt that lands this soon after Claude's last step, while Claude was mid-work, was steered (or queued) into the
 * turn rather than starting one. Claude Code writes such a message when it takes it, right after a tool's result;
 * a longer gap is a session that stopped mid-step (it quit or crashed) and a prompt sent later.
 */
const STEER_GAP_MS = 5 * 60_000;

const isSubagent = (item: DisplayItem) => ('subagent' in item && item.subagent) || (item.kind === 'thinking' && (item.usage?.agent ?? null) !== null);
const endOf = (item: DisplayItem) => (item.kind === 'tool' ? (item.result?.at ?? item.at) : item.at);
const isInterrupt = (item: DisplayItem) => item.kind === 'notice' && item.text === 'Interrupted by you';
/** What Claude did (or your stop): what a turn's end is. A local command (/model) and its output don't move it. */
const isClaudeWork = (item: DisplayItem) => item.kind === 'text' || item.kind === 'thinking' || item.kind === 'tool' || item.kind === 'agent-report';

/**
 * A slash command starts a turn only when Claude works on it (a skill, /review); one that Claude Code handles itself
 * (/model, /clear) doesn't start one, and belongs to the turn before it without moving its end.
 */
function commandTurn(items: readonly DisplayItem[], index: number): boolean {
  for (let i = index + 1; i < items.length; i++) {
    const item = items[i]!;
    if (isSubagent(item) || item.kind === 'notice') continue;
    return isClaudeWork(item);
  }
  return false;
}

const startsTurn = (items: readonly DisplayItem[], index: number) => isTurnPrompt(items[index]!) || (items[index]!.kind === 'command' && commandTurn(items, index));

/** Whether the prompt at `index` was sent while Claude was still working on the turn that runs from `start`. */
function steered(items: readonly DisplayItem[], start: number, index: number): boolean {
  for (let i = index - 1; i > start; i--) {
    const item = items[i]!;
    if (isSubagent(item) || startsTurn(items, i) || item.kind === 'command' || item.kind === 'user') continue;
    // Claude was between steps: a tool call, or thinking before the next one.
    if (item.kind !== 'tool' && item.kind !== 'thinking') return false;
    const last = endOf(item);
    const at = items[index]!.at;
    return last === null || at === null || at - last <= STEER_GAP_MS;
  }
  return false;
}

/** Where each turn starts and ends, from `from` on (the start of a turn), in the items. */
function spans(items: readonly DisplayItem[], from: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = from; i < items.length; i++) {
    const item = items[i]!;
    const open = out.at(-1);
    if (startsTurn(items, i) && !(open && steered(items, open[0], i))) out.push([i, i]);
    else if (open && !isSubagent(item)) open[1] = i;
  }
  return out;
}

const NO_CONTEXT: TurnContext = {};

/**
 * One turn's numbers, from its items. `until`: when the next turn started, the latest a permission prompt without a
 * tool call can have asked and still belong to this one.
 */
export function turnOf(items: readonly DisplayItem[], start: number, end: number, context: TurnContext = NO_CONTEXT, until = Infinity): Turn {
  const prompt = items[start]!;
  let endedAt: number | null = null;
  let replyKey: string | null = null;
  let lastReply: DisplayItem | null = null;
  let interruptedAfterReply = false;
  const seen = new Set<string>();
  const models = new Set<string | null>();
  const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, replies: 0 };
  const agentCalls: string[] = [];
  const asks: Wait[] = [];
  const toolIds = new Set<string>();

  const add = (usage: { input: number; output: number; cacheRead: number; cacheWrite: number }, replies: number, model: string | null) => {
    tokens.input += usage.input;
    tokens.output += usage.output;
    tokens.cacheRead += usage.cacheRead;
    tokens.cacheWrite += usage.cacheWrite;
    tokens.replies += replies;
    models.add(model);
  };

  for (let i = start; i <= end; i++) {
    const item = items[i]!;
    const usage: ReplyUsage | undefined = 'usage' in item ? item.usage : undefined;
    // A subagent's replies count through its own transcript once that's known; until then, as they stream in.
    if (usage && !seen.has(usage.id) && !(usage.agent !== null && context.agents?.has(usage.agent))) {
      seen.add(usage.id);
      add(usage, 1, usage.model);
    }
    if (item.kind === 'tool') toolIds.add(item.id);
    if (isSubagent(item)) continue;
    const at = isClaudeWork(item) || isInterrupt(item) ? endOf(item) : null;
    if (at !== null) endedAt = endedAt === null ? at : Math.max(endedAt, at);
    if (item.kind === 'text') {
      replyKey = item.key;
      lastReply = item;
      interruptedAfterReply = false;
    } else if (isInterrupt(item)) interruptedAfterReply = true;
    if (item.kind === 'tool') {
      if (AGENT_TOOLS.has(item.name)) agentCalls.push(item.id);
      if (ASKS_YOU.has(item.name) && item.at !== null && item.result?.at != null) asks.push({ toolUseId: item.id, from: item.at, to: item.result.at });
    }
  }

  for (const id of agentCalls) {
    const agent = context.agents?.get(id);
    if (agent) add(agent, agent.replies, agent.model);
  }

  // Waits: questions and plans from the transcript; permission prompts from this window's records, for a tool call of
  // this turn or (without one) one asked while it ran.
  const startedAt = prompt.at;
  const waits = [...asks];
  for (const wait of context.waits ?? []) {
    if (asks.some((a) => a.toolUseId === wait.toolUseId)) continue;
    const inTurn = wait.toolUseId !== null ? toolIds.has(wait.toolUseId) : startedAt !== null && wait.from >= startedAt && wait.from < until;
    if (inTurn) waits.push(wait);
  }
  const waitingMs = waits.length ? waits.reduce((sum, w) => sum + Math.max(0, w.to - w.from), 0) : undefined;

  const failed = lastReply?.kind === 'text' && lastReply.failed === true && !interruptedAfterReply;
  const total = tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output;
  return {
    key: prompt.key,
    start,
    end,
    startedAt,
    endedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null,
    ...(waitingMs !== undefined ? { waitingMs } : {}),
    outcome: interruptedAfterReply || (lastReply === null && hasInterrupt(items, start, end)) ? 'stopped' : failed ? 'failed' : 'done',
    tokens: tokens.replies > 0 ? { ...tokens, total, model: models.size === 1 ? [...models][0]! : null } : null,
    replyKey,
  };
}

function hasInterrupt(items: readonly DisplayItem[], start: number, end: number): boolean {
  for (let i = start; i <= end; i++) if (isInterrupt(items[i]!)) return true;
  return false;
}

/** Every turn of a conversation, in order. Items before the first prompt belong to none. */
export function buildTurns(items: readonly DisplayItem[], context: TurnContext = NO_CONTEXT): Turn[] {
  return turnsOf(items, spans(items, 0), context);
}

function turnsOf(items: readonly DisplayItem[], found: ReadonlyArray<[number, number]>, context: TurnContext): Turn[] {
  return found.map(([start, end], i) => turnOf(items, start, end, context, (found[i + 1] && items[found[i + 1]![0]]!.at) ?? Infinity));
}

/** The turns as `updateTurns` keeps them: with the items and context they were made from. */
export interface TurnsState {
  items: readonly DisplayItem[];
  context: TurnContext;
  turns: Turn[];
}

/**
 * The turns for new items, reusing what can't have changed: while Claude works, messages only land in the last turn,
 * so the earlier turns stay as they were and only the last one is grouped again. Anything else (a rewind, a
 * compaction, new waits or subagent tokens) groups everything again.
 */
export function updateTurns(previous: TurnsState | null, items: readonly DisplayItem[], context: TurnContext = NO_CONTEXT): TurnsState {
  const last = previous?.turns.at(-1);
  if (!previous || !last || previous.context !== context || items.length < previous.items.length || !samePrefix(previous.items, items, last.start)) {
    return { items, context, turns: buildTurns(items, context) };
  }
  const kept = previous.turns.slice(0, -1);
  const fresh = turnsOf(items, spans(items, last.start), context);
  return { items, context, turns: [...kept, ...fresh] };
}

/** The items up to and including `upTo` are the same messages (by key). */
function samePrefix(a: readonly DisplayItem[], b: readonly DisplayItem[], upTo: number): boolean {
  if (upTo >= a.length || upTo >= b.length) return false;
  for (let i = upTo; i >= 0; i--) if (a[i]!.key !== b[i]!.key) return false;
  return true;
}

/** Claude's own time in a turn: its duration without the time it waited on you. */
export const claudeMs = (turn: Pick<Turn, 'durationMs' | 'waitingMs'>): number | null => (turn.durationMs === null ? null : Math.max(0, turn.durationMs - (turn.waitingMs ?? 0)));

/**
 * The open turn while Claude works: how long Claude has worked on it (the time it waited on you left out, also a
 * prompt that waits now), and whether it waits on you now. `waitingSince`: when the prompt waiting now asked.
 */
export function liveTurn(turn: Pick<Turn, 'startedAt' | 'waitingMs'>, now: number, waitingSince: number | null): { workedMs: number | null; waiting: boolean } {
  if (turn.startedAt === null) return { workedMs: null, waiting: waitingSince !== null };
  const until = waitingSince !== null ? Math.max(turn.startedAt, Math.min(waitingSince, now)) : now;
  // Waits answered earlier in the turn; a prompt answered after its last item was written counts up to now.
  return { workedMs: Math.max(0, until - turn.startedAt - (turn.waitingMs ?? 0)), waiting: waitingSince !== null };
}
