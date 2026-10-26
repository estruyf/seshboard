import type { BackgroundTask } from '@seshboard/protocol/client';
import type { DisplayItem } from './displayItems.ts';
import type { ToolItem } from './ToolDetails.tsx';
import type { AgentTokens } from './turns.ts';

const isAgent = (item: DisplayItem): item is ToolItem => item.kind === 'tool' && !item.subagent && (item.name === 'Agent' || item.name === 'Task');

export interface AgentRun {
  item: ToolItem;
  running: boolean;
  /** It ended without finishing: its call returned an error, or its last report says it failed or was stopped (the usage limit, Stop). Never while it runs. */
  failed: boolean;
  /** Launched in the background (the call returns at once; the agent reports back later). */
  background: boolean;
  /** Claude Code's id for a background agent, from the launch's result: the id its background task has too. */
  agentId: string | null;
  /** The agent type (`general-purpose`, `Explore`…), null when the call named none. */
  type: string | null;
  /** What the agent was asked to do, in a few words. */
  what: string;
  /** The full instruction it was given. */
  prompt: string | null;
  /** The model the call asked for (`sonnet`, `opus`…), null when it left it to the agent type or the session's model. */
  asked: string | null;
  /** What it reported back, once done: the call's result, or a background agent's hand-back. */
  report: string | null;
}

/** An agent's type, short description and full prompt, from the call that started it. */
export function describeAgent(item: ToolItem): Pick<AgentRun, 'type' | 'what' | 'prompt' | 'asked'> {
  const input = (item.input ?? {}) as { description?: unknown; subagent_type?: unknown; prompt?: unknown; model?: unknown };
  const prompt = typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt : null;
  return {
    type: typeof input.subagent_type === 'string' && input.subagent_type ? input.subagent_type : null,
    what: typeof input.description === 'string' ? input.description : prompt ? prompt.slice(0, 100) : 'Agent',
    prompt,
    asked: typeof input.model === 'string' && input.model.trim() ? input.model : null,
  };
}

/** The model an agent runs on: the one its replies used, else the one the call asked for. Null before it has replied and when the call left it open. */
export function agentModel(run: AgentRun, usage: AgentTokens | undefined): string | null {
  return usage?.model ?? run.asked;
}

/** A message to the agent with this id (`SendMessage`), which wakes it up again when it had stopped. Failed sends don't. */
const isMessageTo = (item: DisplayItem, agentId: string) => {
  if (item.kind !== 'tool' || item.name !== 'SendMessage' || item.result?.isError) return false;
  const input = (item.input ?? {}) as { to?: unknown; recipient?: unknown };
  return input.to === agentId || input.recipient === agentId;
};

/**
 * Every agent in a session and whether it's still working. A foreground agent runs until its
 * call returns; a background one until its report comes back, and again from a message sent to
 * it after that (a resume after the usage limit stopped it, or more work for one that finished).
 * Nothing runs in a closed session.
 */
export function agentRuns(items: readonly DisplayItem[], sessionOpen: boolean): AgentRun[] {
  return items.filter(isAgent).map((item) => {
    const launched = !!item.result && /Async agent launched/.test(item.result.text);
    const agentId = launched ? (/agentId: (\w+)/.exec(item.result!.text)?.[1] ?? null) : null;
    // Reported back by agent id (hand-backs) or by the call's id (task notifications).
    const from = items.indexOf(item);
    const reports = launched ? items.filter((i, at): i is Extract<DisplayItem, { kind: 'agent-report' }> => at > from && i.kind === 'agent-report' && (i.toolUseId === item.id || (agentId !== null && i.agentId === agentId))) : [];
    const lastReport = reports.length > 0 ? items.lastIndexOf(reports[reports.length - 1]!) : -1;
    const resumed = agentId !== null && items.some((i, at) => at > lastReport && at > from && isMessageTo(i, agentId));
    const working = item.result === null || (launched && (lastReport === -1 || resumed));
    const report = launched ? (reports[reports.length - 1]?.text ?? null) : (item.result?.text ?? null);
    const running = sessionOpen && working;
    const failed = !working && (launched ? reports.length > 0 && reports[reports.length - 1]!.status !== 'completed' : (item.result?.isError ?? false));
    return { item, background: launched, running, failed, agentId, ...describeAgent(item), report };
  });
}

/** The run a background task (the bottom strip's list) stands for: by Claude Code's id, else by its description. */
export function agentForTask(task: BackgroundTask, runs: readonly AgentRun[]): AgentRun | undefined {
  const own = runs.find((run) => run.agentId !== null && run.agentId === task.taskId);
  if (own) return own;
  const sameWords = runs.filter((run) => run.background && run.running && run.what === task.description);
  return sameWords.length === 1 ? sameWords[0] : undefined;
}

/** The task that keeps a background agent running, which a Stop button ends. Foreground agents have none. */
export function taskForAgent(run: AgentRun, tasks: readonly BackgroundTask[]): BackgroundTask | undefined {
  if (!run.background || !run.running) return undefined;
  return tasks.find((task) => agentForTask(task, [run]) === run);
}

/** Running agents first, each group newest first as given. */
export function splitAgents(runs: readonly AgentRun[]): { active: AgentRun[]; finished: AgentRun[] } {
  return { active: runs.filter((run) => run.running), finished: runs.filter((run) => !run.running) };
}

/** The agent the panel shows: the one picked if it is still there, else the newest running one, else the newest. */
export function shownAgent(runs: readonly AgentRun[], picked: string | null): AgentRun | undefined {
  return runs.find((run) => run.item.id === picked) ?? runs.find((run) => run.running) ?? runs[0];
}
