import { describe, expect, it } from 'vitest';
import type { SessionHostInfo } from '@switchboard/protocol/client';
import { restartAsNew } from './restartAsNew.ts';

const host = (over: Partial<SessionHostInfo> = {}): SessionHostInfo => ({
  sessionId: 's1',
  cwd: '/work/acme-store',
  state: 'error',
  model: 'claude-opus-4-1',
  permissionMode: 'acceptEdits',
  effort: 'high',
  costUsd: 0,
  contextPercent: null,
  contextTokens: null,
  contextMax: null,
  error: 'Not logged in · Please run /login',
  startedAt: 1,
  promptedAt: 1,
  queue: [],
  queueHold: null,
  profileId: 'work',
  backgroundTasks: [],
  ...over,
});

const fresh = { hasTranscript: false, openElsewhere: false };

describe('restartAsNew', () => {
  it('starts a session that failed before writing a transcript again, as it was', () => {
    expect(restartAsNew(host(), fresh)).toEqual({
      cwd: '/work/acme-store',
      choices: { model: 'claude-opus-4-1', permissionMode: 'acceptEdits', effort: 'high', workspace: 'current', baseRef: 'fresh', branch: '' },
      worktree: false,
      currentBranch: null,
      profileId: 'work',
    });
  });

  it('keeps the defaults when the session had no model or effort of its own', () => {
    expect(restartAsNew(host({ model: null, effort: null, state: 'closed' }), fresh)?.choices).toMatchObject({ model: '', effort: '' });
  });

  it('leaves sessions that can be resumed alone', () => {
    expect(restartAsNew(undefined, fresh)).toBeNull();
    expect(restartAsNew(host({ state: 'idle' }), fresh)).toBeNull();
    expect(restartAsNew(host({ state: 'running' }), fresh)).toBeNull();
    expect(restartAsNew(host(), { hasTranscript: true, openElsewhere: false })).toBeNull();
    expect(restartAsNew(host(), { hasTranscript: false, openElsewhere: true })).toBeNull();
  });
});
