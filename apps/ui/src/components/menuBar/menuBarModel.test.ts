import { describe, expect, it } from 'vitest';
import type { CatchUp, LiveSession, PermissionRequest, ProjectInfo } from '@seshboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { canAllow, FINISHED_SHOWN, menuBarRows, nextRow, wantsLabel } from './menuBarModel.ts';

const NOW = 1_000_000_000;
const live = (status: LiveSession['status'], startedAt = NOW - 6 * 60_000) => ({ status, startedAt }) as LiveSession;
const row = (id: string, extra: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: `Title ${id}`,
  projectRoot: '/p/demo-time',
  updatedAt: NOW - 60_000,
  branch: null,
  isWorktree: false,
  live: null,
  summary: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
  ...extra,
});
const request = (sessionId: string, extra: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: `r-${sessionId}`,
  sessionId,
  toolName: 'Bash',
  toolUseId: null,
  input: { command: 'npm test' },
  title: 'Claude wants to run npm test',
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt: NOW - 1000,
  ...extra,
});
const rows = (input: Partial<Parameters<typeof menuBarRows>[0]>) =>
  menuBarRows({ rows: [], permissions: [], catchUps: new Map(), projectName: (root) => root.split('/').pop()!, now: NOW, ...input });

describe('menuBarRows', () => {
  it('puts what needs you first, with what it wants, then what works, then what finished', () => {
    const result = rows({
      rows: [row('done', { unread: true }), row('work', { live: live('running'), workingSince: NOW - 6 * 60_000 }), row('wait', { live: live('needs-you') })],
      permissions: [request('wait')],
    });
    expect(result.map((r) => [r.section, r.id])).toEqual([
      ['needs-you', 'wait'],
      ['working', 'work'],
      ['finished', 'done'],
    ]);
    expect(result[0]).toMatchObject({ detail: 'Wants to run npm test', allowable: true });
    expect(result[1]).toMatchObject({ detail: '6m · demo-time', age: '6m' });
  });

  it('leaves out archived sessions and those on other computers', () => {
    const result = rows({ rows: [row('a', { unread: true, archivedAt: 1 }), row('b', { unread: true, remote: { computerId: 'c' } as SessionRowData['remote'] })] });
    expect(result).toEqual([]);
  });

  it('shows the newest five finished, unread sessions with the review hint', () => {
    const many = Array.from({ length: 8 }, (_, i) => row(`f${i}`, { unread: true, updatedAt: NOW - i * 60_000 }));
    const card = { sessionId: 'f0', need: { kind: 'none' }, reviewMinutes: 0 } as unknown as CatchUp;
    const result = rows({ rows: many, catchUps: new Map([['f0', card]]) });
    expect(result).toHaveLength(FINISHED_SHOWN);
    expect(result.map((r) => r.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(result[0]!.detail).toBe('Nothing to review · now');
    expect(result[1]!.detail).toBe('demo-time · 1m');
  });

  it('is empty with nothing running and nothing unread', () => {
    expect(rows({ rows: [row('idle')] })).toEqual([]);
  });
});

describe('wantsLabel', () => {
  it('says what a prompt wants in a few words', () => {
    expect(wantsLabel(request('a'))).toBe('Wants to run npm test');
    expect(wantsLabel(request('a', { toolName: 'Edit', input: {}, title: 'Claude wants to edit src/app.ts' }))).toBe('Wants to edit src/app.ts');
    expect(wantsLabel(request('a', { toolName: 'WebFetch', input: {}, title: null }))).toBe('Wants to use WebFetch');
    expect(wantsLabel(request('a', { toolName: 'AskUserQuestion' }))).toBe('Has a question');
    expect(wantsLabel(null)).toBe('Waiting for you');
  });

  it('offers Allow only for a permission, not a question or a plan', () => {
    expect(canAllow(request('a'))).toBe(true);
    expect(canAllow(request('a', { toolName: 'AskUserQuestion' }))).toBe(false);
    expect(canAllow(request('a', { toolName: 'ExitPlanMode' }))).toBe(false);
    expect(canAllow(null)).toBe(false);
  });
});

describe('nextRow', () => {
  it('moves with the arrows and stays at the ends', () => {
    expect(nextRow(3, 0, 'ArrowDown')).toBe(1);
    expect(nextRow(3, 2, 'ArrowDown')).toBe(2);
    expect(nextRow(3, 0, 'ArrowUp')).toBe(0);
    expect(nextRow(3, 1, 'End')).toBe(2);
    expect(nextRow(0, 0, 'ArrowDown')).toBe(-1);
  });
});
