import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../util/removeDir.ts';
import { makeRunWorktree } from './worktree.ts';
import { PushError, runPush } from './push.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => removeDir(d)));
});

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();

/** A repository with a remote (a bare one next to it), a first commit on main, and a worktree for the run. */
async function world(options: { remote?: boolean } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-push-')));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  const remote = join(dir, 'remote.git');
  run(dir, 'init', '--bare', '--initial-branch=main', remote);
  run(dir, 'init', '--initial-branch=main', repo);
  run(repo, 'config', 'user.email', 'test@example.com');
  run(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'README.md'), '# app\n');
  run(repo, 'add', '-A');
  run(repo, 'commit', '-m', 'first');
  if (options.remote !== false) {
    run(repo, 'remote', 'add', 'origin', remote);
    run(repo, 'push', '-u', 'origin', 'main');
    run(repo, 'remote', 'set-head', 'origin', 'main');
  }
  const cwd = await makeRunWorktree({ root: repo, name: 'run-one', fromCwd: repo });
  return { dir, repo, remote, cwd };
}

/** A gh that answers `pr create` with a URL and keeps what it was asked. */
function fakeGh(dir: string, fail?: string) {
  const script = join(dir, 'gh.cjs');
  const log = join(dir, 'gh.log');
  writeFileSync(
    script,
    `const fs = require('fs');
let body = '';
process.stdin.on('data', (d) => (body += d));
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), body }) + '\\n');
  ${fail ? `process.stderr.write(${JSON.stringify(fail)}); process.exit(1);` : "process.stdout.write('https://github.com/o/r/pull/152\\n');"}
});
`,
  );
  return { gh: { file: process.execPath, args: [script] }, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { args: string[]; body: string }) };
}

describe('makeRunWorktree', () => {
  it('makes the run’s worktree where Claude Code puts its own, on a branch of its own from where the run started', async () => {
    const { repo, cwd } = await world();
    expect(cwd).toBe(join(repo, '.claude', 'worktrees', 'run-one'));
    expect(run(cwd, 'branch', '--show-current')).toBe('worktree-run-one');
    expect(run(cwd, 'rev-parse', 'HEAD')).toBe(run(repo, 'rev-parse', 'HEAD'));
    await expect(makeRunWorktree({ root: repo, name: 'run-one', fromCwd: repo })).rejects.toThrow(/already/);
    await expect(makeRunWorktree({ root: join(repo, 'nowhere'), name: 'x', fromCwd: join(repo, 'nowhere') })).rejects.toThrow();
  });
});

