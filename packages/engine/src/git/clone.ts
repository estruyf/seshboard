import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSameOrInside, repoLabel, type ClonePhase, type GithubRepoRef, type RepoBrings, type RepoHook } from '@seshboard/protocol';
import { githubRepos } from './remotes.ts';
import { firstUsefulLine, ghEnv, runGh, type GhCommand } from './pullRequest.ts';

/**
 * Clone from GitHub, engine side: the clone itself (gh when it's signed in, else git), its progress, Cancel, and what
 * the cloned repository's own Claude Code settings bring. Runs without a shell; paths go as arguments.
 */

/** Where git is in a clone, from one line of `--progress`, and how far that step is (0–100). */
export function parseCloneProgress(line: string): { phase: ClonePhase; percent: number } | null {
  const match = /(Receiving objects|Resolving deltas|Updating files|Checking out files):\s+(\d{1,3})%/.exec(line);
  if (!match) return null;
  const phase: ClonePhase = match[1] === 'Receiving objects' ? 'receiving' : match[1] === 'Resolving deltas' ? 'resolving' : 'checkout';
  return { phase, percent: Math.min(100, Number(match[2])) };
}

/** The share of the whole clone each step takes: receiving is most of the wait. */
const SPANS: Record<ClonePhase, [number, number]> = { starting: [0, 0], receiving: [0, 80], resolving: [80, 95], checkout: [95, 100] };

/** How far the whole clone is (0–100), from a step and how far that step is. */
export function overallPercent(phase: ClonePhase, percent: number): number {
  const [from, to] = SPANS[phase];
  return Math.round(from + ((to - from) * percent) / 100);
}

/** The command that clones `repo` into `target`: from `source` (tests, the smoke run), with gh, or with git over https. */
export function cloneCommand(repo: GithubRepoRef, target: string, how: { source?: string; gh?: GhCommand | null }): { file: string; args: string[] } {
  const branch = repo.branch ? [`--branch=${repo.branch}`] : [];
  if (how.source) return { file: 'git', args: ['clone', '--progress', ...branch, '--', how.source, target] };
  // gh passes what follows `--` to git, and keeps the protocol the user chose (`gh config get git_protocol`).
  if (how.gh) return { file: how.gh.file, args: [...how.gh.args, 'repo', 'clone', repoLabel(repo), target, '--', '--progress', ...branch] };
  return { file: 'git', args: ['clone', '--progress', ...branch, '--', `https://github.com/${repoLabel(repo)}.git`, target] };
}

/** What to say when a clone fails, from what git or gh printed. */
export function cloneFailure(output: string, repo: GithubRepoRef): string {
  if (/Remote branch .* not found|couldn't find remote ref/i.test(output) && repo.branch) return `${repoLabel(repo)} has no branch ${repo.branch}.`;
  if (/Repository not found|Could not resolve to a Repository|repository '.*' not found|HTTP 404/i.test(output)) {
    return `GitHub has no repository ${repoLabel(repo)}, or it is private. Sign in with gh auth login to clone private repositories.`;
  }
  if (/terminal prompts disabled|could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(output)) {
    return `GitHub asked to sign in for ${repoLabel(repo)}. Sign in with gh auth login, then try again.`;
  }
  if (/Could not resolve host|unable to access|Connection (timed out|refused)|Network is unreachable/i.test(output)) return 'Couldn’t reach GitHub. Check your connection and try again.';
  return firstUsefulLine(output) || 'The clone failed.';
}

/** Whether gh is installed and signed in to github.com, so it can clone private repositories too. */
export async function ghSignedIn(gh: GhCommand, cwd: string, env: Record<string, string>): Promise<boolean> {
  const result = await runGh(gh, ['auth', 'status', '--hostname=github.com'], { cwd, env, timeout: 10_000 });
  return result.code === 0;
}

/** Stops a clone and everything it started (gh starts git): the process group, or the tree on Windows. */
function stopTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

export interface CloneRun {
  /** Resolves when the clone is done; rejects with what to say when it failed or was cancelled (`cancelled` set). */
  done: Promise<void>;
  cancel(): void;
}

export class CloneCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/**
 * Runs a clone. `onProgress` gets the whole clone's progress, at most every 150 ms. A failed or cancelled clone
 * leaves no folder behind when there was none before (git removes what it made; anything left is removed here,
 * only inside `parent`).
 */
export function runClone(options: {
  repo: GithubRepoRef;
  target: string;
  /** The Clone into folder: nothing outside it is ever removed. */
  parent: string;
  command: { file: string; args: string[] };
  env: Record<string, string>;
  onProgress(phase: ClonePhase, percent: number): void;
}): CloneRun {
  const { repo, target, parent, command, env } = options;
  const existedBefore = existsSync(target);
  let cancelled = false;
  const child = spawn(command.file, command.args, {
    cwd: parent,
    // Nothing may wait for a password: git fails instead, and says so.
    env: { ...process.env, ...ghEnv(env), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
    shell: false,
    windowsHide: true,
    // Its own process group, so Cancel stops git too when gh started it.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let last = 0;
  let pending: { phase: ClonePhase; percent: number } | null = null;
  const report = (force = false) => {
    if (!pending || (!force && Date.now() - last < 150)) return;
    last = Date.now();
    options.onProgress(pending.phase, pending.percent);
    pending = null;
  };
  const onData = (chunk: string) => {
    // Progress lines end in \r while they update; keep the tail for the error message.
    output = (output + chunk).slice(-8_000);
    for (const line of chunk.split(/[\r\n]+/)) {
      const step = parseCloneProgress(line);
      if (step) pending = { phase: step.phase, percent: overallPercent(step.phase, step.percent) };
    }
    report();
  };
  child.stdout.setEncoding('utf8').on('data', onData);
  child.stderr.setEncoding('utf8').on('data', onData);

  const cleanUp = () => {
    if (existedBefore || !isSameOrInside(target, parent) || isSameOrInside(parent, target)) return;
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A file held open (Windows); the folder stays, and the next try with the same name says it is taken.
    }
  };
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      cleanUp();
      reject(new Error(error.code === 'ENOENT' ? `${command.file === 'git' ? 'git' : 'gh'} isn’t installed, or isn’t on the PATH.` : error.message));
    });
    child.on('close', (code) => {
      report(true);
      if (cancelled) {
        cleanUp();
        return reject(new CloneCancelled());
      }
      if (code === 0) return resolve();
      cleanUp();
      reject(new Error(cloneFailure(output, repo)));
    });
  });
  return {
    done,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      stopTree(child.pid);
    },
  };
}

