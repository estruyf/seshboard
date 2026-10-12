import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@switchboard/protocol/client';
import type { DisplayItem } from '../transcript/displayItems.ts';
import { projectHistory, PromptHistory, recallAnnouncement, routeArrow, sessionHistory, type ArrowKey } from './promptHistory.ts';

const up: ArrowKey = { key: 'ArrowUp', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false };
const down: ArrowKey = { ...up, key: 'ArrowDown' };

describe('PromptHistory', () => {
  // Newest first.
  const entries = ['third', 'second', 'first'];

  it('goes back one message per ↑, with the caret at the end', () => {
    const history = new PromptHistory(entries);
    expect(history.recall('older', '', 0)).toEqual({ text: 'third', caret: 5, index: 0, total: 3 });
    expect(history.recall('older', 'third', 5)).toMatchObject({ text: 'second', index: 1 });
    expect(history.recall('older', 'second', 6)).toMatchObject({ text: 'first', index: 2 });
    expect(history.browsing).toBe(true);
  });

  it('stops at the oldest message', () => {
    const history = new PromptHistory(['only']);
    history.recall('older', '', 0);
    expect(history.recall('older', 'only', 4)).toBeNull();
    expect(history.browsing).toBe(true);
  });

  it('goes forward with ↓ and brings the draft back past the newest, as you left it', () => {
    const history = new PromptHistory(entries);
    history.recall('older', 'half a tho', 4);
    history.recall('older', 'third', 5);
    expect(history.recall('newer', 'second', 6)).toMatchObject({ text: 'third', index: 0 });
    expect(history.recall('newer', 'third', 5)).toEqual({ text: 'half a tho', caret: 4, index: -1, total: 3 });
    expect(history.browsing).toBe(false);
    // Not browsing, ↓ has nowhere to go.
    expect(history.recall('newer', 'half a tho', 4)).toBeNull();
  });

  it('does nothing with no history', () => {
    const history = new PromptHistory([]);
    expect(history.recall('older', 'draft', 5)).toBeNull();
    expect(history.browsing).toBe(false);
  });

  it('puts the draft back on Esc', () => {
    const history = new PromptHistory(entries);
    history.recall('older', 'my draft', 8);
    history.recall('older', 'third', 5);
    expect(history.escape('second')).toEqual({ text: 'my draft', caret: 8, index: -1, total: 3 });
    expect(history.browsing).toBe(false);
    // Not browsing: Esc is left to stop Claude.
    expect(history.escape('my draft')).toBeNull();
  });

  it('keeps an edited message as the new draft', () => {
    const history = new PromptHistory(entries);
    history.recall('older', 'draft', 5);
    // You edit "third" and keep browsing: the edit is what comes back past the newest.
    expect(history.recall('older', 'third, edited', 13)).toMatchObject({ text: 'second' });
    expect(history.recall('newer', 'second', 6)).toMatchObject({ text: 'third' });
    expect(history.recall('newer', 'third', 5)).toMatchObject({ text: 'third, edited', caret: 13, index: -1 });
  });

  it('leaves Esc alone once a recalled message is edited', () => {
    const history = new PromptHistory(entries);
    history.recall('older', 'draft', 5);
    expect(history.escape('third, edited')).toBeNull();
    expect(history.browsing).toBe(false);
  });

  it('starts over after a reset', () => {
    const history = new PromptHistory(entries);
    history.recall('older', 'draft', 5);
    history.reset();
    expect(history.browsing).toBe(false);
    expect(history.recall('older', '', 0)).toMatchObject({ text: 'third', index: 0 });
  });

  it('stays on the message it shows when a new one arrives', () => {
    const history = new PromptHistory(entries);
    history.recall('older', '', 0);
    history.recall('older', 'third', 5);
    history.setEntries(['fourth', ...entries]);
    expect(history.recall('older', 'second', 6)).toMatchObject({ text: 'first', index: 3, total: 4 });
  });
});

describe('recallAnnouncement', () => {
  it('says where you are', () => {
    expect(recallAnnouncement({ text: 'b', caret: 1, index: 1, total: 14 })).toBe('Earlier message 2 of 14');
    expect(recallAnnouncement({ text: '', caret: 0, index: -1, total: 14 })).toBe('Back to your draft');
  });
});