describe('runPush', () => {
  it('commits what the run changed and pushes the branch', async () => {
    const { cwd, remote, dir } = await world();
    writeFileSync(join(cwd, 'feature.ts'), 'export const a = 1;\n');
    const steps: string[] = [];
    const result = await runPush(cwd, { commit: true, message: 'feat: a', pullRequest: null }, { env: {}, gh: fakeGh(dir).gh, onStep: (s) => steps.push(s) });
    expect(steps).toEqual(['commit', 'push']);
    expect(result).toMatchObject({ commit: { files: 1 }, pr: null, compareUrl: null, note: 'Committed 1 file and pushed worktree-run-one' });
    expect(run(remote, 'log', '-1', '--format=%s', 'worktree-run-one')).toBe('feat: a');
    expect(run(cwd, 'status', '--porcelain')).toBe('');
  });

  it('opens the pull request with gh, on the base branch, with the title and body', async () => {
    const { cwd, dir } = await world();
    writeFileSync(join(cwd, 'feature.ts'), 'x\n');
    const gh = fakeGh(dir);
    const steps: string[] = [];
    const result = await runPush(cwd, { commit: true, message: 'feat: a', pullRequest: { title: 'Add a toggle', body: '## Task\n\nAdd a toggle', base: null, draft: true } }, { env: {}, gh: gh.gh, onStep: (s) => steps.push(s) });
    expect(steps).toEqual(['commit', 'push', 'create']);
    expect(result).toMatchObject({ pr: { number: 152, url: 'https://github.com/o/r/pull/152', draft: true }, note: 'Pull request #152 opened' });
    const [call] = gh.calls();
    expect(call!.args).toEqual(['pr', 'create', '--title=Add a toggle', '--base=main', '--draft', '--body-file=-']);
    expect(call!.body).toBe('## Task\n\nAdd a toggle');
  });

  it('goes on when the steps already committed everything, and does not push twice', async () => {
    const { cwd, dir, remote } = await world();
    writeFileSync(join(cwd, 'feature.ts'), 'x\n');
    run(cwd, 'add', '-A');
    run(cwd, 'commit', '-m', 'by the step');
    const first = await runPush(cwd, { commit: true, message: 'unused', pullRequest: null }, { env: {}, gh: fakeGh(dir).gh, onStep: () => {} });
    expect(first.commit).toBeNull();
    expect(first.note).toBe('Pushed worktree-run-one');
    expect(run(remote, 'log', '-1', '--format=%s', 'worktree-run-one')).toBe('by the step');
    const steps: string[] = [];
    await runPush(cwd, { commit: true, message: null, pullRequest: null }, { env: {}, gh: fakeGh(dir).gh, onStep: (s) => steps.push(s) });
    expect(steps).toEqual([]);
  });

  it('needs a message for what it commits', async () => {
    const { cwd, dir } = await world();
    writeFileSync(join(cwd, 'feature.ts'), 'x\n');
    await expect(runPush(cwd, { commit: true, message: '  ', pullRequest: null }, { env: {}, gh: fakeGh(dir).gh, onStep: () => {} })).rejects.toThrow(/commit message/);
  });

  it('says why a commit failed, and pushes nothing', async () => {
    const { cwd, dir, remote } = await world();
    writeFileSync(join(cwd, 'feature.ts'), 'x\n');
    const hook = join(run(cwd, 'rev-parse', '--git-common-dir').startsWith('/') ? run(cwd, 'rev-parse', '--git-common-dir') : join(cwd, run(cwd, 'rev-parse', '--git-common-dir')), 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho "lint: no console.log" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    await expect(runPush(cwd, { commit: true, message: 'feat: a', pullRequest: null }, { env: {}, gh: fakeGh(dir).gh, onStep: () => {} })).rejects.toThrow(/The commit failed\. lint: no console\.log/);
    expect(run(remote, 'branch', '--list', 'worktree-run-one')).toBe('');
  });

  it('says what gh said when it can’t open the pull request, after the push', async () => {
    const { cwd, dir, remote } = await world();
    writeFileSync(join(cwd, 'feature.ts'), 'x\n');
    await expect(
      runPush(cwd, { commit: true, message: 'feat: a', pullRequest: { title: 't', body: 'b', base: 'main', draft: false } }, { env: {}, gh: fakeGh(dir, 'GraphQL: no commits between main and the branch').gh, onStep: () => {} }),
    ).rejects.toBeInstanceOf(PushError);
    // The branch is on the remote, so pressing Push again only has the pull request left to open.
    expect(run(remote, 'branch', '--list', 'worktree-run-one')).toContain('worktree-run-one');
  });

  it('refuses a repository without a remote', async () => {
    const { cwd, dir } = await world({ remote: false });
    writeFileSync(join(cwd, 'feature.ts'), 'x\n');
    await expect(runPush(cwd, { commit: true, message: 'feat: a', pullRequest: null }, { env: {}, gh: fakeGh(dir).gh, onStep: () => {} })).rejects.toThrow(/no remote/);
  });

  it('only pushes when the step does not commit', async () => {
    const { cwd, dir } = await world();
    writeFileSync(join(cwd, 'feature.ts'), 'x\n');
    const result = await runPush(cwd, { commit: false, message: 'ignored', pullRequest: null }, { env: {}, gh: fakeGh(dir).gh, onStep: () => {} });
    expect(result.commit).toBeNull();
    // The change stays uncommitted: nothing was asked to commit it.
    expect(run(cwd, 'status', '--porcelain')).toContain('feature.ts');
  });
});
