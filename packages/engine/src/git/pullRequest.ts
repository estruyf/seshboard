import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PR_BODY_LIMIT, type PrDraft, type PrError, type PrTemplate, type WorktreePullRequest, type WorktreeStatus } from '@switchboard/protocol';
import { baseBranch, git, GitError } from './gitChanges.ts';

/**
 * How to start the GitHub CLI: `gh` from the PATH, or the program `SWITCHBOARD_GH` names (the smoke test's fake, so
 * it never reaches GitHub). Tests pass Node and a script, which works the same on Windows.
 */
export interface GhCommand {
  file: string;
  args: string[];
}

export const defaultGh = (): GhCommand => ({ file: process.env.SWITCHBOARD_GH || 'gh', args: [] });

/** gh never asks anything (there is no terminal), and prints plain text. */
export const ghEnv = (env: Record<string, string>): Record<string, string> => ({ ...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1' });

export interface RunResult {
  /** The exit code; null when it was stopped or never started. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The program isn't installed (or not on the PATH). */
  missing: boolean;
}

/**
 * Runs gh in `cwd` without a shell, so no argument is ever read as code and Windows PowerShell's missing `&&` doesn't
 * matter. `input` goes to its stdin (the description: never on the command line or in a URL).
 */
export function runGh(gh: GhCommand, args: string[], options: { cwd: string; env: Record<string, string>; input?: string; timeout?: number }): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const child = spawn(gh.file, [...gh.args, ...args], { cwd: options.cwd, env: { ...process.env, ...ghEnv(options.env) }, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      done({ code: null, stdout, stderr: `${stderr}\ngh took too long and was stopped.`.trim(), missing: false });
    }, options.timeout ?? 120_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) => done({ code: null, stdout, stderr: stderr || error.message, missing: error.code === 'ENOENT' }));
    child.on('close', (code) => done({ code, stdout, stderr, missing: false }));
    // gh may exit before reading all of it (it failed early); that is reported through its exit code, not here.
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}

/** The arguments of `gh pr create`. Values go in `--flag=value` form, so a title starting with `-` stays a title. */
export function prCreateArgs({ title, base, draft }: { title: string; base: string; draft: boolean }): string[] {
  return ['pr', 'create', `--title=${title}`, `--base=${base}`, ...(draft ? ['--draft'] : []), '--body-file=-'];
}

/** The pull request gh printed (its URL, the last line of stdout), or null. */
export function parsePrUrl(output: string): { number: number; url: string } | null {
  const matches = [...output.matchAll(/(https?:\/\/\S+?\/pull\/(\d+))(?=\s|$)/g)];
  const last = matches.at(-1);
  return last ? { number: Number(last[2]), url: last[1]! } : null;
}

/** The line worth showing from git's or gh's output: the first that says something, without `error:` and the like. */
export function firstUsefulLine(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(hint:|To |Warning: \d+ uncommitted|remote:\s*$)/i.test(line));
  const line = lines.find((l) => /\[(remote )?rejected\]|error:|fatal:|failed/i.test(l)) ?? lines[0] ?? '';
  return line.replace(/^(error|fatal|X|!)[:\s]+/i, '').trim();
}

const failure = (code: PrError['code'], message: string, output: string | null = null, pr: PrError['pr'] = null): PrError => ({ code, message, output: output?.trim() || null, pr });

/** Why `gh pr create` failed, from what it printed. */
export function classifyGhFailure(result: RunResult): PrError {
  if (result.missing) return failure('GH_MISSING', "GitHub CLI isn't installed.");
  const output = `${result.stderr}\n${result.stdout}`.trim();
  if (/already exists/i.test(output)) {
    const pr = parsePrUrl(output);
    return failure('PR_EXISTS', pr ? `This branch already has a pull request: #${pr.number}.` : 'This branch already has a pull request.', output, pr);
  }
  if (/gh auth login|not logged in|authentication required|HTTP 401|bad credentials|GH_TOKEN/i.test(output)) return failure('GH_AUTH', 'Not signed in to GitHub.', output);
  if (/body is too long/i.test(output)) return failure('BODY_TOO_LONG', `The description is longer than GitHub takes (${PR_BODY_LIMIT.toLocaleString('en-US')} characters).`, output);
  return failure('UNKNOWN', firstUsefulLine(output) || `gh stopped${result.code === null ? '' : ` with exit code ${result.code}`}.`, output);
}

