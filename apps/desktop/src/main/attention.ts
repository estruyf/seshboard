import type { ChecksFinished, HostState, LiveSession, PermissionRequest, SessionHostInfo, TerminalInfo } from '@seshboard/protocol/client';

export interface AttentionEvent {
  kind: 'needs-you' | 'finished' | 'failed' | 'action-done' | 'resumed' | 'checks-failed' | 'checks-passed' | 'cache-expiring' | 'queue-started' | 'queue-skipped' | 'schedule-started' | 'schedule-queued' | 'schedule-skipped' | 'trigger-started' | 'trigger-paused' | 'pipeline-stopped' | 'pipeline-done';
  sessionId: string;
  title: string;
  body: string;
  /** Where the session ran (a finished turn): the queue's hint looks for what waits on its project. */
  cwd?: string | null;
  /** A scheduled run that didn't start (queued, skipped, failed): a click opens Upcoming with that schedule's run in view. */
  scheduleId?: string;
  /** A trigger's news without a session (an issue picked up, a pause): a click opens this project on its Triggers tab. */
  triggerRoot?: string;
}

/** A folder's name, from a `/` or a Windows `\` path. */
const basename = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

/**
 * Decides when Seshboard should get your attention. Pure, so it is tested
 * without Electron; main turns events into notifications and the badge (the Dock, or the taskbar on Windows).
 *
 * - Sessions running in Seshboard: needs approval, turn finished, failed.
 * - Terminal (CLI) sessions waiting for you, when the sidebar lists sessions from
 *   other apps. Claude desktop and IDE sessions are skipped: they notify on their own.
 * - Project actions that finish.
 * - The checks of a session's pull request that finish.
 */
export class Attention {
  private readonly hostStates = new Map<string, HostState>();
  private readonly pending = new Map<string, PermissionRequest>();
  private readonly cliWaiting = new Set<string>();
  private readonly terminalExit = new Map<string, number | null>();
  private readonly titles = new Map<string, string>();

  /** `external`: whether sessions from other apps are shown (Settings); off, Terminal sessions are left alone. */
  constructor(private readonly options: { external?: () => boolean } = {}) {}

  setTitle(sessionId: string, title: string): void {
    this.titles.set(sessionId, title);
  }

  label(sessionId: string, cwd: string | null): string {
    const title = this.titles.get(sessionId) ?? 'New session';
    return cwd ? `${title} · ${basename(cwd)}` : title;
  }

  onHost(info: SessionHostInfo): AttentionEvent[] {
    const previous = this.hostStates.get(info.sessionId);
    this.hostStates.set(info.sessionId, info.state);
    const busy = previous === 'running' || previous === 'needs-you';
    // A usage limit stopped the turn: it didn't finish, and it can't go on until the limit resets.
    if (busy && info.state === 'idle' && info.usageLimit?.sessionIds.includes(info.sessionId)) {
      return [{ kind: 'failed', sessionId: info.sessionId, title: 'Usage limit reached', body: this.label(info.sessionId, info.cwd) }];
    }
    if (busy && info.state === 'idle') {
      return [{ kind: 'finished', sessionId: info.sessionId, title: 'Claude finished', body: this.label(info.sessionId, info.cwd), cwd: info.cwd }];
    }
    if (info.state === 'error' && previous !== 'error') {
      return [{ kind: 'failed', sessionId: info.sessionId, title: 'Claude Code stopped with an error', body: info.error ?? this.label(info.sessionId, info.cwd) }];
    }
    return [];
  }

  onPermission(request: PermissionRequest): AttentionEvent[] {
    this.pending.set(request.requestId, request);
    const what = request.toolName === 'AskUserQuestion' ? 'Claude has a question' : request.toolName === 'ExitPlanMode' ? 'Claude has a plan for you' : `Claude wants to use ${request.toolName}`;
    return [{ kind: 'needs-you', sessionId: request.sessionId, title: what, body: this.titles.get(request.sessionId) ?? 'Waiting for your approval' }];
  }

  /** A session armed with Resume when it resets was sent its message after the reset. */
  onResumed(sessionId: string): AttentionEvent[] {
    return [{ kind: 'resumed', sessionId, title: 'Resumed after the usage limit reset', body: this.titles.get(sessionId) ?? 'New session' }];
  }

  /** The checks of a session's pull request all finished, after some were running. */
  onChecksFinished(event: ChecksFinished): AttentionEvent[] {
    const failed = event.outcome === 'fail';
    const counts = failed ? `${event.failed} of ${event.total} ${event.total === 1 ? 'check' : 'checks'} failed` : `${event.total === 1 ? 'The check' : `All ${event.total} checks`} passed`;
    return [
      {
        kind: failed ? 'checks-failed' : 'checks-passed',
        sessionId: event.sessionId,
        title: `Checks ${failed ? 'failed' : 'passed'} on PR #${event.pr.number}`,
        body: `${counts} · ${this.titles.get(event.sessionId) ?? event.branch}`,
      },
    ];
  }

  onPermissionResolved(requestId: string): void {
    this.pending.delete(requestId);
  }

  onLive(live: LiveSession[]): AttentionEvent[] {
    const events: AttentionEvent[] = [];
    const now = new Set<string>();
    const external = this.options.external?.() ?? true;
    for (const session of live) {
      if (!external) break;
      if (session.origin !== 'cli' || session.status !== 'needs-you') continue;
      now.add(session.sessionId);
      if (!this.cliWaiting.has(session.sessionId)) {
        events.push({ kind: 'needs-you', sessionId: session.sessionId, title: 'Claude is waiting for you in Terminal', body: this.label(session.sessionId, session.cwd) });
      }
    }
    this.cliWaiting.clear();
    for (const id of now) this.cliWaiting.add(id);
    return events;
  }

  onTerminals(terminals: TerminalInfo[]): AttentionEvent[] {
    const events: AttentionEvent[] = [];
    const seen = new Set<string>();
    for (const t of terminals) {
      seen.add(t.id);
      const before = this.terminalExit.get(t.id);
      this.terminalExit.set(t.id, t.exitCode);
      if (t.kind === 'action' && before === null && t.exitCode !== null && t.sessionId) {
        events.push({
          kind: 'action-done',
          sessionId: t.sessionId,
          title: t.exitCode === 0 ? `${t.title} finished` : `${t.title} failed (exit ${t.exitCode})`,
          body: basename(t.cwd),
        });
      }
    }
    for (const id of [...this.terminalExit.keys()]) if (!seen.has(id)) this.terminalExit.delete(id);
    return events;
  }

  /** Sessions waiting on you: open prompts in Seshboard plus terminal sessions waiting. */
  badge(): number {
    const sessions = new Set<string>([...this.pending.values()].map((p) => p.sessionId));
    for (const id of this.cliWaiting) sessions.add(id);
    return sessions.size;
  }

  /** After an engine restart, state is rebuilt from the fresh snapshot. */
  reset(): void {
    this.hostStates.clear();
    this.pending.clear();
    this.cliWaiting.clear();
    this.terminalExit.clear();
  }
}
