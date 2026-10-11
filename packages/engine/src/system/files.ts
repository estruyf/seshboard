import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { GIT_SETTINGS } from '../git/gitChanges.ts';

const MAX_FILES = 50_000;
const CACHE_MS = 30_000;
/** How long a folder outside git may be walked for one listing. */
const WALK_BUDGET_MS = 1_500;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.turbo', '.cache', 'coverage', '.venv', '__pycache__']);
const HOME_SKIP_DIRS = new Set(['Library', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music']);

function gitFiles(cwd: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...GIT_SETTINGS, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 5000 },
      (error, stdout) => resolve(error ? null : stdout.split('\0').filter(Boolean).slice(0, MAX_FILES)),
    );
  });
}

/**
 * Lists files under a folder that isn't a git checkout, shallow folders first, so a big folder (the home
 * folder, Documents) gives its nearest files within the time budget instead of blocking the engine.
 * In the home folder, Library and the folders macOS guards with a privacy prompt are skipped: they are
 * huge or would ask for access, and are never what an @-mention there is after.
 */
export async function walk(root: string, options: { budgetMs?: number; home?: string } = {}): Promise<string[]> {
  const deadline = Date.now() + (options.budgetMs ?? WALK_BUDGET_MS);
  const home = options.home ?? homedir();
  const out: string[] = [];
  let level = [root];
  for (let depth = 0; depth <= 8 && level.length && out.length < MAX_FILES; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      if (out.length >= MAX_FILES || Date.now() > deadline) return out;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !(dir === home && HOME_SKIP_DIRS.has(entry.name))) next.push(full);
        } else if (entry.isFile() && out.length < MAX_FILES) {
          // With `/` on Windows too, as git lists them and the UI expects.
          out.push(sep === '/' ? relative(root, full) : relative(root, full).split(sep).join('/'));
        }
      }
    }
    level = next;
  }
  return out;
}

/**
 * Scores `path` against `query` as a subsequence match. Higher is better;
 * null means no match. Basename hits, consecutive runs and segment starts win.
 */
export function fuzzyScore(path: string, query: string): number | null {
  if (!query) return 0;
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base === q) return 1000;
  if (base.startsWith(q)) return 800 - base.length;
  if (p.includes(q)) return 600 - p.length;
  let score = 0;
  let pi = 0;
  let run = 0;
  for (const ch of q) {
    const found = p.indexOf(ch, pi);
    if (found === -1) return null;
    run = found === pi ? run + 1 : 0;
    score += 1 + run * 2 + (found === 0 || p[found - 1] === '/' || p[found - 1] === '-' || p[found - 1] === '_' ? 3 : 0);
    pi = found + 1;
  }
  return score - p.length * 0.01;
}

/** File lists per folder for @-mentions; git-aware, cached briefly so typing stays instant. */
export class FileIndex {
  private readonly cache = new Map<string, { at: number; files: Promise<string[]> }>();

  private list(cwd: string): Promise<string[]> {
    const hit = this.cache.get(cwd);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;
    const files = gitFiles(cwd).then((git) => git ?? walk(cwd));
    this.cache.set(cwd, { at: Date.now(), files });
    return files;
  }

  async search(cwd: string, query: string, limit: number): Promise<string[]> {
    const files = await this.list(cwd);
    const scored: Array<{ path: string; score: number }> = [];
    for (const path of files) {
      const score = fuzzyScore(path, query.trim());
      if (score !== null) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    return scored.slice(0, limit).map((s) => s.path);
  }

  /**
   * The files or folders that `paths` name, as absolute paths, or null where none exists. A path is
   * absolute, `~/…` or relative to `cwd`. Claude often names a file from deeper in the project
   * (`suggestions.ts`, `search/suggestions.ts`): a relative path that isn't under `cwd` is looked up
   * in the folder's file list, and used when exactly one file ends with it.
   */
  async resolve(cwd: string | null, paths: string[], home = homedir()): Promise<Array<string | null>> {
    return Promise.all(
      paths.map(async (path) => {
        const homeRelative = path.startsWith('~/') || (sep === '\\' && path.startsWith('~\\'));
        const direct = path === '~' ? home : homeRelative ? join(home, path.slice(2)) : isAbsolute(path) ? normalize(path) : cwd ? resolve(cwd, path) : null;
        if (direct && (await exists(direct))) return direct;
        if (!cwd || path.startsWith('.') || path.startsWith('~') || isAbsolute(path)) return null;
        // The file list uses `/`; Claude may name a file with `\` on Windows.
        const wanted = sep === '/' ? path : path.split(sep).join('/');
        const matches = (await this.list(cwd)).filter((file) => file === wanted || file.endsWith(`/${wanted}`));
        return matches.length === 1 ? join(cwd, matches[0]!) : null;
      }),
    );
  }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
