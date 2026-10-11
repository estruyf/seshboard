import { describe, expect, it } from 'vitest';
import { memoryWriteOf, type MemoryFolders } from './memoryWrites.ts';

const folders: MemoryFolders = { home: '/Users/me', configDirs: ['/Users/me/.claude', '/Users/me/work-claude'], personalDir: '/Users/me/Notes/memory' };
const memory = '---\nname: sidebar-order\ndescription: x\nmetadata:\n  type: project\n---\n\nBody.\n';

describe('memory writes in the conversation', () => {
  it('recognises a Write or Edit to a memory file, with its name and type', () => {
    expect(memoryWriteOf('Write', { file_path: '/Users/me/.claude/projects/-Users-me-app/memory/sidebar-order.md', content: memory }, folders)).toEqual({
      path: '/Users/me/.claude/projects/-Users-me-app/memory/sidebar-order.md',
      name: 'sidebar-order',
      type: 'project',
      personal: false,
    });
    expect(memoryWriteOf('Edit', { file_path: '/Users/me/work-claude/projects/-Users-me-app/memory/notes.md', old_string: 'a', new_string: 'b' }, folders)).toMatchObject({ name: 'notes', type: null });
  });

  it('reads ~ paths and the personal folder', () => {
    expect(memoryWriteOf('Write', { file_path: '~/.claude/projects/-Users-me-app/memory/a.md', content: 'x' }, folders)?.path).toBe('/Users/me/.claude/projects/-Users-me-app/memory/a.md');
    expect(memoryWriteOf('Edit', { file_path: '/Users/me/Notes/memory/profile.md' }, folders)).toMatchObject({ name: 'profile', personal: true });
  });

  it('counts a worktree’s session: its memory is the repository’s folder', () => {
    // A session in .claude/worktrees/x writes to the repository's encoded folder, not the worktree's.
    expect(memoryWriteOf('Write', { file_path: '/Users/me/.claude/projects/-Users-me-code-app/memory/release.md', content: 'x' }, folders)).not.toBeNull();
  });

  it('leaves MEMORY.md alone, and every other file', () => {
    expect(memoryWriteOf('Write', { file_path: '/Users/me/.claude/projects/-Users-me-app/memory/MEMORY.md', content: '- x' }, folders)).toBeNull();
    expect(memoryWriteOf('Write', { file_path: '/Users/me/code/app/memory/notes.md', content: 'x' }, folders)).toBeNull();
    expect(memoryWriteOf('Read', { file_path: '/Users/me/.claude/projects/-Users-me-app/memory/a.md' }, folders)).toBeNull();
    expect(memoryWriteOf('Write', { file_path: '/Users/me/.claude/projects/-Users-me-app/memory/sub/a.md' }, folders)).toBeNull();
    expect(memoryWriteOf('Write', { file_path: '/elsewhere/.claude/projects/x/memory/a.md' }, folders)).toBeNull();
  });

  it('falls back to any .claude folder while the profiles aren’t known', () => {
    expect(memoryWriteOf('Write', { file_path: '/elsewhere/.claude/projects/x/memory/a.md' }, { home: null, configDirs: [], personalDir: null })).not.toBeNull();
  });
});
