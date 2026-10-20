import type { CatchUp, HostState, PermissionRequest } from '@switchboard/protocol';

/**
 * When a paired phone gets a push, and what it says. Pure, so it is tested without a push service: a session starts
 * needing you (a new prompt), or a turn ends (a session this app runs goes from working to idle), the same moments as
 * Settings › Notifications on the computer.
 */

/** What a push carries: small, and encrypted for the phone's browser. */
export interface PushPayload {
  kind: 'needs-you' | 'finished';
  sessionId: string;
  title: string;
  project: string;
  /** The Claude profile's name, only with more than one profile ("Work"): the notification starts with it. */
  profile?: string;
  /** "Allow Bash: npm publish --tag beta", or "14 tests passed · ~2 min to review". */
  line: string;
  /** A tool prompt: the notification offers Deny and Allow where the browser has buttons, and answers this request. */
  requestId?: string;
  answers?: boolean;
  /** The device it goes to, as this computer knows it: a phone paired with more than one computer finds which one sent it. */
  deviceId?: string;
  /** The label the device asked for (this computer's name), only from a device paired with more than one computer. */
  computer?: string;
}

/**
 * A tool prompt can be answered from the notification (Deny, Allow); a question or a plan needs its session, where
 * there is room to read it.
 */
export function promptAnswers(request: Pick<PermissionRequest, 'requestId' | 'toolName'>): { requestId: string; answers: boolean } {
  return { requestId: request.requestId, answers: request.toolName !== 'AskUserQuestion' && request.toolName !== 'ExitPlanMode' };
}

const short = (text: string, max = 120) => {
  const line = text.split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** What a prompt asks, in one line. */
export function needsYouLine(request: Pick<PermissionRequest, 'toolName' | 'input'>): string {
  const input = (request.input ?? {}) as Record<string, unknown>;
  if (request.toolName === 'AskUserQuestion') {
    const first = (input.questions as Array<{ question?: unknown }> | undefined)?.find((q) => typeof q?.question === 'string')?.question;
    return typeof first === 'string' ? short(`Question: ${first}`) : 'Claude has a question';
  }
  if (request.toolName === 'ExitPlanMode') return 'Claude has a plan. Ready to start?';
  const subject = ['command', 'file_path', 'notebook_path', 'url', 'pattern', 'query'].map((key) => input[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return short(subject ? `Allow ${request.toolName}: ${subject}` : `Allow ${request.toolName}?`);
}

/** A finished turn in one line, from its catch-up when there is one: the tests, and how long it takes to review. */
export function finishedLine(card: CatchUp | null): string {
  if (!card) return 'Claude finished a turn.';
  const { tests } = card.signals;
  const parts = [
    tests.state === 'passed' ? (tests.passed ? `${tests.passed} ${tests.passed === 1 ? 'test' : 'tests'} passed` : 'Tests passed') : tests.state === 'failed' ? (tests.failed ? `${tests.failed} ${tests.failed === 1 ? 'test fails' : 'tests fail'}` : 'Tests failed') : null,
    card.need.kind === 'none' ? 'Nothing to review' : `~${card.reviewMinutes} min to review`,
  ].filter((part): part is string => Boolean(part));
  return card.state === 'error' ? ['Finished with errors', ...parts].join(' · ') : parts.join(' · ');
}

/** Turns host states into "this turn just ended", as the computer's notifications do. */
export class TurnEnds {
  private readonly states = new Map<string, HostState>();

  /** True when this state ends a turn: from working or waiting to idle. */
  ended(sessionId: string, state: HostState): boolean {
    const before = this.states.get(sessionId);
    this.states.set(sessionId, state);
    if (state === 'closed') this.states.delete(sessionId);
    return (before === 'running' || before === 'needs-you') && state === 'idle';
  }
}

/** Which devices get a push: subscribed to that kind, and without the app open on screen right now. */
export function pushTargets<T extends { deviceId: string; needsYou: boolean; finished: boolean }>(subscriptions: readonly T[], kind: PushPayload['kind'], visible: ReadonlySet<string>, known: ReadonlySet<string>): T[] {
  return subscriptions.filter((s) => known.has(s.deviceId) && !visible.has(s.deviceId) && (kind === 'needs-you' ? s.needsYou : s.finished));
}
