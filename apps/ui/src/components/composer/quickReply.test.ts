import { describe, expect, it } from 'vitest';
import { QUICK_REPLY_CHIP_MAX, quickReplyLabel, quickReplyOf, type QuickReplyBox } from './quickReply.ts';

const empty: QuickReplyBox = { reply: 'go', enabled: true, text: '', chips: 0, attachments: 0, busyWith: false, running: false, disabled: false };

describe('quickReplyOf', () => {
  it('offers the reply in an empty box after a turn', () => {
    expect(quickReplyOf(empty)).toBe('go');
    expect(quickReplyOf({ ...empty, reply: '  yes, stop it \n' })).toBe('yes, stop it');
  });

  it('offers nothing without a reply, or with the setting off', () => {
    expect(quickReplyOf({ ...empty, reply: undefined })).toBeNull();
    expect(quickReplyOf({ ...empty, reply: '   ' })).toBeNull();
    expect(quickReplyOf({ ...empty, enabled: false })).toBeNull();
  });

  it('never covers or joins what is in the box', () => {
    expect(quickReplyOf({ ...empty, text: 'n' })).toBeNull();
    expect(quickReplyOf({ ...empty, chips: 1 })).toBeNull();
    expect(quickReplyOf({ ...empty, attachments: 1 })).toBeNull();
    expect(quickReplyOf({ ...empty, busyWith: true })).toBeNull();
  });

  it('offers nothing while Claude works or the box is disabled', () => {
    expect(quickReplyOf({ ...empty, running: true })).toBeNull();
    expect(quickReplyOf({ ...empty, disabled: true })).toBeNull();
  });
});

describe('quickReplyLabel', () => {
  it('keeps a short reply and puts it on one line', () => {
    expect(quickReplyLabel('go')).toBe('go');
    expect(quickReplyLabel('yes\n  run it')).toBe('yes run it');
  });

  it('cuts a long reply', () => {
    const label = quickReplyLabel('x'.repeat(200));
    expect(label).toHaveLength(QUICK_REPLY_CHIP_MAX);
    expect(label.endsWith('…')).toBe(true);
  });
});
