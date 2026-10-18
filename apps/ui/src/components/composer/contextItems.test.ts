import { describe, expect, it } from 'vitest';
import type { ContextItem } from '@switchboard/protocol/client';
import { MAX_PROMPT_LENGTH } from '@switchboard/protocol/client';
import { addChips, chipLabel, chipsSummary, contextFromPrompt, fenceFor, isLongPaste, mentionFor, PASTE_CARD_CHARS, PASTE_CARD_LINES, pastedItem, pasteSize, pasteTooLongReason, promptWithContext, tooLongReason } from './contextItems.ts';

const file = (path: string, extra: Partial<Extract<ContextItem, { kind: 'file' }>> = {}): Extract<ContextItem, { kind: 'file' }> => ({ kind: 'file', path, directory: false, ...extra });

describe('mentionFor', () => {
  it('is relative inside the session folder, with lines as #L', () => {
    expect(mentionFor(file('/repo/src/auth.ts'), '/repo')).toBe('@src/auth.ts');
    expect(mentionFor(file('/repo/src/auth.ts', { range: { start: 12, end: 40 } }), '/repo')).toBe('@src/auth.ts#L12-40');
    expect(mentionFor(file('/repo/src/auth.ts', { range: { start: 7, end: 7 } }), '/repo')).toBe('@src/auth.ts#L7');
    expect(mentionFor(file('/elsewhere/x.ts'), '/repo')).toBe('@/elsewhere/x.ts');
  });

  it('ends folders with a slash and quotes paths with spaces, range included', () => {
    expect(mentionFor(file('/repo/src', { directory: true }), '/repo')).toBe('@src/');
    expect(mentionFor(file('/repo/My Docs/a b.md', { range: { start: 1, end: 3 } }), '/repo')).toBe('@"My Docs/a b.md#L1-3"');
  });
});

describe('promptWithContext', () => {
  it('puts the files after what you typed, on one line', () => {
    expect(promptWithContext('Why does this fail?', [file('/repo/src/auth.ts', { range: { start: 12, end: 40 } }), file('/repo/test', { directory: true })], '/repo')).toBe(
      'Why does this fail?\n\n@src/auth.ts#L12-40 @test/',
    );
  });

  it('sends text in a fence it cannot close, under its label', () => {
    const text: ContextItem = { kind: 'text', source: 'terminal', label: 'Terminal output', text: 'a ``` b\n\n', language: 'sh' };
    expect(promptWithContext('', [text], '/repo')).toBe('Terminal output:\n````sh\na ``` b\n````');
  });

  it('is just your text without chips', () => {
    expect(promptWithContext('  hi  ', [], null)).toBe('hi');
  });
});

describe('chips', () => {
  it('labels files by name and lines, with the path in the tooltip', () => {
    expect(chipLabel(file('/repo/src/auth.ts', { range: { start: 12, end: 40 } }), '/repo')).toEqual({ label: 'auth.ts:12-40', detail: 'src/auth.ts, lines 12-40' });
    expect(chipLabel(file('/repo/src/', { directory: true }), '/repo')).toEqual({ label: 'src/', detail: 'src/' });
    expect(chipLabel({ kind: 'text', source: 'problems', label: 'Problems in auth.ts', text: 'a\nb', path: '/repo/src/auth.ts' }, '/repo')).toEqual({
      label: 'Problems in auth.ts',
      detail: 'src/auth.ts · 2 lines of text',
    });
  });

  it('adds each item once', () => {
    const once = addChips([], [file('/a.ts'), file('/a.ts'), file('/a.ts', { range: { start: 1, end: 2 } })]);
    expect(once.map((c) => c.kind === 'file' && c.range?.start)).toEqual([undefined, 1]);
    expect(addChips(once, [file('/a.ts')])).toHaveLength(2);
    expect(new Set(once.map((c) => c.id)).size).toBe(2);
  });

  it('summarises them for a list', () => {
    expect(chipsSummary([file('/a'), file('/b')])).toBe('2 files');
    expect(chipsSummary([file('/a'), { kind: 'text', source: 'terminal', label: 'T', text: '' }])).toBe('1 file and 1 text');
  });

  it('fences with at least three backticks', () => {
    expect(fenceFor('plain')).toBe('```');
  });
});

