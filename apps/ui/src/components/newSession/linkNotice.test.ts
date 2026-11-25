import { describe, expect, it } from 'vitest';
import { linkNoticeText, LONG_LINK_PROMPT } from './linkNotice.ts';

describe('linkNoticeText', () => {
  it('says where the prompt came from', () => {
    expect(linkNoticeText(20)).toBe('Prompt from an external link. Read it before you start the session.');
    expect(linkNoticeText(20, 'browser')).toBe('Prompt from a page in the browser. Read it before you start the session.');
  });

  it('gives the length of a long prompt', () => {
    expect(linkNoticeText(LONG_LINK_PROMPT - 1)).not.toContain('characters');
    expect(linkNoticeText(4321)).toBe('Prompt from an external link (4,321 characters). Read it before you start the session.');
  });
});
