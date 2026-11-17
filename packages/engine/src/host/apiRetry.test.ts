import { describe, expect, it } from 'vitest';
import { apiRetryOf, refusalOf, supersededBy } from './apiRetry.ts';

describe('apiRetryOf', () => {
  it('reads the numbers of an api_retry message', () => {
    expect(apiRetryOf({ attempt: 3, max_retries: 10, retry_delay_ms: 8000, error_status: 529 }, 5)).toEqual({ attempt: 3, maxRetries: 10, delayMs: 8000, status: 529, at: 5 });
  });
  it('keeps a missing status as null (a dropped connection)', () => {
    expect(apiRetryOf({ attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: null }, 5)?.status).toBeNull();
  });
  it('marks a retry after no response within the first-byte window', () => {
    expect(apiRetryOf({ attempt: 1, max_retries: 3, retry_delay_ms: 500, error_status: null, no_response: { waited_ms: 30000, retry_wait_ms: 60000 } }, 5)?.noResponse).toBe(true);
    expect(apiRetryOf({ attempt: 1, max_retries: 3, retry_delay_ms: 500, error_status: 529 }, 5)).not.toHaveProperty('noResponse');
  });
  it('ignores a message without the numbers', () => {
    expect(apiRetryOf({ attempt: 1 }, 5)).toBeNull();
  });
});

describe('refusalOf', () => {
  const fallback = { subtype: 'model_refusal_fallback', uuid: 'u1', fallback_model: 'claude-sonnet-5-5' };

  it('says the session switched, names the model and gives it as the model now in use', () => {
    const refusal = refusalOf({ ...fallback, scope: 'session', direction: 'retry' }, 0)!;
    expect(refusal.notice.type).toBe('system');
    expect(refusal.notice.uuid).toBe('u1');
    expect(refusal.notice.message).toEqual({ content: 'Claude switched this session to Sonnet after a refusal' });
    expect(refusal.model).toBe('claude-sonnet-5-5');
    // Older Claude Code sends no scope: the swap is the session's too.
    expect(refusalOf(fallback, 0)?.model).toBe('claude-sonnet-5-5');
  });
  it('names the family of an id with a context suffix', () => {
    expect(refusalOf({ ...fallback, fallback_model: 'opus[1m]' }, 0)?.notice.message).toEqual({ content: 'Claude switched this session to Opus after a refusal' });
  });
  it('lists the refused messages it retracts', () => {
    expect(refusalOf({ ...fallback, retracted_message_uuids: ['a', 'b', 3] }, 0)?.retracted).toEqual(['a', 'b']);
    expect(refusalOf(fallback, 0)?.retracted).toEqual([]);
  });
  it('says when there was no fallback, and changes no model', () => {
    const refusal = refusalOf({ subtype: 'model_refusal_no_fallback' }, 0)!;
    expect(refusal.notice.message).toEqual({ content: 'Claude refused and no fallback model was available' });
    expect(refusal.model).toBeNull();
  });
  it('leaves out a fallback only a subagent used, the unused directions and other subtypes', () => {
    expect(refusalOf({ ...fallback, scope: 'local' }, 0)).toBeNull();
    expect(refusalOf({ ...fallback, direction: 'revert' }, 0)).toBeNull();
    expect(refusalOf({ subtype: 'notification' }, 0)).toBeNull();
  });
});

describe('supersededBy', () => {
  it('lists the messages a reply replaces', () => {
    expect(supersededBy({ supersedes: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(supersededBy({})).toEqual([]);
  });
});
