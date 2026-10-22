import { describe, expect, it } from 'vitest';
import { PR_BODY_LIMIT, type PrDraft } from '@switchboard/protocol/client';
import { commitList, counterText, defaultSource, defaultTitle, draftProblem, noticeFor, overLimit, pushLine, readableBranch, saveDraft, savedDraft, sourceLabel, sourceText, statsText } from './pullRequest.ts';

const draft = (patch: Partial<PrDraft> = {}): PrDraft => ({
  path: '/work/app',
  branch: 'feat/sessions-archive',
  remote: 'origin',
  hasUpstream: false,
  ahead: 3,
  commits: ['Add archive settings', 'Delete after N days', 'Overview of every session'],
  files: 9,
  additions: 412,
  deletions: 37,
  base: 'main',
  remoteDefault: 'main',
  branches: ['main'],
  repo: 'estruyf/switchboard',
  templates: [],
  existingPr: null,
  gh: { installed: true, signedIn: true, host: 'github.com' },
  ...patch,
});

describe('title', () => {
  it("uses the commit's subject when there is one commit", () => {
    expect(defaultTitle(['Settings › Sessions: archive and delete'], 'feat/sessions-archive')).toBe('Settings › Sessions: archive and delete');
  });

  it('makes the branch name readable when there are several', () => {
    expect(defaultTitle(['a', 'b'], 'feat/sessions-archive')).toBe('Sessions archive');
    expect(defaultTitle([], 'fix/smoke_auto--model')).toBe('Smoke auto model');
  });

  it('cleans up branch names', () => {
    expect(readableBranch('sessions-archive')).toBe('Sessions archive');
    expect(readableBranch('user/feat/x')).toBe('X');
    expect(readableBranch('---')).toBe('---');
  });
});

describe('description', () => {
  const templates = [
    { path: '.github/PULL_REQUEST_TEMPLATE/feature.md', content: '## Feature\n' },
    { path: '.github/PULL_REQUEST_TEMPLATE/bugfix.md', content: '## Bug\n' },
  ];

  it('starts from the first template, else the commit list', () => {
    expect(defaultSource(templates)).toEqual({ kind: 'template', path: '.github/PULL_REQUEST_TEMPLATE/feature.md' });
    expect(defaultSource([])).toEqual({ kind: 'commits' });
    expect(sourceText({ kind: 'template', path: '.github/PULL_REQUEST_TEMPLATE/bugfix.md' }, templates, [])).toBe('## Bug\n');
    expect(sourceText({ kind: 'commits' }, templates, ['One', 'Two'])).toBe('- One\n- Two');
    expect(sourceText({ kind: 'empty' }, templates, ['One'])).toBe('');
    expect(sourceLabel({ kind: 'commits' })).toBe('Commit list');
  });

  it('cuts a commit list short to fit, saying how many it left out', () => {
    const commits = Array.from({ length: 5_000 }, (_, i) => `Commit number ${i} with a subject that goes on for a while`);
    const list = commitList(commits);
    expect(list.length).toBeLessThanOrEqual(PR_BODY_LIMIT);
    expect(list).toMatch(/\n- … and [\d,]+ more$/);
    const kept = list.split('\n').length - 1;
    expect(list.endsWith(`and ${(5_000 - kept).toLocaleString('en-US')} more`)).toBe(true);
    expect(commitList(['a', 'b'], 100)).toBe('- a\n- b');
  });
});

describe('counter', () => {
  it("counts towards GitHub's limit", () => {
    expect(counterText('x'.repeat(412))).toBe('412 / 65,536');
    expect(overLimit('x'.repeat(PR_BODY_LIMIT))).toBe(0);
    expect(overLimit('x'.repeat(PR_BODY_LIMIT + 3_214))).toBe(3_214);
  });
});

describe('footer and header', () => {
  it('says what is pushed first', () => {
    expect(pushLine(draft())).toBe('Pushes 3 commits to origin first');
    expect(pushLine(draft({ ahead: 1, hasUpstream: true }))).toBe('Pushes 1 commit to origin first');
    expect(pushLine(draft({ ahead: 0, hasUpstream: true }))).toBe('Makes sure feat/sessions-archive is on origin first');
    expect(pushLine(draft({ ahead: 0, hasUpstream: false }))).toBe('Publishes feat/sessions-archive to origin first');
    expect(statsText(draft())).toBe('3 commits · 9 files');
    expect(statsText(draft({ commits: ['a'], files: 1 }))).toBe('1 commit · 1 file');
  });
});

describe('problems', () => {
  it('reads what will go wrong from the draft, the most blocking first', () => {
    expect(draftProblem(draft())).toBeNull();
    expect(draftProblem(draft({ gh: { installed: false, signedIn: false, host: 'github.com' } }))?.code).toBe('GH_MISSING');
    expect(draftProblem(draft({ gh: { installed: true, signedIn: false, host: 'github.com' } }))?.code).toBe('GH_AUTH');
    expect(draftProblem(draft({ gh: { installed: true, signedIn: null, host: 'github.com' } }))).toBeNull();
    expect(draftProblem(draft({ existingPr: { number: 118, state: 'open', url: 'u' } }))).toMatchObject({ code: 'PR_EXISTS', pr: { number: 118 } });
    expect(draftProblem(draft({ existingPr: { number: 90, state: 'merged', url: 'u' } }))).toBeNull();
  });

  it('says what to do next for each failure', () => {
    expect(noticeFor({ code: 'GH_MISSING', message: '', output: null, pr: null }, 'b')).toMatchObject({ tone: 'warn', actions: ['install', 'web'] });
    expect(noticeFor({ code: 'GH_AUTH', message: '', output: 'x', pr: null }, 'b')).toMatchObject({ tone: 'warn', actions: ['sign-in'] });
    expect(noticeFor({ code: 'PUSH_REJECTED', message: "origin has 2 commits this branch doesn't have.", output: '! [rejected]', pr: null }, 'b')).toEqual({
      tone: 'error',
      title: 'Push rejected.',
      detail: "origin has 2 commits this branch doesn't have.",
      actions: ['pull', 'output'],
    });
    expect(noticeFor({ code: 'PR_EXISTS', message: '', output: null, pr: { number: 118, url: 'u' } }, 'feat/sessions-archive')).toMatchObject({ tone: 'info', detail: '#118 is open for feat/sessions-archive.', actions: ['view'] });
    expect(noticeFor({ code: 'UNKNOWN', message: 'No commits between main and feat/x', output: null, pr: null }, 'b')).toMatchObject({ tone: 'error', actions: [] });
  });
});

describe('saved drafts', () => {
  it('keeps what you wrote per checkout and branch until it is cleared', () => {
    const kept = { title: 'T', body: 'B', source: { kind: 'empty' as const }, base: 'main', draft: false };
    saveDraft('/work/app', 'feat/x', kept);
    expect(savedDraft('/work/app', 'feat/x')).toEqual(kept);
    expect(savedDraft('/work/app', 'feat/y')).toBeNull();
    saveDraft('/work/app', 'feat/x', null);
    expect(savedDraft('/work/app', 'feat/x')).toBeNull();
  });
});
