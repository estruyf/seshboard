import { describe, expect, it } from 'vitest';
import {
  DRAFT_SETTLE_MS,
  draftList,
  draftPreview,
  draftRoot,
  isCountingDraft,
  newDraftKey,
  newSessionDraftBanner,
  nextDraft,
  parseDrafts,
  quitSummary,
  serializeDrafts,
  sessionDraftBanner,
  sessionsWithDrafts,
  type Draft,
} from './drafts.ts';

const draft = (text: string, over: Partial<Draft<string>> = {}): Draft<string> => ({ text, attachments: [], updatedAt: 1_000, counted: true, lostImages: 0, ...over });

describe('isCountingDraft', () => {
  it('counts text once it has stayed put for a moment', () => {
    const fresh = draft('half a thought', { counted: false, updatedAt: 10_000 });
    expect(isCountingDraft(fresh, 10_000 + DRAFT_SETTLE_MS - 1)).toBe(false);
    expect(isCountingDraft(fresh, 10_000 + DRAFT_SETTLE_MS)).toBe(true);
  });

  it('never counts an empty box, and counts images without text', () => {
    expect(isCountingDraft(draft('  \n'), 99_999)).toBe(false);
    expect(isCountingDraft(draft('', { attachments: ['image'] }), 99_999)).toBe(true);
  });

  it('keeps counting while a counted draft is edited', () => {
    expect(isCountingDraft(draft('edited just now', { updatedAt: 5_000 }), 5_001)).toBe(true);
  });
});

describe('nextDraft', () => {
  it('forgets an emptied box', () => {
    expect(nextDraft(draft('sent soon'), { text: ' ', attachments: [] }, 2_000)).toBeNull();
  });

  it('returns the same draft when nothing changed (a box mounting writes it back)', () => {
    const before = draft('same', { attachments: ['a'] });
    expect(nextDraft(before, { text: 'same', attachments: before.attachments }, 9_000)).toBe(before);
  });

  it('stamps a change, keeps counting and the choices, and drops the notes', () => {
    const form = { choices: { model: '', permissionMode: 'default' as const, effort: '' as const, workspace: 'current' as const, baseRef: 'fresh' as const, branch: '' }, profileId: null };
    const next = nextDraft(draft('a', { lostImages: 2, seeded: true, form }), { text: 'ab', attachments: [] }, 9_000)!;
    expect(next).toEqual({ text: 'ab', attachments: [], updatedAt: 9_000, counted: true, lostImages: 0, form });
    expect(nextDraft(undefined, { text: 'new', attachments: [] }, 9_000)!.counted).toBe(false);
  });
});

describe('draftPreview', () => {
  it('takes the first line with whitespace collapsed', () => {
    expect(draftPreview('  also   check the\tvirtual rows\nsecond line')).toBe('also check the virtual rows');
  });

  it('cuts long lines with an ellipsis', () => {
    const preview = draftPreview('x'.repeat(100));
    expect(preview).toHaveLength(60);
    expect(preview.endsWith('…')).toBe(true);
    expect(draftPreview('word '.repeat(20), 12)).toBe('word word w…');
  });
});

describe('keys', () => {
  it('names New session prompts per project', () => {
    expect(newDraftKey('/work/app')).toBe('new:/work/app');
    expect(draftRoot('new:/work/app')).toBe('/work/app');
    expect(draftRoot(newDraftKey(null))).toBeNull();
    expect(draftRoot('session-1')).toBeNull();
  });
});

describe('draftList', () => {
  it('lists drafts that count, newest first, New session ones included', () => {
    const list = draftList({
      old: draft('old one', { updatedAt: 1 }),
      'new:/work/app': draft('Add a yearly overview', { updatedAt: 30 }),
      typing: draft('still typing', { updatedAt: 40, counted: false }),
      recent: draft('recent one', { updatedAt: 20 }),
      images: draft('', { updatedAt: 10, attachments: ['a', 'b'] }),
    });
    expect(list.map((item) => item.key)).toEqual(['new:/work/app', 'recent', 'images', 'old']);
    expect(list[0]).toMatchObject({ kind: 'new', root: '/work/app', preview: 'Add a yearly overview' });
    expect(list[1]).toMatchObject({ kind: 'session', sessionId: 'recent' });
    expect(list[2]!.preview).toBe('2 images');
  });
});

