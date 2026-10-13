import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, worktreeStatus } from './gitChanges.ts';
import {
  chooseBase,
  classifyGhFailure,
  compareUrl,
  createPullRequest,
  findTemplates,
  firstUsefulLine,
  ghStatus,
  isPushRejection,
  parsePrUrl,
  parseRemoteUrl,
  parseShortstat,
  prCreateArgs,
  PrFailure,
  readPrDraft,
  runGh,
  type GhCommand,
  type RunResult,
} from './pullRequest.ts';

const failed = (stderr: string, stdout = '', code: number | null = 1): RunResult => ({ code, stdout, stderr, missing: false });

describe('gh output', () => {
  it('reads the pull request from the last URL gh printed', () => {
    expect(parsePrUrl('\nCreating pull request for feat/x into main in o/r\n\nhttps://github.com/o/r/pull/123\n')).toEqual({ number: 123, url: 'https://github.com/o/r/pull/123' });
    expect(parsePrUrl('https://ghe.example.com/team/app/pull/7')).toEqual({ number: 7, url: 'https://ghe.example.com/team/app/pull/7' });
    expect(parsePrUrl('Warning: 2 uncommitted changes\n')).toBeNull();
  });

  it('puts every value in --flag=value form and the description on stdin', () => {
    expect(prCreateArgs({ title: '-x: a title', base: 'main', draft: false })).toEqual(['pr', 'create', '--title=-x: a title', '--base=main', '--body-file=-']);
    expect(prCreateArgs({ title: 'T', base: 'release/0.1', draft: true })).toEqual(['pr', 'create', '--title=T', '--base=release/0.1', '--draft', '--body-file=-']);
  });

  it('maps what gh prints to what to do next', () => {
    expect(classifyGhFailure({ code: null, stdout: '', stderr: 'spawn gh ENOENT', missing: true }).code).toBe('GH_MISSING');
    expect(classifyGhFailure(failed('To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n', '', 4)).code).toBe('GH_AUTH');
    expect(classifyGhFailure(failed('HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n')).code).toBe('GH_AUTH');
    const exists = classifyGhFailure(failed('a pull request for branch "feat/sessions-archive" into branch "main" already exists:\nhttps://github.com/estruyf/switchboard/pull/118\n'));
    expect(exists).toMatchObject({ code: 'PR_EXISTS', pr: { number: 118, url: 'https://github.com/estruyf/switchboard/pull/118' } });
    expect(classifyGhFailure(failed('pull request create failed: GraphQL: Body is too long (maximum is 65536 characters) (createPullRequest)\n')).code).toBe('BODY_TOO_LONG');
    const other = classifyGhFailure(failed("pull request create failed: GraphQL: No commits between main and feat/x (createPullRequest)\n"));
    expect(other).toMatchObject({ code: 'UNKNOWN', message: 'pull request create failed: GraphQL: No commits between main and feat/x (createPullRequest)' });
  });

  it('picks the line that says what went wrong', () => {
    const rejected = [
      'To github.com:estruyf/switchboard.git',
      ' ! [rejected]        feat/sessions-archive -> feat/sessions-archive (fetch first)',
      "error: failed to push some refs to 'github.com:estruyf/switchboard.git'",
      'hint: Updates were rejected because the remote contains work that you do not',
    ].join('\n');
    expect(isPushRejection(rejected)).toBe(true);
    expect(firstUsefulLine(rejected)).toBe('[rejected]        feat/sessions-archive -> feat/sessions-archive (fetch first)');
    expect(isPushRejection("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe(false);
    expect(firstUsefulLine("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe("could not read Username for 'https://github.com': terminal prompts disabled");
    expect(isPushRejection(' ! [remote rejected] main -> main (protected branch hook declined)')).toBe(true);
  });
});

describe('remotes and bases', () => {
  it('reads the host and owner/name of the URLs git takes', () => {
    expect(parseRemoteUrl('git@github.com:estruyf/switchboard.git')).toEqual({ host: 'github.com', repo: 'estruyf/switchboard' });
    expect(parseRemoteUrl('https://github.com/estruyf/switchboard')).toEqual({ host: 'github.com', repo: 'estruyf/switchboard' });
    expect(parseRemoteUrl('ssh://git@GHE.example.com:2222/team/app.git')).toEqual({ host: 'ghe.example.com', repo: 'team/app' });
    expect(parseRemoteUrl('https://user@github.com/o/r.git/')).toEqual({ host: 'github.com', repo: 'o/r' });
    expect(parseRemoteUrl('/tmp/remote.git')).toBeNull();
    expect(parseRemoteUrl('C:\\repos\\remote.git')).toBeNull();
  });

  it("chooses the asked base, else the project's when the remote has it, else the remote's default, else main", () => {
    const branches = ['main', 'develop', 'release/0.1'];
    expect(chooseBase({ asked: 'release/0.1', projectBase: 'develop', remoteDefault: 'main', branches, head: 'feat' })).toBe('release/0.1');
    expect(chooseBase({ projectBase: 'develop', remoteDefault: 'main', branches, head: 'feat' })).toBe('develop');
    expect(chooseBase({ projectBase: 'gone', remoteDefault: 'trunk', branches, head: 'feat' })).toBe('trunk');
    expect(chooseBase({ projectBase: null, remoteDefault: null, branches: [], head: 'feat' })).toBe('main');
    // Never the branch itself: a project whose default branch is this one gets the remote's default.
    expect(chooseBase({ projectBase: 'develop', remoteDefault: 'main', branches, head: 'develop' })).toBe('main');
    expect(chooseBase({ projectBase: null, remoteDefault: 'main', branches, head: 'main' })).toBe('master');
  });

  it('leaves the description out of the compare URL, and a title that would make it long', () => {
    expect(compareUrl({ host: 'github.com', repo: 'o/r' }, 'main', 'feat/x', 'Fix it')).toBe('https://github.com/o/r/compare/main...feat/x?expand=1&title=Fix%20it');
    expect(compareUrl({ host: 'github.com', repo: 'o/r' }, 'main', 'feat/x', 'x'.repeat(3_000))).toBe('https://github.com/o/r/compare/main...feat/x?expand=1');
  });

  it('reads git diff --shortstat', () => {
    expect(parseShortstat(' 9 files changed, 412 insertions(+), 37 deletions(-)\n')).toEqual({ files: 9, additions: 412, deletions: 37 });
    expect(parseShortstat(' 1 file changed, 1 deletion(-)\n')).toEqual({ files: 1, additions: 0, deletions: 1 });
    expect(parseShortstat('')).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});

describe('findTemplates', () => {
  let top: string;
  beforeEach(() => (top = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-templates-')))));
  afterEach(() => rmSync(top, { recursive: true, force: true }));

  it("finds them in GitHub's order: .github, the top folder, docs, then the folder of templates by name", () => {
    mkdirSync(join(top, '.github', 'PULL_REQUEST_TEMPLATE'), { recursive: true });
    mkdirSync(join(top, 'docs'));
    writeFileSync(join(top, 'docs', 'pull_request_template.md'), 'docs');
    writeFileSync(join(top, 'pull_request_template.md'), 'top');
    writeFileSync(join(top, '.github', 'pull_request_template.md'), '## What changed\n');
    writeFileSync(join(top, '.github', 'PULL_REQUEST_TEMPLATE', 'feature.md'), 'feature');
    writeFileSync(join(top, '.github', 'PULL_REQUEST_TEMPLATE', 'bugfix.md'), 'bugfix');
    writeFileSync(join(top, '.github', 'PULL_REQUEST_TEMPLATE', 'notes.png'), 'not a template');
    writeFileSync(join(top, '.github', 'ISSUE_TEMPLATE.md'), 'an issue template');
    expect(findTemplates(top)).toEqual([
      { path: '.github/pull_request_template.md', content: '## What changed\n' },
      { path: 'pull_request_template.md', content: 'top' },
      { path: 'docs/pull_request_template.md', content: 'docs' },
      { path: '.github/PULL_REQUEST_TEMPLATE/bugfix.md', content: 'bugfix' },
      { path: '.github/PULL_REQUEST_TEMPLATE/feature.md', content: 'feature' },
    ]);
  });

  it('takes the name in any case, as GitHub does', () => {
    mkdirSync(join(top, '.github'));
    writeFileSync(join(top, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'upper');
    expect(findTemplates(top)).toEqual([{ path: '.github/PULL_REQUEST_TEMPLATE.md', content: 'upper' }]);
  });

  it('finds none in a checkout without them', () => {
    expect(findTemplates(top)).toEqual([]);
  });
});

describe('creating a pull request', () => {
  let repo: string;
  let remote: string;
  let scratch: string;
  let gh: GhCommand;
  const run = (...args: string[]) => git(repo, args);
  const env = () => ({ HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '', FAKE_GH_LOG: join(scratch, 'gh.json'), HOOK_LOG: join(scratch, 'hook.txt') });
  const ghLog = () => JSON.parse(readFileSync(join(scratch, 'gh.json'), 'utf8')) as { argv: string[]; stdin: string; env: Record<string, string> };

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-pr-')));
    remote = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-pr-remote-')));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-pr-gh-')));
    // A fake gh: it writes down how it was started and what came in on stdin, then answers as FAKE_GH_MODE says.
    const script = join(scratch, 'gh.mjs');
    writeFileSync(
      script,
      `import { readFileSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const stdin = argv.includes('--body-file=-') ? readFileSync(0, 'utf8') : '';
writeFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ argv, stdin, env: { GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED } }));
const mode = process.env.FAKE_GH_MODE ?? 'ok';
if (argv[0] === 'auth' && mode === 'signed-out') { process.stderr.write('You are not logged into any GitHub hosts. To log in, run: gh auth login\\n'); process.exit(1); }
if (argv[0] === 'auth' && mode === 'offline') { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
if (argv[0] === 'auth') process.exit(0);
if (mode === 'exists') { process.stderr.write('a pull request for branch "feat/x" into branch "main" already exists:\\nhttps://github.com/o/r/pull/118\\n'); process.exit(1); }
if (mode === 'signed-out') { process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\\n'); process.exit(4); }
process.stdout.write('https://github.com/o/r/pull/123\\n');
`,
    );
    gh = { file: process.execPath, args: [script] };
    await git(remote, ['init', '-q', '--bare', '-b', 'main']);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.com');
    await run('config', 'user.name', 'Test');
    await run('config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    await run('add', '.');
    await run('commit', '-qm', 'initial');
    await run('remote', 'add', 'origin', remote);
    await run('push', '-q', '-u', 'origin', 'main');
    await run('switch', '-q', '-c', 'feat/x');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    await run('commit', '-qam', 'Add two');
    // The push runs the pre-push hook: it shows git was told never to ask for a password.
    const hook = join(repo, '.git', 'hooks', 'pre-push');
    writeFileSync(hook, '#!/bin/sh\nif [ -n "$HOOK_LOG" ]; then echo "prompt=$GIT_TERMINAL_PROMPT" > "$HOOK_LOG"; fi\nexit 0\n');
    chmodSync(hook, 0o755);
  });

  afterEach(() => {
    for (const dir of [repo, remote, scratch]) rmSync(dir, { recursive: true, force: true });
  });

  const create = async (request: Partial<Parameters<typeof createPullRequest>[1]> = {}, extraEnv: Record<string, string> = {}) => {
    const steps: string[] = [];
    const result = await createPullRequest(
      await worktreeStatus(repo),
      { title: 'Add two', body: '## What changed\nTwo.\n', base: 'main', draft: false, web: false, ...request },
      { env: { ...env(), ...extraEnv }, gh, onStep: (step) => steps.push(step) },
    );
    return { result, steps };
  };

  it('reads the draft: commits, diff, base, remote branches and templates', async () => {
    mkdirSync(join(repo, '.github'));
    writeFileSync(join(repo, '.github', 'pull_request_template.md'), '## What changed\n');
    await run('push', '-q', 'origin', 'main:release/0.1');
    const draft = await readPrDraft(await worktreeStatus(repo), { projectBase: null });
    expect(draft).toMatchObject({ branch: 'feat/x', remote: 'origin', hasUpstream: false, ahead: 1, commits: ['Add two'], files: 1, additions: 1, deletions: 0, base: 'main', templates: [{ path: '.github/pull_request_template.md' }] });
    expect([...draft.branches].sort()).toEqual(['main', 'release/0.1']);
    expect((await readPrDraft(await worktreeStatus(repo), { base: 'release/0.1', projectBase: null })).base).toBe('release/0.1');
  });

  it('publishes a branch without an upstream, then gives gh the description on stdin, not in its arguments', async () => {
    const { result, steps } = await create({ draft: true });
    expect(steps).toEqual(['push', 'create']);
    expect(result).toEqual({ pr: { number: 123, url: 'https://github.com/o/r/pull/123', draft: true } });
    expect((await git(remote, ['rev-parse', 'feat/x'])).trim()).toBe((await run('rev-parse', 'HEAD')).trim());
    expect((await worktreeStatus(repo)).upstream).toBe('origin/feat/x');
    expect(readFileSync(join(scratch, 'hook.txt'), 'utf8').trim()).toBe('prompt=0');
    const log = ghLog();
    expect(log.stdin).toBe('## What changed\nTwo.\n');
    expect(log.argv).toEqual(['pr', 'create', '--title=Add two', '--base=main', '--draft', '--body-file=-']);
    expect(log.argv.join(' ')).not.toContain('What changed');
    expect(log.env.GH_PROMPT_DISABLED).toBe('1');
  });

  it('pushes new commits to the upstream, and skips the push when there are none', async () => {
    await run('push', '-q', '-u', 'origin', 'feat/x');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    await run('commit', '-qam', 'Add three');
    await create();
    expect((await git(remote, ['rev-parse', 'feat/x'])).trim()).toBe((await run('rev-parse', 'HEAD')).trim());
    rmSync(join(scratch, 'hook.txt'));
    const { steps } = await create();
    expect(steps).toEqual(['push', 'create']);
    expect(() => readFileSync(join(scratch, 'hook.txt'))).toThrow();
  });

  it('says the remote has commits this branch lacks when the push is turned down', async () => {
    await run('push', '-q', '-u', 'origin', 'feat/x');
    const other = join(scratch, 'other');
    await git(scratch, ['clone', '-q', '-b', 'feat/x', remote, other]);
    await git(other, ['-c', 'user.email=o@example.com', '-c', 'user.name=O', 'commit', '-q', '--allow-empty', '-m', 'theirs']);
    await git(other, ['push', '-q']);
    writeFileSync(join(repo, 'a.txt'), 'mine\n');
    await run('commit', '-qam', 'mine');
    const error = await create().then(
      () => null,
      (e: unknown) => (e instanceof PrFailure ? e.error : null),
    );
    expect(error).toMatchObject({ code: 'PUSH_REJECTED', message: "origin has 1 commit this branch doesn't have." });
    expect(error?.output).toContain('rejected');
  });

  it('reports a pull request that is already there, and a missing or signed-out gh', async () => {
    const exists = await create({}, { FAKE_GH_MODE: 'exists' }).catch((e: PrFailure) => e.error);
    expect(exists).toMatchObject({ code: 'PR_EXISTS', pr: { number: 118 } });
    gh = { file: join(scratch, 'no-such-gh'), args: [] };
    expect(await create().catch((e: PrFailure) => e.error.code)).toBe('GH_MISSING');
    expect(await ghStatus(gh, repo, env(), 'github.com')).toEqual({ installed: false, signedIn: false, host: 'github.com' });
  });

  it('checks the sign-in through gh auth status', async () => {
    expect(await ghStatus(gh, repo, env(), 'github.com')).toEqual({ installed: true, signedIn: true, host: 'github.com' });
    expect(ghLog().argv).toEqual(['auth', 'status', '--hostname=github.com']);
    expect((await ghStatus(gh, repo, { ...env(), FAKE_GH_MODE: 'signed-out' }, 'github.com')).signedIn).toBe(false);
    // Offline gh can't tell: the dialog doesn't stop you for that.
    expect((await ghStatus(gh, repo, { ...env(), FAKE_GH_MODE: 'offline' }, 'github.com')).signedIn).toBe(null);
  });

  it('refuses a description longer than GitHub takes before pushing anything', async () => {
    const { PR_BODY_LIMIT } = await import('@switchboard/protocol');
    const error = await create({ body: 'x'.repeat(PR_BODY_LIMIT + 1) }).catch((e: PrFailure) => e.error.code);
    expect(error).toBe('BODY_TOO_LONG');
    expect((await git(remote, ['branch', '--list', 'feat/x'])).trim()).toBe('');
  });

  it('runs gh without a shell, so quotes and && in a value stay text', async () => {
    const result = await runGh(gh, ['pr', 'create', '--title=it\'s "a" && b', '--base=main', '--body-file=-'], { cwd: repo, env: env(), input: '$(whoami) `x`' });
    expect(result.code).toBe(0);
    expect(ghLog()).toMatchObject({ argv: ['pr', 'create', '--title=it\'s "a" && b', '--base=main', '--body-file=-'], stdin: '$(whoami) `x`' });
  });
});
