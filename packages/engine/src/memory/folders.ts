import { lstatSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { memoryMeta, rulePaths, splitFrontmatter, type InstructionFile, type MemoryFile } from '@switchboard/protocol';
import { git } from '../git/gitChanges.ts';
import { conflictBase } from './personal.ts';

/** How Claude Code names a project's folder under `projects/`: every character but letters and digits becomes `-`. */
export const encodeProjectPath = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-');

/** Claude Code shortens very long names (and adds a hash); those are found by their start. */
const MAX_ENCODED = 200;

const readJson = (path: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * `autoMemoryDirectory` from the settings that may set it: the profile's own settings, then the project's
 * `.claude/settings.local.json` (a later one wins). The committed `.claude/settings.json` is left out, as Claude Code
 * does, so a repository can't send your memory somewhere else. `~/` is expanded; a relative path is ignored.
 */
export function autoMemoryDirectory(configDir: string, root: string, home = homedir()): string | null {
  let found: string | null = null;
  for (const file of [join(configDir, 'settings.json'), join(root, '.claude', 'settings.local.json')]) {
    const value = readJson(file)?.autoMemoryDirectory;
    if (typeof value !== 'string' || !value.trim()) continue;
    const path = value.trim().replace(/^~(?=$|\/)/, home);
    if (isAbsolute(path)) found = path;
  }
  return found;
}

/**
 * A project's memory folder in a config folder, the way Claude Code finds it (whether or not it exists yet). Claude Code
 * names it after the repository (`repoRoot`), so a worktree and every folder inside the repository share one.
 */
export function memoryDirFor(configDir: string, root: string, repoRoot = root): string {
  const custom = autoMemoryDirectory(configDir, root);
  if (custom) return custom;
  const projects = join(configDir, 'projects');
  const encoded = encodeProjectPath(repoRoot);
  if (encoded.length > MAX_ENCODED) {
    try {
      const match = readdirSync(projects).find((name) => name.startsWith(encoded.slice(0, MAX_ENCODED)));
      if (match) return join(projects, match, 'memory');
    } catch {
      // No projects folder yet.
    }
  }
  return join(projects, encoded, 'memory');
}

/** The memory files in a folder (not `MEMORY.md`), newest first. Files that can't be read are left out. */
export function listMemoryFiles(dir: string, profileId: string | null): MemoryFile[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const memories: MemoryFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue;
    const path = join(dir, entry.name);
    try {
      const stat = statSync(path);
      // The frontmatter is at the top; a huge file doesn't need reading whole.
      const head = readFileSync(path, 'utf8').slice(0, 16_384);
      const meta = memoryMeta(splitFrontmatter(head).data);
      memories.push({
        path,
        name: meta.name ?? entry.name.slice(0, -3),
        description: meta.description,
        type: meta.type,
        modified: stat.mtimeMs,
        bytes: stat.size,
        profileId,
        originSessionId: meta.originSessionId,
        source: meta.source,
        conflictOf: null,
      });
    } catch {
      // Gone or unreadable since the listing.
    }
  }
  // A sync tool's second version of a file sits next to the first: mark it with the one it stands for.
  const names = new Set(memories.map((m) => basename(m.path)));
  for (const memory of memories) {
    const base = conflictBase(basename(memory.path), (name) => names.has(name));
    if (base) memory.conflictOf = join(dir, base);
  }
  return memories.sort((a, b) => b.modified - a.modified);
}

/** The `.md` files under `.claude/rules/`, a few folders deep. Symlinks are left out (they could point anywhere). */
function ruleFiles(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return ruleFiles(path, depth + 1);
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    });
}

/** The paths git ignores, of the ones asked about (none outside a repository). */
export async function ignoredPaths(root: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  // check-ignore takes path names, and refuses the literal pathspecs `git()` turns on for every other command.
  const out = await git(root, ['--no-literal-pathspecs', 'check-ignore', '--', ...paths.map((p) => relative(root, p))], { allowExitCodes: [1] }).catch(() => '');
  return new Set(
    out
      .split('\n')
      .filter(Boolean)
      .map((p) => join(root, p)),
  );
}

/** Folders never searched for CLAUDE.md files: dependencies, build output, git's own and other tools' caches. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '.next', '.nuxt', '.turbo', '.cache', '.venv', 'venv', '__pycache__', 'Pods', 'DerivedData']);
/** How far down, and how many folders at most, the search for CLAUDE.md files in subfolders goes. */
const SUBFOLDER_DEPTH = 6;
const SUBFOLDER_LIMIT = 4000;

/**
 * CLAUDE.md and CLAUDE.local.md files in the project's subfolders (they load when Claude works on files there).
 * Hidden folders are left out, except `.claude` itself is never one of these. Worktrees under `.claude/worktrees` are skipped.
 */
export function subfolderInstructions(root: string): Array<{ path: string; kind: InstructionFile['kind'] }> {
  const found: Array<{ path: string; kind: InstructionFile['kind'] }> = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > SUBFOLDER_DEPTH || seen++ > SUBFOLDER_LIMIT) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), depth + 1);
      } else if (depth > 0 && entry.isFile() && (entry.name === 'CLAUDE.md' || entry.name === 'CLAUDE.local.md')) {
        found.push({ path: join(dir, entry.name), kind: entry.name === 'CLAUDE.md' ? 'subfolder' : 'local' });
      }
    }
  };
  walk(root, 0);
  // By folder, CLAUDE.md before CLAUDE.local.md.
  return found.sort((a, b) => dirname(a.path).localeCompare(dirname(b.path)) || (a.kind === b.kind ? 0 : a.kind === 'local' ? 1 : -1));
}

/** A project's instruction files Claude Code loads: CLAUDE.md (root, then `.claude/`), CLAUDE.local.md, the rules, CLAUDE.md in subfolders and agent memory. */
export async function listInstructionFiles(root: string): Promise<InstructionFile[]> {
  const candidates: Array<{ path: string; kind: InstructionFile['kind'] }> = [
    { path: join(root, 'CLAUDE.md'), kind: 'claude-md' },
    { path: join(root, '.claude', 'CLAUDE.md'), kind: 'claude-md' },
    { path: join(root, 'CLAUDE.local.md'), kind: 'local' },
    ...ruleFiles(join(root, '.claude', 'rules')).map((path) => ({ path, kind: 'rule' as const })),
    ...subfolderInstructions(root),
    // Subagents with a `memory:` field keep theirs here.
    ...ruleFiles(join(root, '.claude', 'agent-memory')).map((path) => ({ path, kind: 'agent-memory' as const })),
  ];
  const found = candidates.flatMap((c) => {
    const stat = lstatSync(c.path, { throwIfNoEntry: false });
    return stat?.isFile() ? [{ ...c, bytes: stat.size }] : [];
  });
  const ignored = await ignoredPaths(root, found.map((f) => f.path));
  return found.map((f): InstructionFile => {
    const file: InstructionFile = { path: f.path, kind: f.kind, shared: f.kind !== 'local' && !ignored.has(f.path), bytes: f.bytes };
    if (f.kind === 'rule') {
      try {
        const paths = rulePaths(splitFrontmatter(readFileSync(f.path, 'utf8').slice(0, 8_192)).data);
        if (paths) file.paths = paths;
      } catch {
        // Unreadable: listed without paths.
      }
    }
    return file;
  });
}

/** Whether `path` is `dir` or inside it (both resolved). */
export const isInside = (dir: string, path: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
