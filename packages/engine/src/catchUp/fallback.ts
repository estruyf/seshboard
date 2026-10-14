import type { CatchUp, CatchUpNeedKind, PermissionRequest } from '@switchboard/protocol';
import type { Signals } from './signals.ts';
import { isTestCommand } from './testCommands.ts';
import { EDIT_TOOLS, oneLine, type ToolCall, type Turn } from './turn.ts';

export type Need = CatchUp['need'];

/** What a summary adds to the signals: the lines of the card and what it asks of you. */
export interface Summary {
  did: string[];
  skipped: string[];
  need: Need;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The last part of a path, as a file's name. */
const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** Commands that only look around: they say nothing about what was done. */
const LOOKING = /^(cd|ls|cat|pwd|echo|head|tail|wc|grep|rg|find|fd|tree|which|file|stat|sed\s+-n|git\s+(status|diff|log|show|branch|rev-parse|ls-files|blame))(\s|$)/;

/** A failing run in words: "npm run lint failed (exit 2)". */
const failedLine = (call: ToolCall) => `${oneLine(call.command ?? call.name, 80)} failed${call.exitCode && call.exitCode !== 1 ? ` (exit ${call.exitCode})` : ''}`;

/** The test chip's words, also used in the need's text: "14 tests passed", "2 of 9 tests fail". */
export function testsText(tests: Signals['tests']): string {
  if (tests.state === 'notRun') return 'No tests run';
  if (tests.state === 'passed') return tests.passed ? `${plural(tests.passed, 'test')} passed` : 'Tests passed';
  const total = (tests.passed ?? 0) + (tests.failed ?? 0);
  return tests.failed ? `${tests.failed} of ${total} ${total === 1 ? 'test fails' : 'tests fail'}` : 'Tests failed';
}

/** Whether Claude's last reply ends by asking you something. */
export function asksBack(finalText: string): string | null {
  const paragraphs = finalText.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paragraphs.at(-1)?.replace(/[*_`]+/g, '').trim() ?? '';
  if (!last.endsWith('?')) return null;
  const sentences = last.split(/(?<=[.!?])\s+/);
  return sentences.at(-1) ?? last;
}

/**
 * The kind of next step the rules give for a finished turn: a failure or failing tests, or a question back to you, needs
 * a reply; files outside the scope need a review (in git); a clean finish with changes is ready to commit; one without
 * changes needs nothing.
 */
export function needKind(input: { state: 'finished' | 'error'; signals: Signals; asksBack: boolean }): CatchUpNeedKind {
  const { signals } = input;
  if (input.state === 'error' || signals.tests.state === 'failed' || input.asksBack) return 'reply';
  // A review happens in the Changes panel, which needs git.
  if (signals.outOfScope.length > 0 && signals.diff !== null) return 'review';
  if (signals.diff && signals.diff.files > 0) return 'commit';
  return 'none';
}

/** "2 files outside apps/ui", "1 file outside the plan": the out-of-scope chip, and the review's reason. */
export function outsideText(signals: Signals): string {
  const where = signals.scope ?? (signals.plan !== null ? 'the plan' : 'the project');
  return `${plural(signals.outOfScope.length, 'file')} outside ${where}`;
}

/** The title and text the rules give a finished turn's next step. */
export function needOf(kind: CatchUpNeedKind, context: { signals: Signals; question: string | null; error: string | null }): Need {
  const { signals } = context;
  switch (kind) {
    case 'reply':
      if (context.error !== null) return { kind, title: 'Claude stopped with an error', text: oneLine(`${context.error.replace(/[.\s]*$/, '.')} Tell Claude how to go on.`, 400) };
      if (signals.tests.state === 'failed') return { kind, title: 'Decide about the failing tests', text: `${testsText(signals.tests)}. Tell Claude how to go on.` };
      return { kind, title: 'Answer Claude’s question', text: oneLine(context.question ?? 'Claude asked you something at the end of its reply.', 400) };
    case 'review':
      return { kind, title: 'Review the changes', text: `${outsideText(signals)}. Look at them before you commit.` };
    case 'commit':
      return {
        kind,
        title: 'Commit the changes',
        text: signals.tests.state === 'passed' ? 'Tests pass. Ready to commit.' : 'No tests ran. Look over the changes, then commit.',
      };
    default:
      return { kind: 'none', title: 'Nothing to do', text: 'Claude finished without changing files.' };
  }
}

/**
 * The card's lines without a model, from the turn's tool calls: what was edited and run (`did`), and what failed or you
 * declined (`skipped`). `need` follows the rules above.
 */
export function fallbackSummary(turn: Turn, signals: Signals, outcome: { state: 'finished' | 'error'; error: string | null }): Summary {
  const did: string[] = [];
  const edited = [...new Set(turn.tools.filter((t) => EDIT_TOOLS.has(t.name) && t.file && t.exitCode === 0).map((t) => t.file!))];
  if (edited.length === 1) did.push(`Edited ${nameOf(edited[0]!)}`);
  else if (edited.length > 1) did.push(`Edited ${edited.length} files`);
  const commands = turn.tools.filter((t) => t.command && !t.declined && t.exitCode !== null && !LOOKING.test(t.command.trim()));
  // The test run counts once, as the last one; other commands in the order they ran, each once.
  const ran = [...new Set(commands.map((t) => oneLine(t.command!, 80)))];
  for (const command of ran.slice(-3)) did.push(`Ran ${command}`);
  const agents = turn.tools.filter((t) => t.name === 'Task' || t.name === 'Agent').length;
  if (agents) did.push(`Ran ${plural(agents, 'subagent')}`);
  const looked = new Set(turn.tools.filter((t) => t.name === 'Read' && t.file).map((t) => t.file));
  if (looked.size && did.length < 4) did.push(`Read ${plural(looked.size, 'file')}`);
  if (turn.tools.some((t) => t.name === 'WebSearch' || t.name === 'WebFetch') && did.length < 5) did.push('Looked things up on the web');
  // Only looking around so far (ls, cat, git status): say so, not how many tools that took.
  if (did.length === 0) did.push(turn.tools.length ? 'Looked through the project' : 'Answered without running any tools');

  const skipped: string[] = [];
  if (outcome.state === 'error') skipped.push(oneLine(`Stopped with an error${outcome.error ? `: ${outcome.error}` : ''}`, 200));
  for (const call of turn.tools) {
    if (skipped.length === 3) break;
    if (call.declined) skipped.push(oneLine(`You declined ${call.command ?? call.name}`, 200));
    // A command that only looks around failing (`ls tests` where there is none) is no unfinished work.
    else if (call.exitCode !== null && call.exitCode !== 0 && call.command && !isTestCommand(call.command) && !LOOKING.test(call.command.trim())) skipped.push(failedLine(call));
  }
  if (signals.tests.state === 'failed' && skipped.length < 3) skipped.push(testsText(signals.tests));

  const question = asksBack(turn.finalText);
  const kind = needKind({ state: outcome.state, signals, asksBack: question !== null });
  return { did: did.slice(0, 5), skipped, need: needOf(kind, { signals, question, error: outcome.state === 'error' ? (outcome.error ?? 'The turn ended with an error.') : null }) };
}

/** What a waiting session asks, from the request itself (never a model): a question, a plan to approve, or a tool to allow. */
export function waitingNeed(request: Pick<PermissionRequest, 'toolName' | 'input' | 'title'>): Need {
  const input = (request.input ?? {}) as { questions?: Array<{ question?: unknown }>; command?: unknown };
  if (request.toolName === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const first = typeof questions[0]?.question === 'string' ? questions[0].question : 'Claude has a question for you.';
    const more = questions.length > 1 ? ` (and ${plural(questions.length - 1, 'more question')})` : '';
    return { kind: 'question', title: 'Answer a question', text: oneLine(`${first}${more}`, 400) };
  }
  if (request.toolName === 'ExitPlanMode') return { kind: 'permission', title: 'Approve the plan', text: 'Claude has a plan. Ready to start?' };
  if (request.toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : null;
    return { kind: 'permission', title: 'Allow a command', text: oneLine(request.title ?? (command ? `Claude wants to run ${command}` : 'Claude wants to run a command'), 400) };
  }
  return { kind: 'permission', title: `Allow ${request.toolName}`, text: oneLine(request.title ?? `Claude wants to use ${request.toolName}`, 400) };
}
