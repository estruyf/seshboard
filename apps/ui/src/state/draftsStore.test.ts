import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAttachment } from '@seshboard/protocol/client';
import { DRAFT_SETTLE_MS, draftList, newDraftKey, parseDrafts, parseFirstPrompts, serializeDrafts, type SessionsSeen } from './drafts.ts';
import { useDrafts } from './draftsStore.ts';

const image = { mediaType: 'image/png', data: 'AAAA', name: 'shot.png' } as unknown as ImageAttachment;
const store = () => useDrafts.getState();
const type = (key: string, text: string, attachments: ImageAttachment[] = []) => store().setDraft(key, { text, attachments });

beforeEach(() => {
  vi.useFakeTimers();
  useDrafts.setState({ drafts: {}, firstPrompts: {}, loaded: false, focus: null, list: null, archivePrompt: null });
});
afterEach(() => vi.useRealTimers());

describe('counting', () => {
  it('counts a draft once it has been left alone for a moment, not on a stray keystroke', () => {
    type('s-1', 'a');
    expect(store().drafts['s-1']!.counted).toBe(false);
    vi.advanceTimersByTime(DRAFT_SETTLE_MS - 100);
    type('s-1', 'al');
    vi.advanceTimersByTime(DRAFT_SETTLE_MS - 100);
    expect(store().drafts['s-1']!.counted).toBe(false);
    vi.advanceTimersByTime(100);
    expect(store().drafts['s-1']!.counted).toBe(true);
  });

  it('never counts a stray keystroke that is deleted again', () => {
    type('s-1', 'x');
    type('s-1', '');
    vi.advanceTimersByTime(DRAFT_SETTLE_MS * 2);
    expect(store().drafts['s-1']).toBeUndefined();
  });

  it('counts images without text', () => {
    type('s-1', '', [image]);
    vi.advanceTimersByTime(DRAFT_SETTLE_MS);
    expect(store().drafts['s-1']!.counted).toBe(true);
  });
});

describe('removal', () => {
  beforeEach(() => {
    type('s-1', 'unsent');
    type(newDraftKey('/work/app'), 'a prompt');
    vi.advanceTimersByTime(DRAFT_SETTLE_MS);
  });

  it('sending empties the box, which forgets the draft', () => {
    type('s-1', '');
    expect(store().drafts['s-1']).toBeUndefined();
  });

  it('starting, queueing, Discard and deleting remove it', () => {
    store().removeDraft(newDraftKey('/work/app'));
    expect(store().drafts[newDraftKey('/work/app')]).toBeUndefined();
    store().removeDraft('s-1');
    expect(store().drafts).toEqual({});
  });

  it('archiving asks first when a session has a draft, and confirming discards it', () => {
    const archive = vi.fn();
    store().requestArchive({ ids: ['s-1'], titles: ['Fix it'], archive }, true);
    expect(archive).not.toHaveBeenCalled();
    expect(store().archivePrompt?.ids).toEqual(['s-1']);
    store().archivePrompt!.archive();
    store().removeDrafts(store().archivePrompt!.ids);
    expect(archive).toHaveBeenCalledOnce();
    expect(store().drafts['s-1']).toBeUndefined();
  });

  it('archiving without a draft goes ahead', () => {
    const archive = vi.fn();
    store().requestArchive({ ids: [], titles: [], archive }, false);
    expect(archive).toHaveBeenCalledOnce();
    expect(store().archivePrompt).toBeNull();
  });
});

describe('New session', () => {
  it('moves a prompt to the project it is taken to, without the old choices', () => {
    type(newDraftKey(null), 'no folder yet');
    store().setForm(newDraftKey(null), { choices: { model: 'opus', permissionMode: 'plan', effort: '', workspace: 'current', baseRef: 'fresh', branch: '' }, profileId: null });
    store().moveDraft(newDraftKey(null), newDraftKey('/work/app'));
    expect(store().drafts[newDraftKey(null)]).toBeUndefined();
    expect(store().drafts[newDraftKey('/work/app')]).toMatchObject({ text: 'no folder yet', form: undefined });
  });

  it('seeds Edit and resend without the kept-for-you mark surviving an edit', () => {
    store().seedDraft('s-2', 'resend this');
    expect(store().drafts['s-2']!.seeded).toBe(true);
    type('s-2', 'resend this, changed');
    expect(store().drafts['s-2']!.seeded).toBeUndefined();
  });
});

describe('restart', () => {
  it('keeps the text across a restart, and anything typed meanwhile wins', () => {
    type('s-1', 'before the restart', [image]);
    vi.advanceTimersByTime(DRAFT_SETTLE_MS);
    const saved = JSON.parse(JSON.stringify(serializeDrafts(store().drafts)));
    useDrafts.setState({ drafts: {}, loaded: false });
    type('s-2', 'typed while loading');
    store().load(parseDrafts(saved));
    expect(store().loaded).toBe(true);
    expect(store().drafts['s-1']).toMatchObject({ text: 'before the restart', attachments: [], counted: true, lostImages: 1 });
    expect(store().drafts['s-2']!.text).toBe('typed while loading');
  });
});

