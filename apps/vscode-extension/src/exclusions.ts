/**
 * What you keep from Claude, so the extension never sends the text of those files (a reference is fine: Claude Code
 * applies its own rules when it reads one). Pure, so it can be tested: the extension reads the settings and runs git.
 *
 * - `files.exclude` and `search.exclude` globs, relative to the workspace folder;
 * - `Read(…)` deny rules in Claude Code's settings (`~/.claude/settings.json`, `.claude/settings.json`,
 *   `.claude/settings.local.json`), which follow gitignore's patterns.
 */

/**
 * A path in the form Claude Code matches permission rules against. On Windows it normalises paths to POSIX form
 * first: `C:\Users\alice` is `/c/Users/alice`, so a rule for that whole drive starts with `//c/`. Others stay as they are.
 */
export function posixForm(path: string): string {
  const drive = /^([A-Za-z]):[\\/]/.exec(path);
  return drive ? `/${drive[1]!.toLowerCase()}/${path.slice(3).replace(/\\/g, '/')}` : path;
}

/** A glob as a test of a whole `/`-separated path (`globMatcher`). */
export type GlobTest = (path: string) => boolean;

/** Globs longer than this, or with more than `MAX_ALTERNATIVES` spellings, match everything: denying more is the safe way to be wrong. */
const MAX_GLOB = 2_000;
const MAX_ALTERNATIVES = 256;

/** A glob's text with its special characters escaped, for a folder's path put in front of a pattern. */
export const escapeGlob = (text: string) => text.replace(/[\\*?[\]{},]/g, '\\$&');

/**
 * The spellings of a glob without its braces: `*.{env,pem}` is `*.env` and `*.pem`. Null when there are too many
 * (`{a,b}{a,b}…` doubles with each pair). A `{` without its `}` and an escaped one (`\{`) are plain text.
 */
function expandBraces(glob: string): string[] | null {
  const out: string[] = [];
  const queue = [glob];
  for (let steps = 0; queue.length; steps++) {
    if (steps > MAX_ALTERNATIVES * 8) return null;
    const g = queue.pop()!;
    let open = -1;
    let close = -1;
    const commas: number[] = [];
    for (let i = 0, depth = 0; i < g.length && close < 0; i++) {
      const c = g[i];
      if (c === '\\') i++;
      else if (c === '{') {
        if (depth++ === 0) open = i;
      } else if (c === '}' && depth > 0) {
        if (--depth === 0) close = i;
      } else if (c === ',' && depth === 1) commas.push(i);
    }
    if (close < 0) {
      out.push(g);
      if (out.length > MAX_ALTERNATIVES) return null;
      continue;
    }
    const cuts = [open, ...commas, close];
    // Pushed last first, so they come out in the order written.
    for (let k = cuts.length - 2; k >= 0; k--) queue.push(g.slice(0, open) + g.slice(cuts[k]! + 1, cuts[k + 1]) + g.slice(close + 1));
  }
  return out;
}

type Token =
  | { kind: 'char'; char: string }
  /** `?`: one character, not `/`. */
  | { kind: 'one' }
  /** `*`: any characters but `/`. */
  | { kind: 'star' }
  /** `**` not followed by `/`: anything at all. */
  | { kind: 'any' }
  /** `**\/`: any number of folders, none too (empty, or anything that ends with `/`). */
  | { kind: 'folders' }
  /** `[abc]`, `[a-z]`, `[!abc]`: one character of the set (or not of it), never `/`. */
  | { kind: 'set'; ranges: Array<[string, string]>; negated: boolean };

function tokenize(glob: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '\\' && i + 1 < glob.length) tokens.push({ kind: 'char', char: glob[++i]! });
    else if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        tokens.push({ kind: slash ? 'folders' : 'any' });
        i += slash ? 2 : 1;
      } else tokens.push({ kind: 'star' });
    } else if (c === '?') tokens.push({ kind: 'one' });
    else if (c === '[' && glob.indexOf(']', i + 2) !== -1) {
      let j = i + 1;
      const negated = glob[j] === '!' || glob[j] === '^';
      if (negated) j++;
      const ranges: Array<[string, string]> = [];
      // A `]` right after `[` (or `[!`) is one of the set.
      for (let first = true; j < glob.length && (first || glob[j] !== ']'); first = false) {
        let from = glob[j]!;
        if (from === '\\' && j + 1 < glob.length) from = glob[++j]!;
        j++;
        if (glob[j] === '-' && j + 1 < glob.length && glob[j + 1] !== ']') {
          let to = glob[j + 1]!;
          j += 2;
          if (to === '\\' && j < glob.length) to = glob[j++]!;
          ranges.push([from, to]);
        } else ranges.push([from, from]);
      }
      if (j >= glob.length) tokens.push({ kind: 'char', char: '[' });
      else {
        tokens.push({ kind: 'set', ranges, negated });
        i = j;
      }
    } else tokens.push({ kind: 'char', char: c });
  }
  return tokens;
}

