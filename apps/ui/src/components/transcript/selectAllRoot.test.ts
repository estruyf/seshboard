import { describe, expect, it } from 'vitest';
import { overlayBlocks, selectAllRoot, type RootLike } from './selectAllRoot.ts';

/** A node with parents, as the contains check reads it. */
class Node implements RootLike {
  constructor(
    readonly name: string,
    readonly parent: Node | null = null,
  ) {}
  contains(other: RootLike | null): boolean {
    for (let n = other as Node | null; n; n = n.parent) if (n === this) return true;
    return false;
  }
}
const page = new Node('page');
const transcript = new Node('transcript', page);
const reading = new Node('reading', page);
const dialog = new Node('dialog', page);
const previewInDialog = new Node('preview', dialog);
const menu = new Node('menu', page);
const none = { fieldFocused: false, selection: null, pointer: null, focus: null, overlays: [] as Node[] };

describe('selectAllRoot', () => {
  it('takes the area that holds the selection, before the last click and the focus', () => {
    expect(selectAllRoot({ ...none, selection: transcript, pointer: reading, focus: reading })).toBe(transcript);
  });

  it('takes the area last clicked in when the selection is in none, then the one that holds focus', () => {
    expect(selectAllRoot({ ...none, pointer: reading, focus: transcript })).toBe(reading);
    expect(selectAllRoot({ ...none, focus: transcript })).toBe(transcript);
  });

  it('takes the area on top when nothing points at one, and leaves it to the browser without one', () => {
    expect(selectAllRoot({ ...none, fallback: reading })).toBe(reading);
    expect(selectAllRoot({ ...none })).toBeNull();
  });

  it('leaves it to the browser in a field, the message box or the terminal', () => {
    expect(selectAllRoot({ ...none, fieldFocused: true, selection: transcript, pointer: transcript })).toBeNull();
  });

  it('leaves it to a dialog, menu or list that is open and not part of the area', () => {
    expect(selectAllRoot({ ...none, selection: transcript, overlays: [dialog] })).toBeNull();
    expect(selectAllRoot({ ...none, pointer: transcript, overlays: [menu] })).toBeNull();
  });

  it('works inside a dialog that holds the area (the file preview), and with an overlay inside it', () => {
    expect(selectAllRoot({ ...none, pointer: previewInDialog, overlays: [dialog] })).toBe(previewInDialog);
    const inside = new Node('inside', transcript);
    expect(selectAllRoot({ ...none, pointer: transcript, overlays: [inside] })).toBe(transcript);
  });

  it('reads overlays by where they are, one by one', () => {
    expect(overlayBlocks(transcript, [])).toBe(false);
    expect(overlayBlocks(transcript, [previewInDialog, menu])).toBe(true);
  });
});