describe('context chips', () => {
  const file = (path: string) => ({ kind: 'file' as const, path, directory: false });

  it('keeps chips in a draft of their own, and through typing', () => {
    store().addContext('s-1', [file('/repo/a.ts'), file('/repo/a.ts')]);
    expect(store().drafts['s-1']!.context).toHaveLength(1);
    type('s-1', 'Why?');
    expect(store().drafts['s-1']!.context).toHaveLength(1);
    type('s-1', '');
    // Still something to send: the chip.
    expect(store().drafts['s-1']!.context).toHaveLength(1);
  });

  it('forgets a draft once its last chip goes and nothing is typed', () => {
    store().addContext('s-1', [file('/repo/a.ts')]);
    const [chip] = store().drafts['s-1']!.context!;
    store().removeContext('s-1', [chip!.id]);
    expect(store().drafts['s-1']).toBeUndefined();
  });

  it('saves chips with the draft and reads them back', () => {
    store().addContext(newDraftKey('/repo'), [file('/repo/a.ts'), { kind: 'text', source: 'terminal', label: 'Terminal', text: 'npm ERR!' }]);
    const restored = parseDrafts(JSON.parse(JSON.stringify(serializeDrafts(store().drafts))));
    const context = restored[newDraftKey('/repo')]!.context!;
    expect(context.map(({ id: _id, ...item }) => item)).toEqual([file('/repo/a.ts'), { kind: 'text', source: 'terminal', label: 'Terminal', text: 'npm ERR!' }]);
    expect(context.every((chip) => typeof chip.id === 'string')).toBe(true);
  });
});

describe('a new session that fails before it starts', () => {
  const form = { choices: { model: '', permissionMode: 'default' as const, effort: '' as const, workspace: 'current' as const, baseRef: 'fresh' as const, branch: '' }, profileId: 'default' };
  const start = { cwd: '/repo', prompt: 'A prompt that must not get lost\n\n@src/a.ts', attachments: [image], form };
  const seen = (hosts: Record<string, 'running' | 'error'>, transcripts: string[] = []): SessionsSeen => ({ ready: true, hasTranscript: (id) => transcripts.includes(id), hostState: (id) => hosts[id] });

  beforeEach(() => store().load({}));

  it('keeps its first prompt out of sight while it runs, and forgets it once there is a transcript', () => {
    store().keepFirstPrompt('s-1', start);
    store().settleFirstPrompts(seen({ 's-1': 'running' }));
    expect(store().drafts).toEqual({});
    store().settleFirstPrompts(seen({ 's-1': 'running' }, ['s-1']));
    expect(store().firstPrompts).toEqual({});
    expect(store().drafts).toEqual({});
  });

  it('shows it as unsent when Claude Code fails, with its file as a chip again', () => {
    store().keepFirstPrompt('s-1', start);
    store().settleFirstPrompts(seen({ 's-1': 'error' }));
    const kept = store().drafts['s-1']!;
    expect(kept).toMatchObject({ text: 'A prompt that must not get lost', attachments: [image], startIn: '/repo', counted: true });
    expect(kept.context?.map(({ id: _id, ...item }) => item)).toEqual([{ kind: 'file', path: '/repo/src/a.ts', directory: false }]);
    expect(draftList(store().drafts)).toHaveLength(1);
  });

  it('finds it in New session after a restart', () => {
    store().keepFirstPrompt('s-1', start);
    const saved = JSON.parse(JSON.stringify(serializeDrafts(store().drafts, store().firstPrompts)));
    useDrafts.setState({ drafts: {}, firstPrompts: {}, loaded: false });
    store().load(parseDrafts(saved), parseFirstPrompts(saved));
    store().settleFirstPrompts(seen({}));
    expect(store().firstPrompts).toEqual({});
    expect(store().drafts[newDraftKey('/repo')]).toMatchObject({ text: 'A prompt that must not get lost', counted: true, lostImages: 1, form });
  });
});

describe('drafts from another window', () => {
  it('takes them as they are, and forgets the ones gone there', () => {
    type('s-1', 'here');
    type('s-2', 'stays');
    const there = { text: 'typed in the pop-out', attachments: [image], updatedAt: 5, counted: true, lostImages: 0 };
    store().applyRelayed({ 's-1': null, 's-3': there });
    expect(store().drafts['s-1']).toBeUndefined();
    expect(store().drafts['s-2']!.text).toBe('stays');
    expect(store().drafts['s-3']).toBe(there);
  });

  it("leaves settling to the window it was typed in", () => {
    type('s-1', 'a');
    const there = { text: 'ab', attachments: [], updatedAt: 5, counted: false, lostImages: 0 };
    store().applyRelayed({ 's-1': there });
    vi.advanceTimersByTime(DRAFT_SETTLE_MS * 2);
    expect(store().drafts['s-1']).toBe(there);
  });
});