/** Whether `tokens` match all of `path`: a table of (token, position) answers, so it takes length × length steps at most, never more. */
function matchTokens(tokens: readonly Token[], path: string): boolean {
  const width = path.length + 1;
  // next[si]: whether tokens from k + 1 on match path from si on; built from the last token back.
  let next = new Uint8Array(width);
  next[path.length] = 1;
  for (let k = tokens.length - 1; k >= 0; k--) {
    const token = tokens[k]!;
    const here = new Uint8Array(width);
    // For `**/`: whether path from si on is `[^/]*/` followed by more folders and then the rest.
    let inFolder = 0;
    for (let si = path.length; si >= 0; si--) {
      const c = path[si];
      let ok = false;
      switch (token.kind) {
        case 'char':
          ok = c === token.char && next[si + 1] === 1;
          break;
        case 'one':
          ok = c !== undefined && c !== '/' && next[si + 1] === 1;
          break;
        case 'set':
          ok = c !== undefined && c !== '/' && token.ranges.some(([from, to]) => c >= from && c <= to) !== token.negated && next[si + 1] === 1;
          break;
        case 'star':
          ok = next[si] === 1 || (c !== undefined && c !== '/' && here[si + 1] === 1);
          break;
        case 'any':
          ok = next[si] === 1 || (c !== undefined && here[si + 1] === 1);
          break;
        case 'folders': {
          const folder = c === undefined ? 0 : c === '/' ? here[si + 1]! : inFolder;
          inFolder = folder;
          ok = next[si] === 1 || folder === 1;
          break;
        }
      }
      here[si] = ok ? 1 : 0;
    }
    next = here;
  }
  return next[0] === 1;
}

/**
 * A glob (`**`, `*`, `?`, `{a,b}`, `[abc]`, `\` to escape) as a test of a whole `/`-separated path. Not a regular
 * expression: a crafted one (`**\/**\/**\/…`, `*a*a*a…`) from a repository's settings would take a regular
 * expression minutes, and this a few steps per character. `ignoreCase` for Windows, as its file system does.
 */
export function globMatcher(glob: string, ignoreCase = false): GlobTest {
  const alternatives = glob.length > MAX_GLOB ? null : expandBraces(ignoreCase ? glob.toLowerCase() : glob);
  if (!alternatives) return () => true;
  const compiled = alternatives.map(tokenize);
  return (path) => {
    const subject = ignoreCase ? path.toLowerCase() : path;
    return compiled.some((tokens) => matchTokens(tokens, subject));
  };
}

/** Whether a path (relative to the workspace folder) matches one of VS Code's exclude globs that are on. */
export function excludedBy(relativePath: string, globs: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(globs).some(([glob, on]) => {
    if (on !== true) return false;
    const test = globMatcher(glob);
    // A folder's glob (`**/node_modules`) excludes what is inside it too.
    const parts = relativePath.split('/');
    return parts.some((_, i) => test(parts.slice(0, i + 1).join('/')));
  });
}

/** A Claude Code settings file that was read, and where it sits. */
export interface ClaudeSettingsFile {
  /** The folder rules relative to the settings are read from: the project for `.claude/settings*.json`, home for `~/.claude/settings.json`. */
  root: string;
  json: unknown;
}

/** A `Read` deny rule, ready to match absolute paths. */
export interface ReadRule {
  /** Every read is denied (`Read` or `Read(*)` / `Read(**)`). */
  all: boolean;
  match: GlobTest | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The `Read(…)` rules in `permissions.deny`, turned into matchers for absolute paths. Like gitignore: `//path` is from
 * the filesystem's root, `~/path` from home, `/path` from the settings' folder, and `path` or `./path` from the
 * workspace folder; a pattern without a `/` matches at any depth. On Windows the folders are in `posixForm`, and
 * matching ignores case, as the file system does (denying more is the safe way to be wrong).
 */
export function readRules(files: readonly ClaudeSettingsFile[], workspaceFolder: string, homeFolder: string): ReadRule[] {
  const windows = posixForm(workspaceFolder) !== workspaceFolder || posixForm(homeFolder) !== homeFolder;
  const workspace = posixForm(workspaceFolder);
  const home = posixForm(homeFolder);
  const rules: ReadRule[] = [];
  for (const file of files) {
    const root = posixForm(file.root);
    const deny = isRecord(file.json) && isRecord(file.json.permissions) ? file.json.permissions.deny : undefined;
    if (!Array.isArray(deny)) continue;
    for (const entry of deny) {
      if (typeof entry !== 'string') continue;
      const rule = /^Read(?:\((.*)\))?$/.exec(entry.trim());
      if (!rule) continue;
      const pattern = rule[1]?.trim() ?? '';
      if (pattern === '' || pattern === '*' || pattern === '**') {
        rules.push({ all: true, match: null });
        continue;
      }
      // A trailing `/` only says it's a folder; what is inside a match is covered below anyway.
      const body = pattern.replace(/\/+$/, '');
      // The folders are paths, not patterns: `[`, `{` or `*` in a folder's name must match only itself.
      let anchored: string;
      if (body.startsWith('//')) anchored = body.slice(1);
      else if (body.startsWith('~/')) anchored = `${escapeGlob(home)}/${body.slice(2)}`;
      else if (body.startsWith('/')) anchored = `${escapeGlob(root)}${body}`;
      else if (body.startsWith('./')) anchored = `${escapeGlob(workspace)}/${body.slice(2)}`;
      else anchored = body.includes('/') ? `${escapeGlob(workspace)}/${body}` : `${escapeGlob(workspace)}/**/${body}`;
      // What is inside a denied folder is denied too.
      rules.push({ all: false, match: globMatcher(`${anchored.replace(/\/+$/, '')}{,/**}`, windows) });
    }
  }
  return rules;
}

/** Whether a `Read` deny rule keeps this file from Claude. */
export const deniedByRead = (path: string, rules: readonly ReadRule[]) => rules.some((rule) => rule.all || (rule.match?.(posixForm(path)) ?? false));