describe('routeArrow', () => {
  const always = () => true;

  it('moves through the palette while it is open, before the history', () => {
    expect(routeArrow(up, { active: 0, count: 3 }, always)).toEqual({ kind: 'palette', active: 2 });
    expect(routeArrow(down, { active: 2, count: 3 }, always)).toEqual({ kind: 'palette', active: 0 });
  });

  it('browses the history at the edge of the text', () => {
    expect(routeArrow(up, null, (d) => d === 'older')).toEqual({ kind: 'history', direction: 'older' });
    expect(routeArrow(down, null, (d) => d === 'newer')).toEqual({ kind: 'history', direction: 'newer' });
  });

  it('leaves the caret to move elsewhere', () => {
    expect(routeArrow(up, null, () => false)).toBeNull();
  });

  it('leaves the key alone with a modifier, during composition, and for other keys', () => {
    expect(routeArrow({ ...up, shiftKey: true }, null, always)).toBeNull();
    expect(routeArrow({ ...up, metaKey: true }, null, always)).toBeNull();
    expect(routeArrow({ ...up, altKey: true }, null, always)).toBeNull();
    expect(routeArrow({ ...up, ctrlKey: true }, null, always)).toBeNull();
    expect(routeArrow({ ...up, isComposing: true }, null, always)).toBeNull();
    expect(routeArrow({ ...up, key: 'ArrowLeft' }, null, always)).toBeNull();
  });
});

describe('sessionHistory', () => {
  const user = (key: string, text: string, extra: Partial<Extract<DisplayItem, { kind: 'user' }>> = {}): DisplayItem => ({ kind: 'user', key, at: null, text, images: [], subagent: false, ...extra });

  it('lists your prompts and commands newest first, as you sent them', () => {
    const items: DisplayItem[] = [
      user('1', 'fix the tests'),
      { kind: 'text', key: '2', at: null, text: 'Done.', subagent: false },
      { kind: 'command', key: '3', at: null, name: '/compact', args: 'keep the plan' },
      { kind: 'command', key: '4', at: null, name: '/clear', args: '' },
      user('5', 'and the docs'),
    ];
    expect(sessionHistory(items)).toEqual(['and the docs', '/clear', '/compact keep the plan', 'fix the tests']);
  });

  it('skips what you did not type: subagent prompts, agent reports, notices, tool runs and image-only messages', () => {
    const items: DisplayItem[] = [
      user('1', 'mine'),
      user('2', 'Explore the repo', { subagent: true }),
      { kind: 'agent-report', key: '3', at: null, agentId: 'a', toolUseId: null, status: 'completed', title: 'Report', text: 'Report' },
      { kind: 'notice', key: '4', at: null, text: 'Interrupted by you' },
      { kind: 'tool', key: '5', at: null, id: 't', name: 'AskUserQuestion', input: {}, inputTruncated: false, result: null, subagent: false },
      user('6', '', { images: [{ imageId: 'i', mediaType: 'image/png', bytes: 1 }] }),
    ];
    expect(sessionHistory(items)).toEqual(['mine']);
  });

  it('drops a message that repeats the one just before it', () => {
    const items = [user('1', 'again'), user('2', 'retry'), user('3', 'retry'), user('4', 'again')];
    expect(sessionHistory(items)).toEqual(['again', 'retry', 'again']);
  });
});

describe('projectHistory', () => {
  const session = (id: string, firstPrompt: string | null, createdAt: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
    id,
    title: firstPrompt ?? 'Untitled',
    firstPrompt,
    customTitle: null,
    cwd: '/repo',
    projectRoot: '/repo',
    gitBranch: null,
    worktree: null,
    origin: 'app',
    createdAt,
    updatedAt: createdAt,
    fileSize: null,
    tag: null,
    pinned: false,
    archivedAt: null,
    restoredAt: null,
    viewedAt: null,
    unread: false,
    inApp: true,
    profileId: 'default',
    ...extra,
  });

  it('lists the first prompts of your sessions in the project, newest first, each once', () => {
    const sessions = [
      session('a', 'older', 1),
      session('b', 'newest', 3),
      session('c', 'middle', 2),
      session('fork', 'middle', 4),
      session('other', 'elsewhere', 5, { projectRoot: '/other' }),
      session('cli', 'not from here', 6, { inApp: false }),
      session('empty', null, 7),
    ];
    expect(projectHistory(sessions, '/repo')).toEqual(['middle', 'newest', 'older']);
  });

  it('leaves out prompts the index cut short, and keeps to the limit', () => {
    const cut = `${'x'.repeat(499)}…`;
    expect(projectHistory([session('a', cut, 2), session('b', 'whole', 1)], '/repo')).toEqual(['whole']);
    const many = Array.from({ length: 60 }, (_, i) => session(`s${i}`, `prompt ${i}`, i));
    expect(projectHistory(many, '/repo')).toHaveLength(50);
    expect(projectHistory(many, '/repo')[0]).toBe('prompt 59');
  });
});
