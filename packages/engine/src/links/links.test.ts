import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBriefs, writeStub, type CatchUp, type SessionSummary, type TranscriptMessage, type WorktreePullRequest } from '@seshboard/protocol';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { git } from '../git/gitChanges.ts';
import { clockTime } from './brief.ts';
import { LinkService, type LinkServiceDeps } from './linkService.ts';
import { LinkStore } from './linkStore.ts';
import { baseOfCommand, openedPullRequests, repoOfPrUrl } from './prDetect.ts';

const PARENT = 'parent-session';
const CHILD = 'child-session';

const message = (uuid: string, role: 'user' | 'assistant', blocks: TranscriptMessage['blocks'], timestamp = 1_000): TranscriptMessage => ({ uuid, role, timestamp, parentToolUseId: null, model: null, blocks });
const bash = (id: string, command: string): TranscriptMessage['blocks'][number] => ({ type: 'tool_use', id, name: 'Bash', input: { command }, truncated: false });
const result = (id: string, text: string, isError = false): TranscriptMessage['blocks'][number] => ({ type: 'tool_result', toolUseId: id, isError, text, truncated: false, images: [] });

describe('pull requests opened in a session', () => {
  it('finds gh pr create with its link, and its base', () => {
    const messages = [
      message('a', 'assistant', [bash('t1', 'git push -u origin HEAD && gh pr create --base worktree-usage-cost --title "x" --body "y"')]),
      message('b', 'user', [result('t1', 'Creating pull request…\nhttps://github.com/demo/switchboard/pull/151\n')], 2_000),
    ];
    expect(openedPullRequests(messages)).toEqual([{ repo: 'demo/switchboard', number: 151, url: 'https://github.com/demo/switchboard/pull/151', at: 2_000, base: 'worktree-usage-cost' }]);
  });

  it('leaves out a link that only shows up in text, or in another command', () => {
    const messages = [
      message('a', 'assistant', [{ type: 'text', text: 'See https://github.com/other/repo/pull/9' }, bash('t1', 'gh pr view 9')]),
      message('b', 'user', [result('t1', 'https://github.com/other/repo/pull/9')]),
      message('c', 'assistant', [bash('t2', 'gh pr create --fill')]),
      message('d', 'user', [result('t2', 'https://github.com/demo/switchboard/pull/3', true)]),
    ];
    expect(openedPullRequests(messages)).toEqual([]);
  });

  it('reads repos and bases', () => {
    expect(repoOfPrUrl('https://github.com/demo/switchboard/pull/12')).toBe('demo/switchboard');
    expect(baseOfCommand('gh pr create -B main --fill')).toBe('main');
    expect(baseOfCommand("gh pr create --base='feat/a'")).toBe('feat/a');
    expect(baseOfCommand('gh pr create --fill')).toBeNull();
  });
});

