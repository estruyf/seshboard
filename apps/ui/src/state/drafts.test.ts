import { describe, expect, it } from 'vitest';
import {
  changedDrafts,
  DRAFT_SETTLE_MS,
  draftList,
  draftPreview,
  draftRoot,
  isCountingDraft,
  newDraftKey,
  newSessionDraftBanner,
  nextDraft,
  parseDrafts,
  parseFirstPrompts,
  quitSummary,
  serializeDrafts,
  sessionDraftBanner,
  sessionsWithDrafts,
  settleFirstPrompts,
  type Draft,
  type FirstPrompt,
  type SessionsSeen,
  draftMessage,
} from './drafts.ts';
import type { HostState } from '@switchboard/protocol/client';

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
    const fromDev = { ...form, choices: { ...form.choices, baseRef: 'refs/heads/dev' as const } };
    const kept = parseDrafts(JSON.parse(JSON.stringify(serializeDrafts({ 'new:/work/app': draft('from dev', { form: fromDev }) }))));
    expect(kept['new:/work/app']!.form).toEqual(fromDev);
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

describe('first prompts', () => {
  const form = { choices: { model: 'opus', permissionMode: 'plan' as const, effort: 'high' as const, workspace: 'current' as const, baseRef: 'fresh' as const, branch: '' }, profileId: 'work' };
  const first = (text: string, restored = false): FirstPrompt<string> => ({ draft: { ...draft(text, { form }), startIn: '/work/app' }, restored });
  const seen = (over: { ready?: boolean; transcripts?: string[]; hosts?: Record<string, HostState> } = {}): SessionsSeen => ({
    ready: over.ready ?? true,
    hasTranscript: (id) => (over.transcripts ?? []).includes(id),
    hostState: (id) => over.hosts?.[id],
  });

  it('stays out of sight while the session runs, and is forgotten once it has a transcript', () => {
    const firstPrompts = { 's-1': first('Fix the login redirect') };
    expect(settleFirstPrompts({}, firstPrompts, seen({ hosts: { 's-1': 'running' } }))).toBeNull();
    // Just created: the host isn't listed yet, which isn't a reason to give up on it.
    expect(settleFirstPrompts({}, firstPrompts, seen())).toBeNull();
    expect(settleFirstPrompts({}, firstPrompts, seen({ hosts: { 's-1': 'idle' }, transcripts: ['s-1'] }))).toEqual({ drafts: {}, firstPrompts: {} });
  });

  it('becomes the session’s unsent message when Claude Code fails first', () => {
    const settled = settleFirstPrompts({}, { 's-1': first('Fix the login redirect') }, seen({ hosts: { 's-1': 'error' } }));
    expect(settled?.firstPrompts).toEqual({});
    expect(settled?.drafts['s-1']).toMatchObject({ text: 'Fix the login redirect', counted: true, startIn: '/work/app', form });
    expect(draftList(settled!.drafts).map((item) => item.key)).toEqual(['s-1']);
    // Something typed in the session's box since wins.
    expect(settleFirstPrompts({ 's-1': draft('typed since') }, { 's-1': first('Fix the login redirect') }, seen({ hosts: { 's-1': 'closed' } }))?.drafts['s-1']!.text).toBe('typed since');
  });

  it('goes back to New session in its folder after a restart, with its choices', () => {
    const settled = settleFirstPrompts({}, { 's-1': first('Fix the login redirect', true) }, seen());
    expect(settled?.firstPrompts).toEqual({});
    expect(settled?.drafts).toEqual({ [newDraftKey('/work/app')]: { text: 'Fix the login redirect', attachments: [], updatedAt: 1_000, counted: true, lostImages: 0, form } });
    // Not before the engine's lists are in: it may have started after all.
    expect(settleFirstPrompts({}, { 's-1': first('Fix the login redirect', true) }, seen({ ready: false }))).toBeNull();
  });

  it('takes a failed session’s message back to New session once the session is gone, next to a prompt written there', () => {
    const failed = draft('Fix the login redirect', { form, startIn: '/work/app', updatedAt: 500 });
    const there = draft('Add dark mode', { updatedAt: 2_000, form: { ...form, profileId: null } });
    const settled = settleFirstPrompts({ 's-1': failed, [newDraftKey('/work/app')]: there }, {}, seen());
    expect(settled?.drafts).toEqual({ [newDraftKey('/work/app')]: { ...there, text: 'Add dark mode\n\nFix the login redirect', updatedAt: 2_000 } });
    // While the failed session is still here, it stays in its box.
    expect(settleFirstPrompts({ 's-1': failed }, {}, seen({ hosts: { 's-1': 'error' } }))).toBeNull();
  });

  it('keeps a message that did start after all as an ordinary one', () => {
    const settled = settleFirstPrompts({ 's-1': draft('more', { form, startIn: '/work/app' }) }, {}, seen({ transcripts: ['s-1'] }));
    expect(settled?.drafts['s-1']).toEqual(draft('more'));
  });

  it('keeps editing a failed session’s message from losing its folder', () => {
    const next = nextDraft(draft('Fix it', { form, startIn: '/work/app' }), { text: 'Fix it now', attachments: [] }, 2_000);
    expect(next).toMatchObject({ startIn: '/work/app', form });
  });

  it('is saved apart from the drafts and read back as restored', () => {
    const saved = JSON.parse(JSON.stringify(serializeDrafts({}, { 's-1': first('Fix the login redirect') })));
    expect(saved.drafts).toEqual({});
    expect(parseDrafts(saved)).toEqual({});
    expect(parseFirstPrompts(saved)).toEqual({ 's-1': { draft: draft('Fix the login redirect', { form, startIn: '/work/app' }), restored: true } });
    // No first prompts saved: nothing to read; one without its choices can't go back to New session.
    expect(serializeDrafts({})).toEqual({ version: 1, drafts: {} });
    expect(parseFirstPrompts({ version: 1, drafts: {}, firstPrompts: { 's-1': { text: 'x', updatedAt: 1, images: 0, startIn: '/work/app' } } })).toEqual({});
  });
});

