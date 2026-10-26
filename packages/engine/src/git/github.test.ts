import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './gitChanges.ts';
import { canPush, GITHUB_CACHE_MS, GithubService, parseGithubRef, unresolvedComments } from './github.ts';
import type { GhCommand } from './pullRequest.ts';

/**
 * A fake gh that answers from fixed JSON, as FAKE_GH_MODE says (`ok`, `signed-out`, `rate-limited`, `offline`), and
 * writes each call to FAKE_GH_LOG. It never reaches GitHub.
 */
const FAKE_GH = String.raw`
const { appendFileSync } = require('node:fs');
const argv = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, argv.join(' ') + '\n');
const mode = process.env.FAKE_GH_MODE || 'ok';
const fail = (text, code = 1) => { process.stderr.write(text + '\n'); process.exit(code); };
if (mode === 'signed-out') fail('To get started with GitHub CLI, please run:  gh auth login', 4);
if (argv[0] === 'auth') process.exit(0);
if (mode === 'rate-limited') fail('GraphQL: API rate limit exceeded for user ID 1.');
if (mode === 'offline') fail('error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\ndial tcp: lookup api.github.com: no such host');
const url = (kind, n) => 'https://github.com/o/r/' + kind + '/' + n;
const issues = [
  { number: 32, title: 'Start a session from a GitHub issue or pull request', state: 'OPEN', labels: [{ name: 'enhancement', color: 'A2EEEF' }], author: { login: 'estruyf' }, createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z', url: url('issues', 32), body: 'Type # in the box.\n` + '```' + String.raw`\nclosing fence\n` + '```' + String.raw`', comments: [{}, {}, {}, {}] },
  { number: 118, title: 'Session list loses scroll position after archive', state: 'OPEN', labels: [{ name: 'bug', color: 'd73a4a' }], author: { login: 'a-contributor' }, updatedAt: '2026-10-12T10:00:00Z', url: url('issues', 118), body: '', comments: [] },
];
const closed = { number: 97, title: 'Old crash on wake', state: 'CLOSED', labels: [], author: { login: 'estruyf' }, updatedAt: '2026-09-01T10:00:00Z', url: url('issues', 97), body: 'Fixed.', comments: [] };
const prs = [
  { number: 151, title: 'Start sessions from issues', state: 'OPEN', labels: [{ name: 'enhancement', color: 'a2eeef' }], author: { login: 'estruyf' }, updatedAt: '2026-10-19T10:00:00Z', url: url('pull', 151), headRefName: 'feat/issue-start', isDraft: false, isCrossRepository: false, headRepositoryOwner: { login: 'o' }, body: 'Adds the # list.', comments: [], baseRefName: 'main', headRefOid: 'abc123', maintainerCanModify: false },
  { number: 149, title: 'Fix typo in deep-links docs', state: 'OPEN', labels: [], author: { login: 'someone' }, updatedAt: '2026-10-18T10:00:00Z', url: url('pull', 149), headRefName: 'patch-1', isDraft: false, isCrossRepository: true, headRepositoryOwner: { login: 'someone' }, body: 'Typo.', comments: [], baseRefName: 'main', headRefOid: 'def456', maintainerCanModify: false },
];
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const pick = (item) => Object.fromEntries(flag('--json').split(',').map((k) => [k, item[k]]));
const matches = (item) => { const q = flag('--search'); return !q || q === 'sort:updated-desc' || item.title.toLowerCase().includes(q.toLowerCase()); };
const numberOf = (ref) => Number(String(ref).split('/').pop());
if (argv[1] === 'list') {
  const list = (argv[0] === 'pr' ? prs : issues).filter(matches);
  process.stdout.write(JSON.stringify(list.map(pick)));
} else if (argv[1] === 'view') {
  const n = numberOf(argv[2]);
  const item = argv[0] === 'pr' ? prs.find((p) => p.number === n) : [...issues, closed].find((i) => i.number === n);
  if (!item) fail('GraphQL: Could not resolve to an issue or pull request with the number of ' + n + '.');
  process.stdout.write(JSON.stringify(pick(item)));
} else if (argv[0] === 'api') {
  const query = argv[argv.indexOf('-f') + 1];
  const thread = (isResolved, path, line, body) => ({ isResolved, path, line, originalLine: 7, comments: { nodes: [{ author: { login: 'reviewer' }, body }] } });
  const threads = { 151: [thread(false, 'apps/ui/src/composer/hash.ts', 42, 'Debounce this.'), thread(true, 'README.md', 3, 'Done already.'), thread(false, 'README.md', null, 'Say it shorter.')], 149: [] };
  if (query.includes('viewer')) {
    const n = Number(flag('-F').split('=')[1]);
    process.stdout.write(JSON.stringify({ data: { viewer: { login: 'me' }, repository: { viewerPermission: 'WRITE', pullRequest: { reviewThreads: { nodes: threads[n] || [] } } } } }));
  } else {
    const repository = {};
    for (const m of query.matchAll(/p(\d+):/g)) repository['p' + m[1]] = { reviewThreads: { nodes: (threads[m[1]] || []).map((t) => ({ isResolved: t.isResolved })) } };
    process.stdout.write(JSON.stringify({ data: { repository } }));
  }
} else fail('unknown command');
`;