describe('LinkService', () => {
  let dir: string;
  let repo: string;
  let cache: CacheDatabase;
  let store: LinkStore;
  let sessions: Map<string, SessionSummary>;
  let status: 'working' | 'waiting' | null;
  let card: CatchUp | null;
  let prs: Map<string, WorktreePullRequest> | null;
  let ghCalls: number;

  const summary = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
    id,
    title: id,
    firstPrompt: 'Add a setting to hide the cost',
    customTitle: null,
    cwd: repo,
    projectRoot: repo,
    gitBranch: 'worktree-usage-cost',
    worktree: null,
    origin: 'app',
    createdAt: 1,
    updatedAt: new Date(2026, 9, 18, 13, 2).getTime(),
    fileSize: 1,
    tag: null,
    pinned: false,
    archivedAt: null,
    restoredAt: null,
    viewedAt: null,
    unread: false,
    inApp: true,
    profileId: 'default',
    ...over,
  });

  const service = (over: Partial<LinkServiceDeps> = {}) =>
    new LinkService({
      store,
      session: (id) => sessions.get(id) ?? null,
      status: () => status,
      catchUp: () => card,
      projectName: () => 'switchboard',
      inRepo: () => true,
      pullRequests: async () => {
        ghCalls++;
        return prs;
      },
      commits: async (folder, branch, base) => (await git(folder, ['log', '--oneline', '--no-decorate', `${base ?? 'main'}..${branch}`])).split('\n').filter(Boolean),
      lastReply: async () => 'Done. PR #148 is open against main.',
      log: () => {},
      ...over,
    });

  beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-links-')));
    repo = join(dir, 'repo');
    await git(dir, ['init', '-q', '-b', 'main', repo]);
    await git(repo, ['config', 'user.email', 'test@example.com']);
    await git(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'a.ts'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-qm', 'initial']);
    await git(repo, ['checkout', '-qb', 'worktree-usage-cost']);
    writeFileSync(join(repo, 'a.ts'), 'two\n');
    await git(repo, ['commit', '-qam', 'feat(usage): add a setting']);
    cache = openCacheDatabase(join(dir, 'cache.sqlite'));
    store = new LinkStore(cache.db);
    sessions = new Map([[PARENT, summary(PARENT)], [CHILD, summary(CHILD, { gitBranch: 'worktree-hide-tokens' })]]);
    status = null;
    card = {
      sessionId: PARENT,
      turnId: 't',
      generatedAt: 1,
      source: 'model',
      state: 'finished',
      ask: 'Add a setting to hide the estimated cost',
      did: ['Added Show estimated cost', 'Hid the cost on the bars', 'Added tests'],
      skipped: ['The remote app still shows the cost'],
      need: { kind: 'review', title: 'Review and merge the pull request', text: '' },
      signals: { tests: { state: 'passed' }, diff: null, outOfScope: [], scope: null, plan: null },
      reviewMinutes: 2,
    };
    prs = new Map([['worktree-usage-cost', { number: 148, state: 'open', url: 'https://github.com/demo/switchboard/pull/148', draft: false, base: 'main' }]]);
    ghCalls = 0;
  });

  afterEach(() => {
    cache.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const stubbed = (label: string, id: string) => `stack it on @${label}\n\n${writeStub(label, id)}`;

  it('turns a stub into a brief with the branch, the pull request, commits and the catch-up', async () => {
    const links = service();
    const text = stubbed('Usage cost toggle', PARENT);
    await links.warmText(text);
    const out = links.expand(CHILD, text);
    const { text: typed, briefs } = parseBriefs(out);
    expect(typed).toBe('stack it on @Usage cost toggle');
    const brief = briefs[0]!;
    expect(brief.stub).toBe(false);
    expect(brief.fields).toMatchObject({
      project: 'switchboard',
      folder: repo,
      branch: 'worktree-usage-cost',
      'pull request': '#148 open, base main, https://github.com/demo/switchboard/pull/148',
      state: `finished, last active ${clockTime(new Date(2026, 9, 18, 13, 2).getTime())}`,
      asked: 'Add a setting to hide the estimated cost',
    });
    expect(brief.commits).toHaveLength(1);
    expect(brief.commits[0]).toMatch(/feat\(usage\): add a setting$/);
    expect(brief.did).toEqual(card!.did);
    expect(brief.next).toBe('Review and merge the pull request');
    expect(brief.lastReply).toBe('Done. PR #148 is open against main.');
    expect(store.linksFrom(CHILD)).toMatchObject([{ sessionId: PARENT, label: 'Usage cost toggle' }]);
  });

  it('writes a brief without waiting, from what it holds', () => {
    const out = service().expand(CHILD, stubbed('Usage cost toggle', PARENT));
    const brief = parseBriefs(out).briefs[0]!;
    expect(brief.stub).toBe(false);
    expect(brief.fields.branch).toBe('worktree-usage-cost');
    // gh wasn't read yet, and no pull request is stored.
    expect(brief.fields['pull request']).toBe('none yet');
    expect(ghCalls).toBe(0);
  });

  it('says a working session may still change, without what it did', async () => {
    status = 'working';
    const out = service().expand(CHILD, stubbed('Usage cost toggle', PARENT));
    const brief = parseBriefs(out).briefs[0]!;
    expect(brief.fields.state).toBe('working, details may change');
    expect(brief.did).toEqual([]);
  });

  it('says a session is gone', () => {
    const brief = parseBriefs(service().expand(CHILD, stubbed('Old spike', 'nope'))).briefs[0]!;
    expect(brief.fields.state).toBe('gone, this session no longer exists');
  });

  it('says a removed worktree is removed', () => {
    sessions.set(PARENT, summary(PARENT, { cwd: join(dir, 'gone') }));
    const brief = parseBriefs(service().expand(CHILD, stubbed('Usage cost toggle', PARENT))).briefs[0]!;
    expect(brief.fields.folder).toBe(`${join(dir, 'gone')} (removed)`);
  });

  it('gives the same session one brief, and drops a link to itself', () => {
    const text = `a @One, @One again and @Me\n\n${writeStub('One', PARENT)}\n\n${writeStub('One (2)', PARENT)}\n\n${writeStub('Me', CHILD)}`;
    const out = service().expand(CHILD, text);
    expect(parseBriefs(out).briefs.map((b) => b.sessionId)).toEqual([PARENT]);
  });

  it('leaves a text without stubs, and briefs already written, as they are', () => {
    const links = service();
    expect(links.expand(CHILD, 'just text')).toBe('just text');
    const once = links.expand(CHILD, stubbed('Usage cost toggle', PARENT));
    expect(links.expand(CHILD, once)).toBe(once);
  });

  it('prefers the pull request the session opened, from its transcript', () => {
    prs = null;
    const links = service();
    links.transcriptRead(PARENT, [
      message('a', 'assistant', [bash('t1', 'gh pr create --base main --fill')]),
      message('b', 'user', [result('t1', 'https://github.com/demo/switchboard/pull/148')], Date.now()),
    ]);
    const brief = parseBriefs(links.expand(CHILD, stubbed('Usage cost toggle', PARENT))).briefs[0]!;
    expect(brief.fields['pull request']).toBe('#148 open, base main, https://github.com/demo/switchboard/pull/148');
  });

  it('says when a pull request was last read, when that is a while ago', () => {
    prs = null;
    const links = service();
    const at = new Date(2026, 9, 1, 9, 30).getTime();
    links.transcriptRead(PARENT, [message('a', 'assistant', [bash('t1', 'gh pr create --fill')]), message('b', 'user', [result('t1', 'https://github.com/demo/switchboard/pull/148')], at)]);
    const brief = parseBriefs(links.expand(CHILD, stubbed('Usage cost toggle', PARENT))).briefs[0]!;
    expect(brief.fields['pull request']).toBe(`#148 open, https://github.com/demo/switchboard/pull/148 (as of ${clockTime(at)})`);
  });

  it('tells the chip about the branch and pull request, or that the session is gone', async () => {
    const links = service();
    expect(await links.info(PARENT)).toEqual({ gone: false, branch: 'worktree-usage-cost', pr: prs!.get('worktree-usage-cost') });
    expect(await links.info('nope')).toEqual({ gone: true, branch: null, pr: null });
  });

  it('never waits for gh longer than it was given', async () => {
    const links = service({ pullRequests: () => new Promise(() => {}) });
    const started = Date.now();
    await links.warm(PARENT, 50);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
