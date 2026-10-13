import { describe, expect, it } from 'vitest';
import type { ImageAttachment } from '@switchboard/protocol/client';
import { attachmentLabel, firstLine, focusAfterRemoval, holdNote, lastQueued, mergeIntoBox, upNextTitle } from './upNext.ts';

const image = (name: string): ImageAttachment => ({ type: 'image', mediaType: 'image/png', data: 'AAAA', name });

describe('firstLine', () => {
  it('takes the first line that has text', () => {
    expect(firstLine('\n  \nFix the build\nand the tests')).toBe('Fix the build');
  });
  it('cuts a long line', () => {
    const line = firstLine('x'.repeat(300), 20);
    expect(line).toHaveLength(20);
    expect(line.endsWith('…')).toBe(true);
  });
  it('is empty for an image-only message', () => {
    expect(firstLine('')).toBe('');
  });
});

describe('attachmentLabel', () => {
  it('names one image and counts several', () => {
    expect(attachmentLabel([])).toBeNull();
    expect(attachmentLabel(['shot.png'])).toBe('shot.png');
    expect(attachmentLabel(['a.png', 'b.png'])).toBe('2 images');
  });
});

describe('upNextTitle', () => {
  it('counts the messages', () => {
    expect(upNextTitle(1)).toBe('Up next · 1 message');
    expect(upNextTitle(3)).toBe('Up next · 3 messages');
  });
});

describe('holdNote', () => {
  it('says why the queue waits, and only when something is waiting', () => {
    expect(holdNote('stopped', 2)).toBe('You stopped Claude. 2 messages are waiting.');
    expect(holdNote('error', 1)).toBe('The last turn failed. 1 message is waiting.');
    expect(holdNote(null, 2)).toBeNull();
    expect(holdNote('stopped', 0)).toBeNull();
  });
});

describe('mergeIntoBox', () => {
  it('fills an empty box', () => {
    expect(mergeIntoBox({ text: '  ', attachments: [] }, { text: 'Run the tests', attachments: [image('a.png')] })).toEqual({ text: 'Run the tests', attachments: [image('a.png')] });
  });
  it('keeps what is typed and puts the taken message under it', () => {
    const merged = mergeIntoBox({ text: 'Also this\n', attachments: [image('a.png')] }, { text: 'Run the tests', attachments: [image('b.png')] });
    expect(merged.text).toBe('Also this\n\nRun the tests');
    expect(merged.attachments.map((a) => a.name)).toEqual(['a.png', 'b.png']);
  });
  it('does not add a blank gap for an image-only message', () => {
    expect(mergeIntoBox({ text: 'typed', attachments: [] }, { text: '', attachments: [image('b.png')] }).text).toBe('typed');
  });
});

describe('lastQueued', () => {
  it('is the message sent last', () => {
    const entry = (id: string) => ({ id, text: id, attachments: [], createdAt: 1 });
    expect(lastQueued([entry('a'), entry('b')])?.id).toBe('b');
    expect(lastQueued([])).toBeNull();
  });
});

describe('focusAfterRemoval', () => {
  it('goes to the next row, else the previous one', () => {
    expect(focusAfterRemoval(['a', 'b', 'c'], 'b')).toBe('c');
    expect(focusAfterRemoval(['a', 'b', 'c'], 'c')).toBe('b');
    expect(focusAfterRemoval(['a'], 'a')).toBeNull();
    expect(focusAfterRemoval(['a'], 'z')).toBeNull();
  });
});
