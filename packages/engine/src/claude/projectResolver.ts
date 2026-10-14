import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

export interface ProjectLocation {
  /** Main repository root (worktrees fold into it), or the cwd itself outside git. */
  root: string;
  /** The git directory for this checkout, when known. */
  gitDir: string | null;
  worktree: { name: string; path: string } | null;
}

export interface ProjectResolver {
  resolve(cwd: string): ProjectLocation;
  /** Current branch of a checkout (re-read every call; it changes). Short SHA when detached. */
  branch(location: ProjectLocation): string | null;
  clear(): void;
}

const CLAUDE_WORKTREE = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/;

function readGitFile(dotGit: string, dir: string): string | null {
  try {
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (!match) return null;
    const target = match[1]!.trim();
    return isAbsolute(target) ? target : resolve(dir, target);
  } catch {
    return null;
  }
}

function locate(cwd: string, home: string): ProjectLocation {
  // Claude Code worktrees are recognised by path, so they still group correctly after being deleted.
  const claudeWorktree = CLAUDE_WORKTREE.exec(cwd);

  for (let dir = cwd; ; dir = dirname(dir)) {
    // Never treat the home directory as a project root for something below it (dotfile repos).
    if (dir === home && cwd !== home) break;
    const dotGit = join(dir, '.git');
    const stat = statSync(dotGit, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      return { root: dir, gitDir: dotGit, worktree: null };
    }
    if (stat?.isFile()) {
      const gitDir = readGitFile(dotGit, dir);
      const marker = `${sep}.git${sep}worktrees${sep}`;
      const index = gitDir?.lastIndexOf(marker) ?? -1;
      if (gitDir && index !== -1) {
        return { root: gitDir.slice(0, index), gitDir, worktree: { name: basename(dir), path: dir } };
      }
      return { root: dir, gitDir, worktree: null };
    }
    if (dirname(dir) === dir) break;
  }

  if (claudeWorktree) {
    return {
      root: claudeWorktree[1]!,
      gitDir: null,
      worktree: { name: claudeWorktree[2]!, path: claudeWorktree[0]! },
    };
  }
  return { root: cwd, gitDir: null, worktree: null };
}

function readBranch(gitDir: string): string | null {
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref) return ref[1]!;
    return /^[0-9a-f]{7,}$/.test(head) ? head.slice(0, 7) : null;
  } catch {
    return null;
  }
}

/**
 * The git directory of a checkout whose top is `dir` itself (a `.git` folder, or a worktree's `.git` file), or null when
 * `dir` is not the top of one. Unlike `resolve`, it never looks at the folders above.
 */
export function ownGitDir(dir: string): string | null {
  try {
    const dotGit = join(dir, '.git');
    const stat = statSync(dotGit, { throwIfNoEntry: false });
    if (stat?.isDirectory()) return dotGit;
    return stat?.isFile() ? readGitFile(dotGit, dir) : null;
  } catch {
    return null;
  }
}

/** The branch checked out in a git directory: its name, a short SHA when detached, null when unreadable. */
export const branchOf = (gitDir: string): string | null => readBranch(gitDir);

export function createProjectResolver(home = homedir()): ProjectResolver {
  const cache = new Map<string, ProjectLocation>();
  return {
    resolve(cwd) {
      let location = cache.get(cwd);
      if (!location) {
        location = locate(cwd, home);
        cache.set(cwd, location);
      }
      return location;
    },
    branch: (location) => (location.gitDir ? readBranch(location.gitDir) : null),
    clear: () => cache.clear(),
  };
}