/** Whether `folder` is a checkout of `repo` (any remote pointing at it on GitHub). */
export async function isCheckoutOf(folder: string, repo: GithubRepoRef): Promise<boolean> {
  return (await githubRepos(folder)).includes(repoLabel(repo).toLowerCase());
}

/** What is at `target`: nothing, a checkout of `repo`, or something else (a file counts). */
export async function targetState(target: string, repo: GithubRepoRef): Promise<'free' | 'cloned' | 'taken'> {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return 'free';
  if (stat.isDirectory() && (await isCheckoutOf(target, repo))) return 'cloned';
  return 'taken';
}

// --- What a repository brings ---------------------------------------------------------------------------------

const MAX_TEXT = 200;
const short = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** Settings that run a command, send requests elsewhere or widen what Claude may do, besides hooks and rules. */
const COMMAND_SETTINGS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper'];

/**
 * What a repository's settings files and `.mcp.json` bring (`RepoBrings`), from their parsed contents. Anything that
 * isn't the shape Claude Code reads is left out; nothing here runs or trusts what it reads.
 */
export function repoBringsFrom(files: { settings: unknown[]; mcp: unknown }): RepoBrings {
  const hooks: RepoHook[] = [];
  const allow: string[] = [];
  const plugins: string[] = [];
  const settings: string[] = [];
  const mcpServers: string[] = [];
  const add = (list: string[], item: string) => list.includes(item) || list.push(item);

  for (const file of files.settings) {
    if (!isObject(file)) continue;
    if (isObject(file.hooks)) {
      for (const [event, matchers] of Object.entries(file.hooks)) {
        for (const matcher of Array.isArray(matchers) ? matchers : []) {
          for (const hook of isObject(matcher) && Array.isArray(matcher.hooks) ? matcher.hooks : []) {
            if (!isObject(hook)) continue;
            const command = typeof hook.command === 'string' ? hook.command : typeof hook.prompt === 'string' ? `${String(hook.type ?? 'prompt')}: ${hook.prompt}` : typeof hook.type === 'string' ? hook.type : null;
            if (command && !hooks.some((h) => h.event === event && h.command === short(command))) hooks.push({ event, command: short(command) });
          }
        }
      }
    }
    if (isObject(file.permissions)) {
      for (const rule of strings(file.permissions.allow)) add(allow, short(rule));
      const mode = file.permissions.defaultMode;
      if (typeof mode === 'string' && mode !== 'default') add(settings, `defaultMode: ${short(mode)}`);
      for (const dir of strings(file.permissions.additionalDirectories)) add(settings, `additionalDirectories: ${short(dir)}`);
    }
    if (isObject(file.enabledPlugins)) for (const [plugin, on] of Object.entries(file.enabledPlugins)) if (on === true) add(plugins, short(plugin));
    if (isObject(file.extraKnownMarketplaces)) for (const name of Object.keys(file.extraKnownMarketplaces)) add(plugins, short(`marketplace: ${name}`));
    if (isObject(file.env)) for (const [key, value] of Object.entries(file.env)) add(settings, short(`env: ${key}=${String(value)}`));
    for (const key of COMMAND_SETTINGS) if (typeof file[key] === 'string') add(settings, short(`${key}: ${file[key]}`));
    if (isObject(file.statusLine) && typeof file.statusLine.command === 'string') add(settings, short(`statusLine: ${file.statusLine.command}`));
    if (file.enableAllProjectMcpServers === true) add(settings, 'enableAllProjectMcpServers: true');
  }

  if (isObject(files.mcp) && isObject(files.mcp.mcpServers)) {
    for (const [name, server] of Object.entries(files.mcp.mcpServers)) {
      if (!isObject(server)) continue;
      const what = typeof server.command === 'string' ? [server.command, ...strings(server.args)].join(' ') : typeof server.url === 'string' ? server.url : String(server.type ?? 'server');
      add(mcpServers, short(`${name}: ${what}`));
    }
  }
  return { hooks, mcpServers, allow, plugins, settings };
}

/** A JSON file's contents, or null when it is missing or isn't JSON. */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** What the repository in `root` brings, from its `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json`. */
export function readRepoBrings(root: string): RepoBrings {
  return repoBringsFrom({
    settings: [readJson(join(root, '.claude', 'settings.json')), readJson(join(root, '.claude', 'settings.local.json'))],
    mcp: readJson(join(root, '.mcp.json')),
  });
}