/** The remote turned the push down: it has commits this branch doesn't, or a rule (a protected branch, a hook) said no. */
export const isPushRejection = (output: string) => /\[(remote )?rejected\]|non-fast-forward|fetch first|updates were rejected/i.test(output);

/** The host and `owner/name` a remote URL points at: `git@host:o/n.git`, `https://host/o/n`, `ssh://git@host:22/o/n.git`. */
export function parseRemoteUrl(url: string): { host: string; repo: string } | null {
  const trimmed = url.trim();
  const match =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(trimmed) ?? /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(trimmed);
  if (!match) return null;
  const parts = match[2]!.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { host: match[1]!.toLowerCase(), repo: parts.slice(-2).join('/') };
}

/**
 * The base a pull request goes into: the one asked for, else the project's base branch when the remote has it, else
 * the remote's default branch, else main. Never the branch itself.
 */
export function chooseBase(options: { asked?: string | null; projectBase: string | null; remoteDefault: string | null; branches: readonly string[]; head: string }): string {
  const { asked, projectBase, remoteDefault, branches, head } = options;
  const candidates = [asked, projectBase && branches.includes(projectBase) ? projectBase : null, remoteDefault, 'main', 'master'];
  return candidates.find((c): c is string => !!c && c !== head) ?? 'main';
}

const SINGLE_TEMPLATE = /^pull_request_template(\.(md|markdown|txt))?$/i;
const TEMPLATE_FILE = /\.(md|markdown|txt)$/i;
/** Templates larger than GitHub would take aren't offered. */
const MAX_TEMPLATE_BYTES = 256 * 1024;

