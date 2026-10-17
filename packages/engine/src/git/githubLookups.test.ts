import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './gitChanges.ts';
import { findIssue, NO_REMOTE, openPullRequests, parseIssueRef } from './githubLookups.ts';
import type { GhCommand } from './pullRequest.ts';

describe('parseIssueRef', () => {
  it('reads links, #123 and 123', () => {
    expect(parseIssueRef('https://github.com/estruyf/switchboard/issues/132')).toEqual({ number: 132, url: 'https://github.com/estruyf/switchboard/issues/132' });
    expect(parseIssueRef(' https://github.com/o/r/issues/7#issuecomment-1 ')).toEqual({ number: 7, url: 'https://github.com/o/r/issues/7' });
    expect(parseIssueRef('#123')).toEqual({ number: 123, url: null });
    expect(parseIssueRef('123')).toEqual({ number: 123, url: null });
    expect(parseIssueRef('support mods')).toBeNull();
    expect(parseIssueRef('https://example.com/o/r/issues/1')).toBeNull();
  });
});

describe('GitHub lookups', () => {
  let repo: string;
  let scratch: string;
  let gh: GhCommand;
  const env = (mode = 'ok') => ({ HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '', FAKE_GH_MODE: mode });

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-gh-')));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-gh-fake-')));
    // A fake gh that answers as FAKE_GH_MODE says.
    const script = join(scratch, 'gh.mjs');
    writeFileSync(
      script,
      `const argv = process.argv.slice(2);
const mode = process.env.FAKE_GH_MODE;
if (mode === 'signed-out') { process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\\n'); process.exit(4); }
if (argv[0] === 'pr') process.stdout.write(JSON.stringify([{ number: 142, title: 'Claude Code mods', url: 'https://github.com/o/r/pull/142', isDraft: false, reviewDecision: 'APPROVED', reviews: [{}, {}], headRefName: 'feat/mods' }]));
else if (argv[0] === 'issue' && argv[2] === '404') { process.stderr.write('GraphQL: Could not resolve to an issue or pull request with the number of 404.\\n'); process.exit(1); }
else if (argv[0] === 'issue') process.stdout.write(JSON.stringify({ number: Number(String(argv[2]).split('/').pop()), title: 'Support Claude Code Mods', url: 'https://github.com/o/r/issues/' + String(argv[2]).split('/').pop() }));
`,
    );
    gh = { file: process.execPath, args: [script] };
    await git(repo, ['init', '-q', '-b', 'main']);
  });
  afterEach(() => [repo, scratch].forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('says why there is nothing without a GitHub remote', async () => {
    expect(await openPullRequests(repo, env(), gh)).toEqual({ pullRequests: [], repo: null, reason: NO_REMOTE });
    expect(await findIssue(repo, '#1', env(), gh)).toEqual({ issue: null, reason: NO_REMOTE });
  });

  it('lists open pull requests and finds issues', async () => {
    await git(repo, ['remote', 'add', 'origin', 'git@github.com:o/r.git']);
    expect(await openPullRequests(repo, env(), gh)).toEqual({
      pullRequests: [{ number: 142, title: 'Claude Code mods', url: 'https://github.com/o/r/pull/142', draft: false, review: 'approved', reviews: 2, branch: 'feat/mods' }],
      repo: 'o/r',
      reason: null,
    });
    expect(await findIssue(repo, '#132', env(), gh)).toEqual({ issue: { number: 132, title: 'Support Claude Code Mods', url: 'https://github.com/o/r/issues/132' }, reason: null });
    expect(await findIssue(repo, '404', env(), gh)).toEqual({ issue: null, reason: 'No issue #404 found.' });
  });

  it('says when gh is signed out or missing', async () => {
    await git(repo, ['remote', 'add', 'origin', 'https://github.com/o/r']);
    expect((await openPullRequests(repo, env('signed-out'), gh)).reason).toBe('gh is not signed in to GitHub. Run gh auth login.');
    expect((await openPullRequests(repo, env(), { file: join(scratch, 'no-such-gh'), args: [] })).reason).toBe("GitHub CLI (gh) isn't installed.");
  });
});
