import { describe, expect, it } from 'vitest';
import type { GithubListItem } from '@switchboard/protocol/client';
import { branchLine, filterLocal, pastedGithubLink, rowsOf, withoutLink } from './githubList.ts';
import { chipDetail, itemLabel, openedLine } from './githubText.ts';

const item = (number: number, title: string, over: Partial<GithubListItem> = {}): GithubListItem => ({
  type: 'issue',
  repo: 'estruyf/switchboard',
  number,
  title,
  state: 'open',
  labels: [],
  author: 'estruyf',
  createdAt: 0,
  updatedAt: 0,
  url: `https://github.com/estruyf/switchboard/issues/${number}`,
  ...over,
});
const pr = (number: number, title: string, over: Partial<GithubListItem> = {}) => item(number, title, { type: 'pr', headRefName: 'feat/x', isDraft: false, isCrossRepository: false, headOwner: 'estruyf', ...over });
const result = { issues: [item(32, 'Start a session from an issue'), item(118, 'Session list loses scroll')], pullRequests: [pr(151, 'Start sessions from issues', { headRefName: 'feat/issue-start' }), pr(149, 'Fix typo')] };

describe('the # list', () => {
  it('lists issues, then pull requests, or one kind', () => {
    expect(rowsOf(result).map((i) => i.number)).toEqual([32, 118, 151, 149]);
    expect(rowsOf(result, 'pr').map((i) => i.number)).toEqual([151, 149]);
    expect(rowsOf(result, 'issue').map((i) => i.number)).toEqual([32, 118]);
  });

  it('narrows an earlier list to what is typed, at once', () => {
    expect(rowsOf(filterLocal(result, 'start')).map((i) => i.number)).toEqual([32, 151]);
    expect(rowsOf(filterLocal(result, 'issue-start')).map((i) => i.number)).toEqual([151]);
    expect(rowsOf(filterLocal(result, '#1')).map((i) => i.number)).toEqual([118, 151, 149]);
    expect(rowsOf(filterLocal(result, 'session scroll')).map((i) => i.number)).toEqual([118]);
    expect(filterLocal(result, '')).toBe(result);
  });

  it('says where a pull request’s branch is', () => {
    expect(branchLine(pr(1, 'a', { headRefName: 'feat/issue-start' }))).toBe('feat/issue-start');
    expect(branchLine(pr(1, 'a', { headRefName: 'patch-1', isCrossRepository: true, headOwner: 'someone' }))).toBe('someone:patch-1');
  });

  it('reads a row out as one sentence', () => {
    expect(itemLabel(item(32, 'Start a session from a GitHub issue or pull request', { labels: [{ name: 'enhancement', color: 'a2eeef' }] }))).toBe(
      'Issue 32, Start a session from a GitHub issue or pull request, open, enhancement',
    );
    expect(itemLabel(pr(149, 'Fix typo', { isCrossRepository: true, unresolved: 2, isDraft: true }))).toBe('Pull request 149, Fix typo, draft, branch feat/x, 2 unresolved comments, from a fork');
  });

  it('says when an issue was opened, and what a chip shows after its title', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    expect(openedLine({ createdAt: now - 3 * 86_400_000, updatedAt: now, author: 'estruyf' }, now)).toBe('opened 3d ago by estruyf');
    expect(chipDetail({ ...item(32, 'x', { labels: [{ name: 'enhancement', color: '' }] }), body: '', comments: 4 })).toBe('enhancement · 4 comments');
    expect(
      chipDetail({ ...pr(151, 'x'), headRefName: 'feat/issue-start', body: '', comments: 0, baseRefName: 'main', headOid: 'a', isDraft: false, isCrossRepository: false, headOwner: 'o', canPush: true, reviewComments: [{ path: 'a', line: 1, author: 'r', body: 'b' }, { path: 'b', line: 2, author: 'r', body: 'c' }] }),
    ).toBe('feat/issue-start · 2 comments');
    expect(chipDetail(null)).toBeNull();
  });

  it('offers to attach a pasted link, and takes it out of the text once attached', () => {
    expect(pastedGithubLink(' https://github.com/estruyf/switchboard/issues/32 ')).toEqual({ type: 'issue', repo: 'estruyf/switchboard', number: 32, url: 'https://github.com/estruyf/switchboard/issues/32' });
    expect(pastedGithubLink('https://github.com/o/r/pull/9/files')).toMatchObject({ type: 'pr', number: 9 });
    expect(pastedGithubLink('see https://github.com/o/r/issues/1')).toBeNull();
    expect(pastedGithubLink('https://github.com/o/r')).toBeNull();
    expect(withoutLink('look at https://github.com/o/r/issues/1 now', 'https://github.com/o/r/issues/1')).toBe('look at now');
    expect(withoutLink('look at https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/1')).toBe('look at');
  });
});