const entries = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const readTemplate = (path: string): string | null => {
  try {
    if (statSync(path).size > MAX_TEMPLATE_BYTES) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * The pull request templates in a checkout, in GitHub's order: `pull_request_template.md` in `.github/`, the top
 * folder and `docs/` (any case; lowercase first), then every file in `.github/PULL_REQUEST_TEMPLATE/`, by name.
 */
export function findTemplates(top: string): PrTemplate[] {
  const found: PrTemplate[] = [];
  const add = (rel: string) => {
    const content = readTemplate(join(top, ...rel.split('/')));
    if (content !== null) found.push({ path: rel, content });
  };
  for (const dir of ['.github', '', 'docs']) {
    const singles = entries(join(top, dir))
      .filter((e) => e.isFile() && SINGLE_TEMPLATE.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => Number(a !== a.toLowerCase()) - Number(b !== b.toLowerCase()) || a.localeCompare(b));
    for (const name of singles) add(dir ? `${dir}/${name}` : name);
  }
  const folder = entries(join(top, '.github')).find((e) => e.isDirectory() && /^pull_request_template$/i.test(e.name));
  if (folder) {
    const files = entries(join(top, '.github', folder.name))
      .filter((e) => e.isFile() && TEMPLATE_FILE.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    for (const name of files) add(`.github/${folder.name}/${name}`);
  }
  return found;
}

/** "9 files changed, 412 insertions(+), 37 deletions(-)" → the numbers. */
export function parseShortstat(text: string): { files: number; additions: number; deletions: number } {
  const number = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0);
  return { files: number(/(\d+) files? changed/), additions: number(/(\d+) insertions?\(\+\)/), deletions: number(/(\d+) deletions?\(-\)/) };
}

/** Why no pull request can come from this checkout, or null when one can. */
export function draftRefusal(status: WorktreeStatus): { code: string; message: string } | null {
  if (!status.branch) return { code: 'DETACHED', message: 'HEAD is detached; check out a branch first.' };
  if (!status.hasRemote || !status.pushRemote) return { code: 'NO_REMOTE', message: 'This repository has no remote.' };
  if (status.branch === status.baseBranch) return { code: 'WRONG_BRANCH', message: `${status.branch} is the base branch; open a pull request from another branch.` };
  return null;
}

/** What `git.prDraft` reads from git and the checkout's files. gh's part (`existingPr`, `gh`) is added by the caller. */
export async function readPrDraft(status: WorktreeStatus, options: { base?: string; projectBase: string | null }): Promise<Omit<PrDraft, 'existingPr' | 'gh'>> {
  const branch = status.branch!;
  const cwd = status.path;
  // The remote the branch tracks (a remote's name can't be read off `origin/feat/x` reliably), else where it would go.
  const tracked = status.upstream ? (await git(cwd, ['config', '--get', `branch.${branch}.remote`], { allowExitCodes: [1] }).catch(() => '')).trim() : '';
  const remote = tracked && tracked !== '.' ? tracked : status.pushRemote!;
  const [refs, symbolic, url] = await Promise.all([
    git(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', `refs/remotes/${remote}`]).catch(() => ''),
    git(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { allowExitCodes: [1, 128] }).catch(() => ''),
    git(cwd, ['remote', 'get-url', remote], { allowExitCodes: [2, 128] }).catch(() => ''),
  ]);
  const prefix = `refs/remotes/${remote}/`;
  const branches = refs
    .split('\n')
    .filter((ref) => ref.startsWith(prefix))
    .map((ref) => ref.slice(prefix.length))
    .filter((name) => name && name !== 'HEAD' && name !== branch);
  const remoteDefault = symbolic.trim() ? symbolic.trim().slice(remote.length + 1) : await baseBranch(cwd);
  const base = chooseBase({ asked: options.base ?? null, projectBase: options.projectBase, remoteDefault, branches, head: branch });

  // Against the remote's copy of the base when there is one (what GitHub compares with), else the local branch.
  const exists = async (ref: string) => (await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowExitCodes: [1, 128] }).catch(() => '')).trim() !== '';
  const baseRef = (await exists(`${prefix}${base}`)) ? `${prefix}${base}` : (await exists(`refs/heads/${base}`)) ? `refs/heads/${base}` : null;
  const range = baseRef ? [`${baseRef}..HEAD`] : ['HEAD', '--not', '--remotes'];
  const [log, stat] = await Promise.all([
    git(cwd, ['log', '--reverse', '--no-merges', '--format=%s', '--max-count=5000', ...range]).catch(() => ''),
    baseRef ? git(cwd, ['diff', '--shortstat', '--no-ext-diff', `${baseRef}...HEAD`]).catch(() => '') : Promise.resolve(''),
  ]);
  const ahead = status.upstream
    ? (status.unpushed ?? 0)
    : Number((await git(cwd, ['rev-list', '--count', 'HEAD', '--not', `--remotes=${remote}`]).catch(() => '0')).trim() || 0);
  return {
    path: cwd,
    branch,
    remote,
    hasUpstream: status.upstream !== null,
    ahead,
    commits: log.split('\n').filter(Boolean),
    ...parseShortstat(stat),
    base,
    remoteDefault,
    branches,
    repo: parseRemoteUrl(url)?.repo ?? null,
    templates: findTemplates(cwd),
  };
}

/** Whether gh is there and signed in to `host`. Signed in is null when gh couldn't say (offline, an odd answer). */
export async function ghStatus(gh: GhCommand, cwd: string, env: Record<string, string>, host: string): Promise<PrDraft['gh']> {
  const result = await runGh(gh, ['auth', 'status', `--hostname=${host}`], { cwd, env, timeout: 15_000 });
  if (result.missing) return { installed: false, signedIn: false, host };
  if (result.code === 0) return { installed: true, signedIn: true, host };
  const output = `${result.stderr}\n${result.stdout}`;
  return { installed: true, signedIn: /not logged in|gh auth login|no oauth token/i.test(output) ? false : null, host };
}

/** A pull request that couldn't be created, with what to say about it. */
export class PrFailure extends Error {
  constructor(readonly error: PrError) {
    super(error.message);
  }
}

export interface CreateRequest {
  title: string;
  body: string;
  base: string;
  draft: boolean;
  /** Push, then end with GitHub's compare page instead of running gh. */
  web: boolean;
}

/**
 * Pushes the branch (when it has commits the remote doesn't, or no upstream yet) and creates the pull request with
 * gh, the description on its stdin. `onStep` hears each step start. Throws `PrFailure` with the reason.
 * `env` is the login shell's, so credential helpers, ssh-agent and gh work; nothing can ask for a password.
 */
export async function createPullRequest(
  status: WorktreeStatus,
  request: CreateRequest,
  options: { env: Record<string, string>; gh: GhCommand; onStep(step: 'push' | 'create'): void },
): Promise<{ pr: { number: number; url: string; draft: boolean } } | { compareUrl: string }> {
  const refused = draftRefusal(status);
  if (refused) throw new PrFailure(failure('UNKNOWN', refused.message));
  if (request.body.length > PR_BODY_LIMIT) throw new PrFailure(failure('BODY_TOO_LONG', `The description is longer than GitHub takes (${PR_BODY_LIMIT.toLocaleString('en-US')} characters).`));
  const branch = status.branch!;
  const remote = status.pushRemote!;

  options.onStep('push');
  if (!status.upstream || (status.unpushed ?? 0) > 0) {
    const args = status.upstream ? ['push'] : ['push', '-u', remote, branch];
    try {
      // Pre-push hooks can run tests: give them time.
      await git(status.path, args, { env: { ...options.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 10 * 60_000 });
    } catch (error) {
      const output = error instanceof GitError ? error.message : String(error);
      if (!isPushRejection(output)) throw new PrFailure(failure('UNKNOWN', `The push failed: ${firstUsefulLine(output)}`, output));
      throw new PrFailure(failure('PUSH_REJECTED', await rejectionReason(status, output, options.env), output));
    }
  }

  if (request.web) {
    const url = (await git(status.path, ['remote', 'get-url', remote]).catch(() => '')).trim();
    const where = parseRemoteUrl(url);
    if (!where) throw new PrFailure(failure('UNKNOWN', `Switchboard can't tell which website ${remote} is on.`));
    return { compareUrl: compareUrl(where, request.base, branch, request.title) };
  }

  options.onStep('create');
  const result = await runGh(options.gh, prCreateArgs(request), { cwd: status.path, env: options.env, input: request.body, timeout: 2 * 60_000 });
  if (result.code !== 0 || result.missing) throw new PrFailure(classifyGhFailure(result));
  const pr = parsePrUrl(result.stdout) ?? parsePrUrl(result.stderr);
  if (!pr) throw new PrFailure(failure('UNKNOWN', "gh finished without saying where the pull request is.", `${result.stdout}\n${result.stderr}`));
  return { pr: { ...pr, draft: request.draft } };
}

/**
 * GitHub's page for opening a pull request from `branch` into `base`. Only the title goes in the URL, and only when
 * it stays short: the description is what made `gh pr create --web` fail with "URL too long".
 */
export function compareUrl(where: { host: string; repo: string }, base: string, branch: string, title: string): string {
  const path = (name: string) => name.split('/').map(encodeURIComponent).join('/');
  const url = `https://${where.host}/${where.repo}/compare/${path(base)}...${path(branch)}?expand=1`;
  const withTitle = `${url}&title=${encodeURIComponent(title)}`;
  return withTitle.length <= 2_000 ? withTitle : url;
}

/** "origin has 2 commits this branch doesn't have." when the remote moved on, else git's own line. */
async function rejectionReason(status: WorktreeStatus, output: string, env: Record<string, string>): Promise<string> {
  const remote = status.pushRemote!;
  const branch = status.branch!;
  if (/non-fast-forward|fetch first|remote contains work/i.test(output)) {
    await git(status.path, ['fetch', '--quiet', remote, branch], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 60_000 }).catch(() => '');
    const count = Number((await git(status.path, ['rev-list', '--count', `HEAD..refs/remotes/${remote}/${branch}`], { allowExitCodes: [128] }).catch(() => '0')).trim() || 0);
    if (count > 0) return `${remote} has ${count === 1 ? '1 commit' : `${count} commits`} this branch doesn't have.`;
    return `${remote} has commits this branch doesn't have.`;
  }
  return firstUsefulLine(output);
}

/** The pull request a branch has, from the list `fetchPullRequests` made. */
export const prOf = (prs: ReadonlyMap<string, WorktreePullRequest> | null, branch: string | null) => (prs && branch ? (prs.get(branch) ?? null) : null);