describe('parseGithubRef', () => {
  it('reads numbers and links to issues and pull requests', () => {
    expect(parseGithubRef('#123')).toEqual({ number: 123, repo: null, type: null, url: null });
    expect(parseGithubRef(' 7 ')).toEqual({ number: 7, repo: null, type: null, url: null });
    expect(parseGithubRef('https://github.com/estruyf/switchboard/issues/32#issuecomment-1')).toEqual({ number: 32, repo: 'estruyf/switchboard', type: 'issue', url: 'https://github.com/estruyf/switchboard/issues/32' });
    expect(parseGithubRef('https://github.com/other/repo/pull/9/files')).toEqual({ number: 9, repo: 'other/repo', type: 'pr', url: 'https://github.com/other/repo/pull/9' });
    expect(parseGithubRef('#0')).toBeNull();
    expect(parseGithubRef('support mods')).toBeNull();
    expect(parseGithubRef('https://example.com/o/r/issues/1')).toBeNull();
  });
});

describe('canPush and unresolvedComments', () => {
  it('lets you push to your repository, your fork, or a fork that lets maintainers change it', () => {
    expect(canPush({ fork: false, headOwner: 'o', maintainerCanModify: false, viewer: 'me', permission: 'WRITE' })).toBe(true);
    expect(canPush({ fork: false, headOwner: 'o', maintainerCanModify: false, viewer: 'me', permission: 'READ' })).toBe(false);
    expect(canPush({ fork: true, headOwner: 'me', maintainerCanModify: false, viewer: 'me', permission: 'READ' })).toBe(true);
    expect(canPush({ fork: true, headOwner: 'someone', maintainerCanModify: true, viewer: 'me', permission: 'MAINTAIN' })).toBe(true);
    expect(canPush({ fork: true, headOwner: 'someone', maintainerCanModify: false, viewer: 'me', permission: 'ADMIN' })).toBe(false);
    // GitHub didn't say who you are: a fork stays read-only.
    expect(canPush({ fork: true, headOwner: 'someone', maintainerCanModify: true, viewer: null, permission: null })).toBe(false);
  });

  it('keeps the first comment of each thread that is not resolved', () => {
    const comment = (body: string) => ({ nodes: [{ author: { login: 'r' }, body }] });
    expect(
      unresolvedComments([
        { isResolved: false, path: 'a.ts', line: 4, comments: comment('one') },
        { isResolved: true, path: 'b.ts', line: 1, comments: comment('done') },
        { isResolved: false, path: 'c.ts', line: null, originalLine: 9, comments: comment('outdated') },
        { isResolved: false, path: 'd.ts', line: 2, comments: { nodes: [] } },
      ]),
    ).toEqual([
      { path: 'a.ts', line: 4, author: 'r', body: 'one' },
      { path: 'c.ts', line: 9, author: 'r', body: 'outdated' },
    ]);
  });
});

