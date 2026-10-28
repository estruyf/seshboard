import { basename } from 'node:path';
import type { HealthFinding } from '@seshboard/protocol';
import { similar } from './claudeExport.ts';
import { parseIndexLine } from './textEdit.ts';

/** File types a name in a memory has to end in to be taken for a file (`v1.2`, `Node.js` and `e.g.` aren't). */
const FILE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'md', 'mdx', 'sh', 'zsh', 'yml', 'yaml', 'toml', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'css', 'scss', 'html', 'sql', 'lock', 'txt', 'env', 'ini', 'xml', 'svg', 'png', 'vue', 'svelte', 'astro', 'c', 'h', 'cpp']);

/** What a memory mentions that should exist in the project: file paths, `npm run` scripts and `make` targets. */
export interface References {
  paths: string[];
  scripts: string[];
  makeTargets: string[];
}

/**
 * Whether a piece of text reads as a path in the repository: has a `/` or ends in a known file type, and isn't a URL, a
 * flag, a scoped package (`@scope/name`), a glob, a home or absolute path, or a function call.
 */
export function looksLikeRepoPath(text: string): boolean {
  const t = text.trim().replace(/^\.\//, '');
  if (!t || /\s/.test(t) || /:\/\/|^(?:https?|mailto):/i.test(t)) return false;
  if (/^[-@~/$<{]/.test(t) || /[*?[\](){}<>|=,;'"`]/.test(t) || t.includes('..') || t.endsWith('.')) return false;
  const ext = /\.([A-Za-z0-9]{1,6})$/.exec(t)?.[1]?.toLowerCase();
  const hasExt = !!ext && FILE_EXTENSIONS.has(ext);
  if (t.includes('/')) return /^[\w.-]+(?:\/[\w.-]+)+\/?$/.test(t) && (hasExt || !/^\d/.test(t));
  // `Node.js`, `Vue.js`, `Next.js` are libraries, not files.
  if (/^[A-Z][A-Za-z]*\.js$/.test(t)) return false;
  return hasExt && /^[\w.-]+$/.test(t) && !/^\d/.test(t);
}

/**
 * The repository things a memory's text mentions: paths (in backticks, or plain words with a `/` and a file type),
 * `npm run <script>` and `make <target>`. Backticked identifiers, function names, flags and URLs are left out, so a
 * check never flags `useState` or `--force`.
 */
export function referencesIn(body: string): References {
  const paths = new Set<string>();
  const scripts = new Set<string>();
  const makeTargets = new Set<string>();
  // Fenced code shows examples, not facts about the repository.
  const text = body.replace(/^\s{0,3}(```|~~~)[\s\S]*?^\s{0,3}\1/gm, '');
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const code = match[1]!.trim();
    const npm = /^(?:npm run|pnpm(?: run)?|yarn(?: run)?|bun run)\s+([\w:.-]+)$/.exec(code);
    const make = /^make\s+([\w.-]+)$/.exec(code);
    if (npm) scripts.add(npm[1]!);
    else if (make) makeTargets.add(make[1]!);
    else if (looksLikeRepoPath(code)) paths.add(code.replace(/^\.\//, '').replace(/\/$/, ''));
  }
  for (const match of text.replace(/`[^`\n]*`/g, ' ').matchAll(/(?:^|[\s(])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)+)(?=[\s).,;:!?]|$)/g)) {
    const word = match[1]!.replace(/[.,;:!?]+$/, '');
    const ext = /\.([A-Za-z0-9]{1,6})$/.exec(word)?.[1]?.toLowerCase();
    if (ext && FILE_EXTENSIONS.has(ext) && looksLikeRepoPath(word)) paths.add(word.replace(/^\.\//, ''));
  }
  return { paths: [...paths], scripts: [...scripts], makeTargets: [...makeTargets] };
}

/** The targets a Makefile defines (`name:` at the start of a line, not variables or special targets). */
export const makeTargetsOf = (makefile: string) => new Set([...makefile.matchAll(/^([A-Za-z0-9_][\w.-]*)\s*:(?!=)/gm)].map((m) => m[1]!));

/**
 * Stale references: what a memory names that the project doesn't have (a path git and the file system don't know,
 * an npm script or Make target that isn't defined). `exists` checks a path relative to the project.
 */
export function staleReferences(
  memories: ReadonlyArray<{ path: string; name: string; body: string }>,
  project: { exists(path: string): boolean; scripts: ReadonlySet<string> | null; makeTargets: ReadonlySet<string> | null },
): HealthFinding[] {
  const findings: HealthFinding[] = [];
  for (const m of memories) {
    const refs = referencesIn(m.body);
    const missing = [
      ...refs.paths.filter((p) => !project.exists(p)),
      ...(project.scripts ? refs.scripts.filter((s) => !project.scripts!.has(s)).map((s) => `npm run ${s}`) : []),
      ...(project.makeTargets ? refs.makeTargets.filter((t) => !project.makeTargets!.has(t)).map((t) => `make ${t}`) : []),
    ];
    if (missing.length) {
      findings.push({ kind: 'staleReference', memoryPaths: [m.path], detail: `${m.name} mentions ${missing.map((x) => `\`${x}\``).join(', ')}, which ${missing.length === 1 ? 'no longer exists' : 'no longer exist'}`, refs: missing });
    }
  }
  return findings;
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Two texts that are nearly the same: 8 words or more each, and 80% of their words shared. */
export function sameText(a: string, b: string): boolean {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (words(a).length < 8 || words(b).length < 8) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / new Set([...x, ...y]).size >= 0.8;
}

/**
 * Duplicates: two memories with the same name in different folders (another profile, the personal folder), or nearly
 * the same description or text anywhere. Each pair once.
 */
export function duplicates(memories: ReadonlyArray<{ path: string; name: string; description: string; body: string }>): HealthFinding[] {
  const findings: HealthFinding[] = [];
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i]!;
      const b = memories[j]!;
      const sameName = a.name.toLowerCase() === b.name.toLowerCase() && a.path !== b.path;
      if (sameName || similar(a.description, b.description) || sameText(a.body, b.body)) {
        findings.push({ kind: 'duplicate', memoryPaths: [a.path, b.path], detail: sameName ? `${a.name} is in two places` : `${a.name} and ${b.name} look like duplicates` });
      }
    }
  }
  return findings;
}

/**
 * MEMORY.md against its folder: memory files with no line in it (Claude never sees them), and lines that link to a file
 * that isn't there.
 */
export function indexMismatch(indexPath: string, index: string | null, files: ReadonlyArray<{ path: string; name: string }>): HealthFinding[] {
  const linked = new Set<string>();
  const dangling: string[] = [];
  for (const line of (index ?? '').split(/\r?\n/)) {
    const parsed = parseIndexLine(line);
    if (!parsed) continue;
    const file = basename(parsed.link);
    if (!file.endsWith('.md')) continue;
    linked.add(file);
    if (!files.some((f) => basename(f.path) === file)) dangling.push(file);
  }
  const unlisted = files.filter((f) => !linked.has(basename(f.path)));
  if (!unlisted.length && !dangling.length) return [];
  const parts = [unlisted.length && `${unlisted.length} ${unlisted.length === 1 ? 'memory isn’t' : 'memories aren’t'} in MEMORY.md`, dangling.length && `${dangling.length} ${dangling.length === 1 ? 'line points' : 'lines point'} at a missing file`].filter(Boolean);
  return [{ kind: 'indexMismatch', memoryPaths: unlisted.map((f) => f.path), detail: parts.join('; '), indexPath, refs: dangling }];
}

/** A memory not changed in this long is old: shown, never acted on. */
export const OLD_AFTER_MS = 180 * 24 * 60 * 60 * 1000;

export function oldMemories(memories: ReadonlyArray<{ path: string; name: string; modified: number }>, now: number): HealthFinding[] {
  return memories.filter((m) => now - m.modified >= OLD_AFTER_MS).map((m) => ({ kind: 'old', memoryPaths: [m.path], detail: `${m.name} hasn’t changed in ${Math.floor((now - m.modified) / (24 * 60 * 60 * 1000))} days` }));
}
