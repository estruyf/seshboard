import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { countLines, MEMORY_INDEX_LIMIT, rulePaths, splitFrontmatter, type LoadEntry } from '@switchboard/protocol';

/** Claude Code loads the first 200 lines of MEMORY.md, or the first 25 KB, whichever comes first. */
export const MEMORY_INDEX_BYTES = 25 * 1024;

/** How the load order reads files; the file system by default, a fake in tests. */
export interface LoadOrderFs {
  read(path: string): string | null;
  /** The `.md` files directly in a folder, sorted (none when it is missing). */
  list(dir: string): string[];
}

export const realFs: LoadOrderFs = {
  read: (path) => {
    try {
      return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  },
  list: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.md'))
        .map((e) => join(dir, e.name))
        .sort();
    } catch {
      return [];
    }
  },
};

/**
 * The `@path` imports in a CLAUDE.md, as absolute paths: `@` at the start of a word, outside code, followed by a path
 * (relative to the file, `~/`, or absolute). An e-mail address or a bare `@name` isn't one.
 */
export function importsOf(text: string, file: string, home = homedir()): string[] {
  const found: string[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const plain = line.replace(/`[^`]*`/g, ' ');
    // `\ ` is a space inside the path (Claude Code's escape), as Switchboard writes the personal folder's import.
    for (const match of plain.matchAll(/(?:^|\s)@((?:\\ |[^\s])+)/g)) {
      const raw = match[1]!.replace(/[),.;:]+$/, '').replace(/\\ /g, ' ');
      if (!/[/.]/.test(raw)) continue;
      const path = raw.startsWith('~/') ? join(home, raw.slice(2)) : isAbsolute(raw) ? raw : resolve(dirname(file), raw);
      if (!found.includes(path)) found.push(path);
    }
  }
  return found;
}

/** How much of a MEMORY.md loads: whole lines, up to 200 of them and 25 KB. */
export function memoryIndexCut(text: string): { lines: number; bytes: number } {
  const lines = text.split(/(?<=\n)/).filter((l) => l !== '');
  let bytes = 0;
  let count = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line);
    if (count === MEMORY_INDEX_LIMIT || bytes + size > MEMORY_INDEX_BYTES) break;
    bytes += size;
    count++;
  }
  return { lines: count, bytes };
}

const entry = (path: string, text: string, rest: Omit<LoadEntry, 'path' | 'bytes' | 'lines'>): LoadEntry => ({ path, bytes: Buffer.byteLength(text), lines: countLines(text), ...rest });

/**
 * What Claude Code loads at the start of a session in a project, in its order: the profile's CLAUDE.md and its `@`
 * imports (one level), the profile's rules, the project's CLAUDE.md (root, else `.claude/`) and its imports,
 * CLAUDE.local.md, the project's rules without `paths:` (rules with them load on demand, listed last), and the start of
 * MEMORY.md. Files that are missing are left out; nothing here throws.
 */
export function loadOrder({ configDir, root, memoryDir, fs = realFs, home = homedir() }: { configDir: string; root: string; memoryDir: string; fs?: LoadOrderFs; home?: string }): LoadEntry[] {
  const out: LoadEntry[] = [];
  const seen = new Set<string>();
  const add = (path: string, rest: Omit<LoadEntry, 'path' | 'bytes' | 'lines'>, withImports: boolean) => {
    if (seen.has(path)) return;
    const text = fs.read(path);
    if (text === null) return;
    seen.add(path);
    out.push(entry(path, text, rest));
    if (!withImports) return;
    for (const imported of importsOf(text, path, home)) {
      const body = seen.has(imported) ? null : fs.read(imported);
      if (body === null) continue;
      seen.add(imported);
      out.push(entry(imported, body, { kind: 'import', scope: rest.scope, when: 'launch', importedFrom: path }));
    }
  };

  add(join(configDir, 'CLAUDE.md'), { kind: 'user', scope: 'personal', when: 'launch' }, true);
  for (const rule of fs.list(join(configDir, 'rules'))) add(rule, { kind: 'user-rule', scope: 'personal', when: 'launch' }, false);
  const rootClaude = join(root, 'CLAUDE.md');
  add(fs.read(rootClaude) !== null ? rootClaude : join(root, '.claude', 'CLAUDE.md'), { kind: 'project', scope: 'project', when: 'launch' }, true);
  add(join(root, 'CLAUDE.local.md'), { kind: 'local', scope: 'local', when: 'launch' }, true);
  const onDemand: Array<{ path: string; text: string; paths: string[] }> = [];
  for (const rule of fs.list(join(root, '.claude', 'rules'))) {
    const text = fs.read(rule);
    if (text === null) continue;
    const paths = rulePaths(splitFrontmatter(text).data);
    if (paths) onDemand.push({ path: rule, text, paths });
    else add(rule, { kind: 'rule', scope: 'project', when: 'launch' }, false);
  }
  const indexPath = join(memoryDir, 'MEMORY.md');
  const index = fs.read(indexPath);
  if (index !== null) out.push(entry(indexPath, index, { kind: 'memory', scope: 'local', when: 'launch', loaded: memoryIndexCut(index) }));
  for (const rule of onDemand) out.push(entry(rule.path, rule.text, { kind: 'rule', scope: 'project', when: 'on-demand', paths: rule.paths }));
  return out;
}
