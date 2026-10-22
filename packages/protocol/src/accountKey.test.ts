import { describe, expect, it } from 'vitest';
import { accountKey, accountTag } from './accountKey.ts';

describe('accountKey', () => {
  it('is the same for the same account, whatever the case or spaces of its email', () => {
    const key = accountKey({ email: 'Elio@Example.com ', organization: 'Struyf' });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(accountKey({ email: 'elio@example.com', organization: 'Struyf' })).toBe(key);
  });

  it('tells organizations apart', () => {
    expect(accountKey({ email: 'elio@example.com', organization: 'Struyf' })).not.toBe(accountKey({ email: 'elio@example.com', organization: null }));
  });

  it('is null without an account or an email', () => {
    expect(accountKey(null)).toBeNull();
    expect(accountKey({ email: null, organization: 'Struyf' })).toBeNull();
    expect(accountKey({ email: '  ', organization: null })).toBeNull();
  });

  it('never contains the email', () => {
    expect(accountKey({ email: 'elio@example.com', organization: null })).not.toContain('elio');
  });
});

describe('accountTag', () => {
  it('is the same for the same account, and never its key', () => {
    const account = { email: 'elio@example.com', organization: 'Struyf' };
    const tag = accountTag(account);
    expect(tag).toMatch(/^[a-f0-9]{64}$/);
    expect(accountTag({ email: 'Elio@example.com', organization: 'Struyf' })).toBe(tag);
    expect(tag).not.toBe(accountKey(account));
    expect(accountTag({ email: 'elio@example.com', organization: null })).not.toBe(tag);
  });

  it('is null without an account', () => {
    expect(accountTag(null)).toBeNull();
  });
});
