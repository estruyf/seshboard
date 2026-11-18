import { spawn } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RpcError } from '@seshboard/protocol';
import { GIT_SETTINGS, gitProgram } from '../git/gitChanges.ts';

/** The most matches one search returns by default. */
export const GREP_LIMIT = 2_000;
/** How long a search may run before it returns what it found, marked truncated. */
export const GREP_TIMEOUT_MS = 10_000;
/** The longest `text` of a match: the line, cut around the match. */
export const GREP_TEXT_MAX = 400;
/** Files over this size are left out of a search outside git. */
const SCAN_MAX_BYTES = 2 * 1024 * 1024;
/** How much of a file is looked at to tell a binary file (a NUL byte) from text. */
const BINARY_SNIFF_BYTES = 8 * 1024;

export interface GrepOptions {
  cwd: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Comma-separated globs; empty means every file. */
  include: string;
  /** Comma-separated globs to leave out. */
  exclude: string;
  limit: number;
  /** True for a git checkout: `git grep` searches it, respecting .gitignore. */
  git: boolean;
  /** The folder's files, relative to `cwd`, for a search outside git. */
  files: () => Promise<string[]>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GrepMatch {
  /** Relative to `cwd`, with `/`. */
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based, in the whole line. */
  column: number;
  length: number;
  /** The line, cut to `GREP_TEXT_MAX` characters around the match. */
  text: string;
  /** Where `text` starts in the line (0 unless it was cut). */
  textStart: number;
}

export interface GrepResult {
  matches: GrepMatch[];
  /** How many files have a match. */
  files: number;
  /** True when the limit or the time ran out before the search finished. */
  truncated: boolean;
}

/** Splits a comma-separated list of globs, dropping empty ones and a leading `./`. */
export function splitGlobs(list: string): string[] {
  return list
    .split(',')
    .map((g) => g.trim().replace(/^\.\//, '').replace(/\\/g, '/'))
    .filter(Boolean);
}

/**
 * What a glob the person typed means, as globs from the folder's root: one without a `/` matches at any depth
 * (`*.ts`, `README.md`), and each also matches as a folder (`src` and `src/` take everything in it).
 */
export function expandGlob(glob: string): string[] {
  const trimmed = glob.replace(/\/+$/, '');
  const rooted = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed.includes('/') ? trimmed : `**/${trimmed}`;
  return rooted.endsWith('/**') ? [rooted] : [rooted, `${rooted}/**`];
}

/** A glob as a regular expression over a whole path: `**` crosses folders, `*` and `?` don't. */
export function globRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      // `**/` is any number of folders, none included.
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Whether `path` is in the search: under one of `include` (when there are any) and under none of `exclude`. */
export function pathFilter(include: string, exclude: string): (path: string) => boolean {
  const toRegExps = (list: string) => splitGlobs(list).flatMap(expandGlob).map(globRegExp);
  const wanted = toRegExps(include);
  const unwanted = toRegExps(exclude);
  return (path) => (!wanted.length || wanted.some((r) => r.test(path))) && !unwanted.some((r) => r.test(path));
}

/** The pathspecs for `git grep` from the include and exclude fields. */
export function gitPathspecs(include: string, exclude: string): string[] {
  const included = splitGlobs(include).flatMap(expandGlob).map((g) => `:(glob)${g}`);
  const excluded = splitGlobs(exclude).flatMap(expandGlob).map((g) => `:(exclude,glob)${g}`);
  return [...included, ...excluded];
}

/**
 * The search as a JavaScript regular expression (global), which finds each match in a line for its column and length.
 * INVALID_QUERY when a regular expression doesn't compile, with JavaScript's message.
 */
export function queryRegExp(query: string, options: { regex: boolean; caseSensitive: boolean; wholeWord: boolean }): RegExp {
  let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Lookarounds rather than `\b`, so a query that starts or ends with punctuation still means "not inside a word", as git's -w does.
  if (options.wholeWord) source = `(?<!\\w)(?:${source})(?!\\w)`;
  try {
    return new RegExp(source, `g${options.caseSensitive ? '' : 'i'}`);
  } catch (error) {
    throw new RpcError('INVALID_QUERY', (error as Error).message.replace(/^Invalid regular expression: /, ''));
  }
}

/** Every match of `pattern` in `line`, as matches of `path`, with the line cut around each one. */
export function matchesInLine(path: string, lineNumber: number, line: string, pattern: RegExp): GrepMatch[] {
  const out: GrepMatch[] = [];
  pattern.lastIndex = 0;
  for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
    // An empty match (`^`, `x*`) would loop forever; it still counts once.
    if (m[0].length === 0) pattern.lastIndex++;
    out.push({ path, line: lineNumber, column: m.index + 1, length: m[0].length, ...cutLine(line, m.index, m[0].length) });
    if (m[0].length === 0) break;
  }
  return out;
}

/** The line cut to `GREP_TEXT_MAX` characters, keeping the match in view with some text before it. */
export function cutLine(line: string, index: number, length: number): { text: string; textStart: number } {
  if (line.length <= GREP_TEXT_MAX) return { text: line, textStart: 0 };
  const before = Math.min(index, Math.max(40, Math.floor((GREP_TEXT_MAX - length) / 3)));
  const start = Math.max(0, Math.min(index - before, line.length - GREP_TEXT_MAX));
  return { text: line.slice(start, start + GREP_TEXT_MAX), textStart: start };
}

/** Searches inside the files of `cwd`: `git grep` in a git checkout, the engine's own scan elsewhere. */
export async function grep(options: GrepOptions): Promise<GrepResult> {
  const pattern = queryRegExp(options.query, options);
  if (!options.query) return { matches: [], files: 0, truncated: false };
  const git = options.git ? gitProgram() : null;
  return git ? gitGrep(git, options, pattern) : scan(options, pattern);
}

function cancelled(): RpcError {
  return new RpcError('CANCELLED', 'A newer search replaced this one');
}

function gitGrep(git: string, options: GrepOptions, pattern: RegExp): Promise<GrepResult> {
  const args = [
    ...GIT_SETTINGS,
    // Colours or a pager from the person's config would garble the output.
    '-c', 'color.grep=false', '--no-pager',
    'grep', '-n', '--column', '-I', '-z', '--untracked', '--exclude-standard', '--no-recurse-submodules',
    options.regex ? '-E' : '-F',
    ...(options.caseSensitive ? [] : ['-i']),
    ...(options.wholeWord ? ['-w'] : []),
    '-e', options.query,
    '--', ...gitPathspecs(options.include, options.exclude),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(git, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const matches: GrepMatch[] = [];
    const files = new Set<string>();
    let truncated = false;
    let done = false;
    let rest = '';
    let stderr = '';
    let exited = false;
    const finish = (result: GrepResult | RpcError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      const settle = () => (result instanceof RpcError ? reject(result) : resolve(result));
      if (exited) return settle();
      // Settle once git is gone: on Windows a running process keeps its folder from being deleted or moved.
      child.once('close', settle);
      child.once('error', settle);
      child.kill();
    };
    const result = (): GrepResult => ({ matches, files: files.size, truncated });
    const timer = setTimeout(() => {
      truncated = true;
      finish(result());
    }, options.timeoutMs ?? GREP_TIMEOUT_MS);
    const onAbort = () => finish(cancelled());
    if (options.signal?.aborted) return finish(cancelled());
    options.signal?.addEventListener('abort', onAbort);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (done) return;
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const raw of lines) {
        // path NUL line NUL column NUL text
        const [path, lineText, columnText, ...text] = raw.split('\0');
        if (!path || !lineText) continue;
        const line = Number(lineText);
        const content = text.join('\0').replace(/\r$/, '');
        let found = matchesInLine(path, line, content, pattern);
        // git's regular expressions are POSIX ones; where JavaScript reads one differently, keep git's column.
        if (!found.length) found = [{ path, line, column: Number(columnText) || 1, length: 0, ...cutLine(content, 0, 0) }];
        files.add(path);
        for (const match of found) {
          if (matches.length >= options.limit) {
            truncated = true;
            return finish(result());
          }
          matches.push(match);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      exited = true;
      finish(new RpcError('INTERNAL', error.message));
    });
    child.on('close', (code) => {
      exited = true;
      // 1 is "nothing found"; 128 is an error, most often a regular expression git can't read.
      if (code && code > 1) {
        const message = stderr.trim().replace(/^fatal: /, '').replace(/^command line, '.*?': /, '') || `git grep exited with ${code}`;
        return finish(new RpcError(/regex|regular|unmatched|invalid|brace|paren/i.test(message) ? 'INVALID_QUERY' : 'INTERNAL', message));
      }
      finish(result());
    });
  });
}

async function scan(options: GrepOptions, pattern: RegExp): Promise<GrepResult> {
  const deadline = Date.now() + (options.timeoutMs ?? GREP_TIMEOUT_MS);
  const keep = pathFilter(options.include, options.exclude);
  const matches: GrepMatch[] = [];
  let files = 0;
  for (const path of (await options.files()).filter(keep).sort()) {
    if (options.signal?.aborted) throw cancelled();
    if (Date.now() > deadline) return { matches, files, truncated: true };
    const text = await readText(join(options.cwd, path));
    if (text === null) continue;
    let found = false;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineMatches = matchesInLine(path, i + 1, lines[i]!.replace(/\r$/, ''), pattern);
      if (!lineMatches.length) continue;
      found = true;
      for (const match of lineMatches) {
        if (matches.length >= options.limit) return { matches, files: files + 1, truncated: true };
        matches.push(match);
      }
    }
    if (found) files++;
  }
  return { matches, files, truncated: false };
}

/** A file's text, or null for a binary file (a NUL byte near the start), one over `SCAN_MAX_BYTES`, or one that can't be read. */
async function readText(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > SCAN_MAX_BYTES) return null;
    const handle = await open(path, 'r');
    try {
      const bytes = await handle.readFile();
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
      return bytes.toString('utf8').replace(/^﻿/, '');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
