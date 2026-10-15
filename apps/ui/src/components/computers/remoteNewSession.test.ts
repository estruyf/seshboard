import { describe, expect, it } from 'vitest';
import type { RemoteSession } from '@switchboard/protocol/client';
import { remoteProjectTiles } from './remoteNewSession.ts';

const project = (id: string, name: string) => ({ id: id.padEnd(16, '0'), name });
const session = (id: string, projectId: string, status: RemoteSession['status'], updatedAt = 1): RemoteSession => ({
  id,
  title: id,
  projectId: projectId.padEnd(16, '0'),
  projectName: projectId,
  branch: null,
  status,
  updatedAt,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  profile: null,
});

describe('New session on another computer', () => {
  it('lists that computer’s projects, what needs you and what works first', () => {
    const projects = [project('a', 'cycling'), project('b', 'front-matter'), project('c', 'involv'), project('d', 'wielerwaas')];
    const tiles = remoteProjectTiles(projects, {
      sessions: [session('s1', 'c', 'working'), session('s2', 'c', 'working'), session('s3', 'b', 'idle'), session('s4', 'd', 'idle', 50)],
      prompts: [{ requestId: 'r', sessionId: 's3', toolName: 'Bash', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 1 }],
    });
    expect(tiles.map((t) => [t.project.name, t.label])).toEqual([
      ['front-matter', 'needs you'],
      ['involv', '2 working'],
      ['wielerwaas', 'idle'],
      ['cycling', 'idle'],
    ]);
  });

  it('works before the session list came', () => {
    expect(remoteProjectTiles([project('b', 'b'), project('a', 'a')], null).map((t) => t.project.name)).toEqual(['a', 'b']);
  });
});