describe('GithubService', () => {
  let repo: string;
  let scratch: string;
  let log: string;
  let now: number;
  let mode: string;
  let gh: GhCommand;
  let path: string;
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const service = (command: GhCommand = gh) => new GithubService({ gh: () => command, env: async () => ({ HOME: process.env.HOME ?? '', PATH: path, FAKE_GH_MODE: mode, FAKE_GH_LOG: log }), now: () => now });

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-github-')));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-github-bin-')));
    log = join(scratch, 'calls.log');
    now = 1_000_000;
    mode = 'ok';
    const script = join(scratch, 'fake-gh.cjs');
    writeFileSync(script, FAKE_GH);
    // The fake goes first on the PATH as `gh`, as the real one would be found. Windows can't start a script without
    // a shell, so there it is started through Node directly.
    if (process.platform === 'win32') {
      gh = { file: process.execPath, args: [script] };
      path = process.env.PATH ?? '';
    } else {
      const bin = join(scratch, 'gh');
      writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      chmodSync(bin, 0o755);
      gh = { file: 'gh', args: [] };
      path = [scratch, process.env.PATH ?? ''].join(delimiter);
    }
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['remote', 'add', 'origin', 'git@github.com:o/r.git']);
  });
  afterEach(() => [repo, scratch].forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('says why the list can or cannot work', async () => {
    expect(await service().status(repo)).toEqual({ available: true, reason: 'ok', repo: 'o/r' });
    mode = 'signed-out';
    expect(await service().status(repo)).toEqual({ available: false, reason: 'not-signed-in', repo: 'o/r' });
    expect(await service({ file: join(scratch, 'no-such-gh'), args: [] }).status(repo)).toEqual({ available: false, reason: 'no-gh', repo: 'o/r' });
    await git(repo, ['remote', 'remove', 'origin']);
    expect(await service().status(repo)).toEqual({ available: false, reason: 'not-github', repo: null });
    expect(calls().filter((c) => c.startsWith('auth status'))).toHaveLength(2);
  });

  it('lists the most recently updated, and searches words', async () => {
    const recent = await service().search(repo, '');
    expect(recent).toMatchObject({ repo: 'o/r', reason: 'ok', stale: false });
    expect(recent.issues.map((i) => i.number)).toEqual([32, 118]);
    expect(recent.issues[0]).toEqual({ type: 'issue', repo: 'o/r', number: 32, title: 'Start a session from a GitHub issue or pull request', state: 'open', labels: [{ name: 'enhancement', color: 'a2eeef' }], author: 'estruyf', createdAt: Date.parse('2026-10-15T10:00:00Z'), updatedAt: Date.parse('2026-10-16T10:00:00Z'), url: 'https://github.com/o/r/issues/32' });
    expect(recent.pullRequests.map((p) => [p.number, p.headRefName, p.isCrossRepository, p.headOwner, p.unresolved])).toEqual([
      [151, 'feat/issue-start', false, 'o', 2],
      [149, 'patch-1', true, 'someone', 0],
    ]);
    expect(calls()).toContain('issue list --repo o/r --state open --limit 10 --search sort:updated-desc --json number,title,state,labels,author,createdAt,updatedAt,url');
    const words = await service().search(repo, 'scroll');
    expect(words.issues.map((i) => i.number)).toEqual([118]);
    expect(words.pullRequests).toEqual([]);
  });

  it('puts a number first, open or closed, then the recent ones it starts', async () => {
    const closed = await service().search(repo, '#97');
    expect(closed.issues.map((i) => [i.number, i.state])).toEqual([[97, 'closed']]);
    const one = await service().search(repo, '1');
    expect(one.issues.map((i) => i.number)).toEqual([118]);
    expect(one.pullRequests.map((p) => p.number)).toEqual([151, 149]);
    const pr = await service().search(repo, '151');
    expect(pr.pullRequests.map((p) => p.number)).toEqual([151]);
    expect(pr.issues).toEqual([]);
  });

  it('finds a pasted link, also from another repository', async () => {
    const found = await service().search(repo, 'https://github.com/other/repo/pull/149');
    expect(found.pullRequests.map((p) => [p.number, p.isCrossRepository])).toEqual([[149, true]]);
    expect(calls()).toContain('pr view 149 --repo other/repo --json number,title,state,labels,author,createdAt,updatedAt,url,headRefName,isDraft,isCrossRepository,headRepositoryOwner');
    // A link works in a project without a GitHub remote too.
    await git(repo, ['remote', 'remove', 'origin']);
    expect((await service().search(repo, 'https://github.com/o/r/issues/32')).issues.map((i) => i.number)).toEqual([32]);
    expect((await service().search(repo, '')).reason).toBe('not-github');
  });

  it('reads an issue and a pull request with its unresolved review comments', async () => {
    const { issue } = await service().issue(repo, '#32');
    expect(issue).toMatchObject({ number: 32, comments: 4, body: expect.stringContaining('Type # in the box.') });
    const { pr } = await service().pr(repo, '151');
    expect(pr).toMatchObject({ headRefName: 'feat/issue-start', baseRefName: 'main', headOid: 'abc123', isCrossRepository: false, canPush: true });
    expect(pr!.reviewComments).toEqual([
      { path: 'apps/ui/src/composer/hash.ts', line: 42, author: 'reviewer', body: 'Debounce this.' },
      { path: 'README.md', line: 7, author: 'reviewer', body: 'Say it shorter.' },
    ]);
    expect(await service().issue(repo, '404')).toEqual({ issue: null, reason: 'failed', message: 'No issue #404 found.' });
  });

  it('flags a fork pull request you cannot push to', async () => {
    const { pr } = await service().pr(repo, 'https://github.com/o/r/pull/149');
    expect(pr).toMatchObject({ number: 149, isCrossRepository: true, headOwner: 'someone', canPush: false, reviewComments: [] });
  });

  it('keeps answers for a minute, and Refresh asks again', async () => {
    const github = service();
    await github.search(repo, '');
    const first = calls().length;
    await github.search(repo, '');
    expect(calls()).toHaveLength(first);
    now += GITHUB_CACHE_MS + 1;
    await github.search(repo, '');
    expect(calls().length).toBeGreaterThan(first);
    const second = calls().length;
    await github.search(repo, '', { refresh: true });
    expect(calls().length).toBeGreaterThan(second);
    // An item read for the list or a blank is known without asking again, for what Claude gets.
    await github.issue(repo, '32');
    expect(github.known('issue', 'o/r', 32)?.title).toBe('Start a session from a GitHub issue or pull request');
    expect(github.known('issue', 'o/r', 118)).toBeNull();
  });

  it('keeps the last lists through a rate limit or a network error, and never fails', async () => {
    const github = service();
    await github.search(repo, '');
    now += GITHUB_CACHE_MS + 1;
    mode = 'rate-limited';
    const limited = await github.search(repo, '');
    expect(limited).toMatchObject({ reason: 'rate-limited', stale: true });
    expect(limited.issues).toHaveLength(2);
    mode = 'offline';
    expect(await github.search(repo, '')).toMatchObject({ reason: 'offline', stale: true });
    // Nothing kept for this query: an empty list with the reason.
    expect(await github.search(repo, 'scroll')).toMatchObject({ reason: 'offline', stale: false, issues: [], pullRequests: [] });
    mode = 'signed-out';
    expect(await service().search(repo, '')).toMatchObject({ reason: 'not-signed-in', issues: [], pullRequests: [] });
    expect(await service({ file: join(scratch, 'no-such-gh'), args: [] }).search(repo, '')).toMatchObject({ reason: 'no-gh', issues: [] });
  });
});
