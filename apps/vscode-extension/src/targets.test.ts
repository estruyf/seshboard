import { describe, expect, it } from 'vitest';
import type { CompanionSession, CompanionSessions } from '@seshboard/protocol/companion-client';
import { focusedTarget, folderFor, sessionRow, statusBarView, targetChoices } from './targets.ts';

const session = (id: string, over: Partial<CompanionSession> = {}): CompanionSession => ({ id, title: id, cwd: '/repo', projectRoot: '/repo', branch: null, status: 'idle', updatedAt: 0, inApp: true, ...over });
const snapshot = (sessions: CompanionSession[], focused: CompanionSession | null = null): CompanionSessions => ({ sessions, focused, windows: 1 });

describe('focusedTarget', () => {
  it('sends to the focused session when its folder holds every file', () => {
    const focused = session('s1', { cwd: '/repo/packages/web' });
    expect(focusedTarget(snapshot([], focused), ['/repo/packages/web/a.ts', '/repo/packages/web/src/b.ts'])?.id).toBe('s1');
    expect(focusedTarget(snapshot([], focused), ['/repo/packages/web/a.ts', '/repo/README.md'])).toBeNull();
    expect(focusedTarget(snapshot([], focused), ['/repo/packages/website/a.ts'])).toBeNull();
    expect(focusedTarget(snapshot([]), ['/repo/a.ts'])).toBeNull();
  });
});

describe('folderFor', () => {
  it('picks the deepest workspace folder holding the path', () => {
    expect(folderFor('/repo/packages/web/a.ts', ['/repo', '/repo/packages/web'])).toBe('/repo/packages/web');
    expect(folderFor('/elsewhere/a.ts', ['/repo'])).toBeNull();
  });
});

describe('sessionRow', () => {
  const relative = (path: string) => (path === '/repo' ? '' : path.replace('/repo/', ''));

  it('leaves out the folder line for a session in the workspace folder itself', () => {
    expect(sessionRow(session('a', { title: 'Fix login', status: 'idle', branch: 'main', updatedAt: 0 }), 9 * 86_400_000, relative)).toEqual({
      label: '$(circle-outline) Fix login',
      description: 'Idle · main · 9d',
    });
    expect(sessionRow(session('b', { cwd: '/repo/packages/web', status: 'stopped' }), 0, relative)).toMatchObject({ label: '$(history) b', detail: 'packages/web' });
  });
});

describe('targetChoices', () => {
  const options = { now: 0, relative: () => '', folderName: (folder: string) => folder.split('/').pop()! };
  const shape = (choices: ReturnType<typeof targetChoices>) => choices.map((c) => ('separator' in c ? `-- ${c.separator}` : c.target.kind === 'new' ? `new ${c.target.cwd}` : c.target.sessionId));

  it('lists the open session first, then New session, then the other sessions', () => {
    const open = session('s1');
    const choices = targetChoices(snapshot([session('s2'), open, session('s3')], open), { ...options, open, folders: ['/repo', '/other'], newFirst: true });
    expect(shape(choices)).toEqual(['-- Open in Seshboard', 's1', '-- New', 'new /repo', 'new /other', '-- Sessions', 's2', 's3']);
    expect(choices[3]).toMatchObject({ label: '$(add) New session in repo' });
  });

  it('leaves out empty sections, and can put New session last', () => {
    expect(shape(targetChoices(snapshot([]), { ...options, open: null, folders: ['/repo'], newFirst: true }))).toEqual(['-- New', 'new /repo']);
    expect(shape(targetChoices(snapshot([session('s2')]), { ...options, open: null, folders: ['/repo'], newFirst: false }))).toEqual(['-- Sessions', 's2', '-- New', 'new /repo']);
  });
});

describe('statusBarView', () => {
  it('shows what needs you first, and opens it on click', () => {
    const view = statusBarView(snapshot([session('a', { status: 'working' }), session('b', { status: 'needs-you', title: 'Fix login' })]));
    expect(view).toMatchObject({ text: '$(bell-dot) Seshboard: 1 needs you', warning: true, reveal: 'b' });
  });

  it('counts working sessions, and says when Seshboard is not running', () => {
    expect(statusBarView(snapshot([session('a', { status: 'working' }), session('b', { status: 'working' })]))).toMatchObject({ text: '$(loading~spin) Seshboard: 2 working', reveal: null });
    expect(statusBarView(null).text).toBe('$(circle-slash) Seshboard');
  });
});