describe('persistence', () => {
  const form = { choices: { model: 'opus', permissionMode: 'plan' as const, effort: 'high' as const, workspace: 'worktree' as const, baseRef: 'head' as const, branch: '' }, profileId: 'work' };

  it('round-trips the text, the time and New session choices, and counts on the way back', () => {
    const saved = serializeDrafts({ 's-1': draft('also check the rows', { updatedAt: 42, counted: false }), 'new:/work/app': draft('yearly overview', { form }) });
    const back = parseDrafts(JSON.parse(JSON.stringify(saved)));
    expect(back['s-1']).toEqual({ text: 'also check the rows', attachments: [], updatedAt: 42, counted: true, lostImages: 0 });
    expect(back['new:/work/app']!.form).toEqual(form);
  });

  it('drops images and says how many were left out', () => {
    const saved = serializeDrafts({ 's-1': draft('look at this', { attachments: ['png'] }), only: draft('', { attachments: ['png'] }) });
    expect(Object.keys(saved.drafts)).toEqual(['s-1']);
    expect(JSON.stringify(saved)).not.toContain('png');
    const back = parseDrafts(saved);
    expect(back['s-1']!.lostImages).toBe(1);
    expect(sessionDraftBanner(back['s-1']!, back['s-1']!.updatedAt + 12 * 60_000)).toBe("Unsent message from 12 minutes ago, kept for you. 1 image wasn't kept.");
  });

  it('keeps a pasted text with the draft', () => {
    const pasted = { kind: 'text' as const, source: 'paste' as const, label: 'Pasted text', text: 'line 1\nline 2' };
    const back = parseDrafts(JSON.parse(JSON.stringify({ version: 1, drafts: { 's-1': { text: '', updatedAt: 1, images: 0, context: [pasted] } } })));
    expect(back['s-1']!.context?.map(({ id: _id, ...item }) => item)).toEqual([pasted]);
  });

  it('ignores anything that does not read as saved drafts', () => {
    expect(parseDrafts(null)).toEqual({});
    expect(parseDrafts({ version: 2, drafts: {} })).toEqual({});
    expect(parseDrafts({ version: 1, drafts: { a: { text: 5 }, b: { text: ' ', updatedAt: 1 }, c: { text: 'ok', updatedAt: 1, form: { choices: { model: 1 } } } } })).toEqual({
      c: { text: 'ok', attachments: [], updatedAt: 1, counted: true, lostImages: 0 },
    });
  });
});

describe('wording', () => {
  it('says whose prompt and how old it is', () => {
    expect(newSessionDraftBanner('worklog-web', { updatedAt: 0, lostImages: 0 }, 5 * 60_000)).toBe('Your unsent prompt for worklog-web, from 5 minutes ago.');
    expect(sessionDraftBanner({ updatedAt: 0, lostImages: 0 }, 10_000)).toBe('Unsent message from a moment ago, kept for you.');
  });

  it('adds unsent messages to what quitting stops', () => {
    expect(quitSummary('1 session is still working and will stop.', 4)).toEqual(['1 session is still working and will stop, and you have 4 unsent messages.', 'Unsent messages are kept and come back next time.']);
    expect(quitSummary(null, 1)).toEqual(['You have 1 unsent message.', 'It is kept and comes back next time.']);
    expect(quitSummary('Terminals close.', 0)).toEqual(['Terminals close.']);
  });
});

describe('sessionsWithDrafts', () => {
  it('finds the sessions archiving would ask about', () => {
    const drafts = { a: draft('unsent'), b: draft('typing', { counted: false }), c: draft('  ') };
    expect(sessionsWithDrafts(['a', 'b', 'c', 'd'], drafts)).toEqual(['a', 'b']);
  });
});