describe('changedDrafts', () => {
  it('lists the drafts that changed, came or went', () => {
    const kept = draft('same');
    const before = { a: kept, b: draft('old'), c: draft('gone') };
    const edited = draft('new');
    const added = draft('added');
    expect(changedDrafts(before, { a: kept, b: edited, d: added })).toEqual({ b: edited, c: null, d: added });
  });

  it('is empty when nothing changed', () => {
    const kept = draft('same');
    expect(changedDrafts({ a: kept }, { a: kept })).toEqual({});
  });
});

describe('a saved prompt in a draft', () => {
  const fill = { prompt: { id: 'fix-pr', name: 'Fix PR', scope: { kind: 'global' as const } }, text: 'Fix {{pr:pr}} on {{branch:branch}}', values: { pr: '#142' }, displays: {} };

  it('counts as something unsent, even with nothing typed under it', () => {
    const draft = nextDraft(undefined, { text: '', attachments: [], fill }, 1);
    expect(draft?.fill).toBe(fill);
    // Only the chips changed: the prompt stays; the box without one says null.
    expect(nextDraft(draft!, { text: '', attachments: [], context: [] }, 2)?.fill).toBe(fill);
    expect(nextDraft(draft!, { text: '', attachments: [], fill: null }, 3)).toBeNull();
  });

  it('is kept across a restart, with its values', () => {
    const draft = { ...nextDraft(undefined, { text: 'Keep the tests.', attachments: [], fill }, 1)!, counted: true };
    const back = parseDrafts(JSON.parse(JSON.stringify(serializeDrafts({ s1: draft }))));
    expect(back.s1?.fill).toEqual(fill);
    expect(back.s1?.text).toBe('Keep the tests.');
  });

  it('shows as filled so far in the lists, and sends the filled prompt then the text', () => {
    const draft = nextDraft(undefined, { text: 'Keep the tests.', attachments: [], fill }, 1)!;
    expect(draftList({ s1: { ...draft, counted: true } })[0]?.preview).toBe('Fix #142 on [Branch]');
    expect(draftMessage(draft)).toBe('Fix #142 on\n\nKeep the tests.');
  });
});
