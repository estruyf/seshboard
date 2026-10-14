import { describe, expect, it } from 'vitest';
import type { PermissionRequest, SessionHostInfo, SessionSummary } from '@switchboard/protocol/client';
import { focusSessions } from '../../state/focus.ts';
import { patchedSessions } from '../../state/sessionChanges.ts';
import { DECLINED, permissionDecisions } from '../session/permissionDecisions.ts';

const NOW = Date.UTC(2026, 9, 14, 12);

const summary = (id: string, patch: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  title: id,
  firstPrompt: null,
  customTitle: null,
  cwd: `/work/${id}`,
  projectRoot: `/work/${id}`,
  gitBranch: null,
  worktree: null,
  origin: 'app',
  createdAt: NOW - 3_600_000,
  updatedAt: NOW - 60_000,
  fileSize: null,
  tag: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  viewedAt: null,
  unread: true,
  inApp: true,
  profileId: 'default',
  ...patch,
});

const idle = (sessionId: string): SessionHostInfo => ({
  sessionId,
  cwd: `/work/${sessionId}`,
  state: 'idle',
  model: null,
  permissionMode: 'default',
  effort: null,
  costUsd: 0,
  contextPercent: null,
  contextTokens: null,
  contextMax: null,
  error: null,
  startedAt: NOW - 3_600_000,
  promptedAt: null,
  queue: [],
  queueHold: null,
  profileId: 'default',
  backgroundTasks: [],
});

const count = (sessions: Map<string, SessionSummary>) =>
  focusSessions({ hosts: new Map([['a', idle('a')], ['b', idle('b')]]), live: new Map(), sessions, countExternal: false }).length;

describe('the catch-up and the focus limit', () => {
  const sessions = new Map([
    ['a', summary('a')],
    ['b', summary('b')],
  ]);

  it('Mark as read takes the session off your mind at once', () => {
    expect(count(sessions)).toBe(2);
    expect(count(patchedSessions(sessions, 'a', { unread: false, viewedAt: NOW }))).toBe(1);
  });

  it('Archive does too', () => {
    expect(count(patchedSessions(sessions, 'b', { archivedAt: NOW, unread: false }))).toBe(1);
  });

  it('leaves the sessions alone for one it doesn’t know', () => {
    expect(patchedSessions(sessions, 'x', { unread: false })).toBe(sessions);
  });
});

describe('answering from the catch-up', () => {
  const request = { input: { questions: [{ question: 'Which easing?', options: [{ label: 'Ease out' }] }] } } as Pick<PermissionRequest, 'input'>;

  it('sends what the card above the message box sends', () => {
    expect(permissionDecisions.allow()).toEqual({ behavior: 'allow' });
    expect(permissionDecisions.deny()).toEqual({ behavior: 'deny', message: DECLINED });
    expect(permissionDecisions.deny('  use pnpm  ')).toEqual({ behavior: 'deny', message: 'use pnpm' });
    expect(permissionDecisions.answer(request, { 'Which easing?': 'Ease out' })).toEqual({
      behavior: 'allow',
      updatedInput: { questions: [{ question: 'Which easing?', options: [{ label: 'Ease out' }] }], answers: { 'Which easing?': 'Ease out' } },
    });
  });
});