describe('pasted text', () => {
  it('goes in a card when it is long in characters or in lines', () => {
    expect(isLongPaste('a short line')).toBe(false);
    expect(isLongPaste('x'.repeat(PASTE_CARD_CHARS))).toBe(false);
    expect(isLongPaste('x'.repeat(PASTE_CARD_CHARS + 1))).toBe(true);
    expect(isLongPaste('a\n'.repeat(PASTE_CARD_LINES))).toBe(false);
    expect(isLongPaste('a\n'.repeat(PASTE_CARD_LINES + 1))).toBe(true);
  });

  it('is numbered after the first, and says its size', () => {
    const first = pastedItem('one\ntwo\n', []);
    expect(first).toEqual({ kind: 'text', source: 'paste', label: 'Pasted text', text: 'one\ntwo\n' });
    expect(pastedItem('three', [first]).label).toBe('Pasted text 2');
    expect(pasteSize('one\ntwo\n')).toBe('2 lines · 8 characters');
    expect(chipLabel(first, '/repo')).toEqual({ label: 'Pasted text', detail: '2 lines · 8 characters' });
  });

  it('is sent in a fence under its label, after what you typed', () => {
    expect(promptWithContext('What is wrong here?', [pastedItem('a\nb', [])], '/repo')).toBe('What is wrong here?\n\nPasted text:\n```\na\nb\n```');
  });

  it('says when a paste or a message is too long, and how long it may be', () => {
    expect(pasteTooLongReason('x'.repeat(MAX_PROMPT_LENGTH))).toBeNull();
    expect(pasteTooLongReason('x'.repeat(MAX_PROMPT_LENGTH + 1))).toContain('Drop the file on the message box instead');
    expect(tooLongReason('hi')).toBeNull();
    expect(tooLongReason('x'.repeat(MAX_PROMPT_LENGTH + 1))).toBe('Too long to send: 1,000,001 characters, and a message holds up to 1,000,000. Shorten it or remove a pasted text.');
  });
});

describe('linked sessions', () => {
  const session = (sessionId: string, label: string): ContextItem => ({ kind: 'session', sessionId, label });

  it('writes a stub for each linked session, after the files and text blocks', () => {
    const text: ContextItem = { kind: 'text', source: 'terminal', label: 'Terminal output', text: 'ok' };
    const prompt = promptWithContext('stack on @Usage cost toggle', [session('id-1', 'Usage cost toggle'), file('/repo/a.ts'), text], '/repo');
    expect(prompt).toBe('stack on @Usage cost toggle\n\n@a.ts\n\nTerminal output:\n```\nok\n```\n\nLinked session: Usage cost toggle\n```switchboard-session\nsession: id-1\n```');
  });

  it('brings files and sessions back together, with the label still in the text', () => {
    const chips = [file('/repo/a.ts'), session('id-1', 'Usage cost toggle'), session('id-2', 'Usage cost toggle (2)')];
    const prompt = promptWithContext('stack on @Usage cost toggle and @Usage cost toggle (2)', chips, '/repo');
    expect(contextFromPrompt(prompt, '/repo')).toEqual({ text: 'stack on @Usage cost toggle and @Usage cost toggle (2)', context: chips });
  });

  it('reads a brief the engine wrote back as the chip it came from', () => {
    const sent = 'look at @Old spike\n\nLinked session: Old spike\n```switchboard-session\nsession: id-9\nbranch: spike\nstate: finished, last active 2026-10-18 13:02\n```';
    expect(contextFromPrompt(sent, '/repo')).toEqual({ text: 'look at @Old spike', context: [session('id-9', 'Old spike')] });
  });

  it('counts them in a summary, and adds the same one once', () => {
    expect(chipsSummary([file('/a'), session('id-1', 'One'), session('id-2', 'Two')])).toBe('1 file and 2 linked sessions');
    expect(addChips([], [session('id-1', 'One'), session('id-1', 'One')])).toHaveLength(1);
    expect(chipLabel(session('id-1', 'One'), null).label).toBe('One');
  });
});

describe('contextFromPrompt', () => {
  it('turns the line of mentions back into chips, the way promptWithContext wrote them', () => {
    const chips: ContextItem[] = [file('/repo/src/auth.ts', { range: { start: 12, end: 40 } }), file('/repo/test', { directory: true }), file('/repo/My Docs/a b.md'), file('/elsewhere/x.ts')];
    const prompt = promptWithContext('Why does this fail?', chips, '/repo');
    expect(contextFromPrompt(prompt, '/repo')).toEqual({ text: 'Why does this fail?', context: chips });
  });

  it('finds the mentions before text blocks, which stay in the text', () => {
    const chips: ContextItem[] = [file('/repo/a.ts'), { kind: 'text', source: 'terminal', label: 'Terminal output', text: 'boom', language: 'sh' }];
    const prompt = promptWithContext('Fix it', chips, '/repo');
    const back = contextFromPrompt(prompt, '/repo');
    expect(back.context).toEqual([file('/repo/a.ts')]);
    expect(back.text).toBe('Fix it\n\nTerminal output:\n```sh\nboom\n```');
  });

  it('takes a message of only files', () => {
    expect(contextFromPrompt('@tests/chaos-test-prompt.md', '/repo')).toEqual({ text: '', context: [file('/repo/tests/chaos-test-prompt.md')] });
  });

  it('leaves mentions in a sentence, and prompts without them, as they are', () => {
    expect(contextFromPrompt('Look at @src/a.ts please', '/repo')).toEqual({ text: 'Look at @src/a.ts please', context: [] });
    expect(contextFromPrompt('Hello\n\nthere', '/repo')).toEqual({ text: 'Hello\n\nthere', context: [] });
  });

  it('keeps relative mentions as text without a folder to resolve them', () => {
    expect(contextFromPrompt('Hi\n\n@src/a.ts', null)).toEqual({ text: 'Hi\n\n@src/a.ts', context: [] });
  });

  it('resolves into a Windows folder', () => {
    expect(contextFromPrompt('Hi\n\n@src/a.ts', 'C:\\repo').context).toEqual([file('C:\\repo\\src\\a.ts')]);
  });
});
