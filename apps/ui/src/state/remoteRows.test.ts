import { describe, expect, it } from 'vitest';
import type { RemoteSession, RemoteSessions } from '@switchboard/protocol/client';
import {
  filterBySource,
  isRemoteProjectKey,
  offlineLine,
  offlineStartLine,
  onlySource,
  onlyThereLine,
  remoteProjectKey,
  remoteRows,
  remoteRowStatus,
  showsOnly,
  sourceOf,
  THIS_COMPUTER,
  toggleOnly,
  toggleSource,
} from './remoteRows.ts';
import type { SessionRowData } from './sessionsStore.ts';
import { buildListRows, buildSessionList, groupsFor, isActive, rowStatus } from './sidebarRows.ts';

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 15, 15, 0).getTime();

const session = (id: string, status: RemoteSession['status'], extra: Partial<RemoteSession> = {}): RemoteSession => ({
  id,
  title: `Remote ${id}`,
  projectId: '0123456789abcdef',
  projectName: 'involv-timesheet',
  branch: 'main',
  status,
  updatedAt: NOW - HOUR,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  profile: null,
  ...extra,
});

const mystic = { id: 'm1', name: 'mystic', state: 'connected' as const, lastSeen: null };

const local = (id: string, extra: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/Users/me/app',
  updatedAt: NOW - 2 * HOUR,
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

describe('remote rows', () => {
  it('maps a remote session to a sidebar row, keeping its computer', () => {
    const list: RemoteSessions = { sessions: [session('s1', 'working')], prompts: [] };
    const [row] = remoteRows([mystic], new Map([['m1', list]]));
    expect(row).toMatchObject({
      id: 'remote:m1:s1',
      title: 'Remote s1',
      projectRoot: remoteProjectKey('m1', '0123456789abcdef'),
      branch: 'main',
      live: null,
      summary: null,
      inApp: true,
      remote: { computerId: 'm1', computerName: 'mystic', sessionId: 's1', projectName: 'involv-timesheet', status: 'running', offline: false },
    });
    expect(isRemoteProjectKey(row!.projectRoot)).toBe(true);
    expect(sourceOf(row!)).toBe('m1');
    expect(sourceOf(local('a'))).toBe(THIS_COMPUTER);
  });

  it('uses the same status rules as that computer: an open prompt is needs you', () => {
    expect(remoteRowStatus({ status: 'idle', unread: false }, true)).toBe('needs-you');
    expect(remoteRowStatus({ status: 'needs-you', unread: false }, false)).toBe('needs-you');
    expect(remoteRowStatus({ status: 'working', unread: false }, false)).toBe('running');
    expect(remoteRowStatus({ status: 'background', unread: false }, false)).toBe('background');
    expect(remoteRowStatus({ status: 'idle', unread: true }, false)).toBe('unread');
    expect(remoteRowStatus({ status: 'error', unread: false }, false)).toBe('error');
    expect(remoteRowStatus({ status: 'stopped', unread: false }, false)).toBeNull();
    const list: RemoteSessions = {
      sessions: [session('s1', 'idle')],
      prompts: [
        { requestId: 'r2', sessionId: 's1', toolName: 'Edit', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 20 },
        { requestId: 'r1', sessionId: 's1', toolName: 'Bash', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 10 },
      ],
    };
    const [row] = remoteRows([mystic], new Map([['m1', list]]));
    expect(rowStatus(row!)).toBe('needs-you');
    // The oldest prompt says what it waits for.
    expect(row!.remote?.waitingTool).toBe('Bash');
  });

  it('keeps an offline computer’s last list and drops a forgotten one’s', () => {
    const lists = new Map([['m1', { sessions: [session('s1', 'idle')], prompts: [] }]]);
    const [row] = remoteRows([{ ...mystic, state: 'offline', lastSeen: NOW - 2 * HOUR }], lists);
    expect(row!.remote).toMatchObject({ offline: true, lastSeen: NOW - 2 * HOUR });
    expect(remoteRows([], lists)).toEqual([]);
    // Connected but not listed yet: nothing to show.
    expect(remoteRows([mystic], new Map())).toEqual([]);
  });
});

describe('local and remote sessions together', () => {
  const list: RemoteSessions = {
    sessions: [session('ask', 'idle', { updatedAt: NOW - 5 * 60_000 }), session('run', 'working'), session('old', 'idle', { updatedAt: NOW - 30 * 24 * HOUR })],
    prompts: [{ requestId: 'r', sessionId: 'ask', toolName: 'AskUserQuestion', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 1 }],
  };
  const remote = remoteRows([mystic], new Map([['m1', list]]));
  const rows = [local('here', { updatedAt: NOW - 10 * 60_000 }), local('pinned', { pinned: true }), ...remote];

  it('groups and sorts them with the same rules', () => {
    const { active, archived } = buildSessionList(rows, { search: '', project: null, now: NOW, archiveAfterDays: 7 });
    // Another computer lists only what its sidebar does: never archived here, however old.
    expect(archived).toEqual([]);
    expect(isActive(remote[2]!, NOW, 7)).toBe(true);
    const groups = groupsFor(active, NOW).map((g) => [g.group, g.rows.map((r) => r.id)]);
    expect(groups).toEqual([
      ['needs-you', ['remote:m1:ask']],
      ['working', ['remote:m1:run']],
      ['pinned', ['pinned']],
      ['today', ['here']],
      ['earlier', ['remote:m1:old']],
    ]);
    const listRows = buildListRows(active, archived, { now: NOW, archivedOpen: false });
    expect(listRows.filter((r) => r.kind === 'session').length).toBe(5);
  });

  it('orders Working by when that computer set each session going', () => {
    const working: RemoteSessions = {
      sessions: [session('first', 'working', { updatedAt: NOW, workingSince: NOW - 10 * 60_000 }), session('second', 'working', { updatedAt: NOW - 60_000, workingSince: NOW - 5 * 60_000 })],
      prompts: [],
    };
    const both = remoteRows([mystic], new Map([['m1', working]]));
    expect(groupsFor(both, NOW)[0]!.rows.map((r) => r.id)).toEqual(['remote:m1:second', 'remote:m1:first']);
  });

  it('finds remote sessions by project and computer name', () => {
    const find = (search: string) => buildSessionList(rows, { search, project: null, now: NOW, archiveAfterDays: 7 }).active.map((r) => r.id);
    expect(find('mystic')).toEqual(['remote:m1:ask', 'remote:m1:run', 'remote:m1:old']);
    expect(find('timesheet')).toHaveLength(3);
    expect(find('app')).toEqual(['pinned', 'here']);
  });

  it('filters by a remote project like a local one', () => {
    const project = remoteProjectKey('m1', '0123456789abcdef');
    expect(buildSessionList(rows, { search: '', project, now: NOW, archiveAfterDays: 7 }).active).toHaveLength(3);
  });
});

describe('the Computers filter', () => {
  const sources = [THIS_COMPUTER, 'm1', 'm2'];
  const rows = [local('a'), { ...local('b'), remote: { computerId: 'm1' } as SessionRowData['remote'] }, { ...local('c'), remote: { computerId: 'm2' } as SessionRowData['remote'] }];

  it('leaves out the hidden computers, this one too', () => {
    expect(filterBySource(rows, new Set()).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(filterBySource(rows, new Set([THIS_COMPUTER])).map((r) => r.id)).toEqual(['b', 'c']);
    expect(filterBySource(rows, onlySource(sources, 'm2')).map((r) => r.id)).toEqual(['c']);
  });

  it('a chip shows only its computer, and everything again', () => {
    const only = toggleOnly(sources, new Set(), 'm1');
    expect([...only].sort()).toEqual(['local', 'm2']);
    expect(showsOnly(sources, only, 'm1')).toBe(true);
    expect(showsOnly(sources, only, 'm2')).toBe(false);
    expect(toggleOnly(sources, only, 'm1').size).toBe(0);
    // From one computer only, another chip moves the filter there.
    expect([...toggleOnly(sources, only, THIS_COMPUTER)].sort()).toEqual(['m1', 'm2']);
  });

  it('a checkbox hides or shows one computer', () => {
    expect([...toggleSource(new Set(), 'm1')]).toEqual(['m1']);
    expect([...toggleSource(new Set(['m1']), 'm1')]).toEqual([]);
  });
});

describe('the wording', () => {
  it('says how long an offline computer has been away', () => {
    expect(offlineLine('mystic', NOW - 2 * HOUR, NOW)).toBe('mystic is offline. Last seen 2h ago.');
    expect(offlineLine('mystic', null, NOW)).toBe('mystic is offline.');
    expect(offlineStartLine('studio', NOW - 2 * HOUR, NOW)).toBe('studio is offline since 2h ago. You can start there once it is back.');
  });

  it('says what only works on that computer, with one helper', () => {
    expect(onlyThereLine('Terminal', 'mystic')).toBe('Terminal is on mystic. Not available from here.');
    expect(onlyThereLine('Changes', 'mystic')).toBe('Changes are on mystic. Not available from here.');
  });
});
