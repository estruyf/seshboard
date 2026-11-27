import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import { MultiProfileSource } from '../profiles/profileSources.ts';
import { ProviderSources } from './providerSources.ts';

const listing = (infos: RawSessionInfo[]): SessionSource => ({
  list: async () => infos,
  info: async (id) => infos.find((i) => i.sessionId === id),
  messages: async () => [],
});

const session = (sessionId: string, cwd?: string): RawSessionInfo => ({ sessionId, summary: sessionId, lastModified: 1, ...(cwd ? { cwd } : {}) });

describe('ProviderSources', () => {
  const worktree = join(tmpdir(), 'game', '.claude', 'worktrees', 'tulip');
  const project = join(tmpdir(), 'game');
  const sources = () =>
    new ProviderSources(
      new MultiProfileSource(() => [{ profileId: 'default', source: listing([]) }]),
      () => [{ provider: 'antigravity', profileId: 'p', source: listing([session('root', '/'), session('none'), session('own', project)]) }],
      undefined,
      undefined,
      () => worktree,
    );

  it('puts a session listed under the root, or under no folder, in the folder it was started in', async () => {
    const all = await sources().list();
    expect(Object.fromEntries(all.map((i) => [i.sessionId, i.cwd]))).toEqual({ root: worktree, none: worktree, own: project });
    expect((await sources().info('root'))?.cwd).toBe(worktree);
  });

  it('keeps the root when Seshboard did not start the session', async () => {
    const plain = new ProviderSources(new MultiProfileSource(() => []), () => [{ provider: 'antigravity', profileId: 'p', source: listing([session('root', '/')]) }]);
    expect((await plain.list())[0]?.cwd).toBe('/');
  });
});
