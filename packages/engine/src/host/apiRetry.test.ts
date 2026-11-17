import { describe, expect, it } from 'vitest';
import { apiRetryOf, refusalNotice } from './apiRetry.ts';

describe('apiRetryOf', () => {
  it('reads the numbers of an api_retry message', () => {
    expect(apiRetryOf({ attempt: 3, max_retries: 10, retry_delay_ms: 8000, error_status: 529 }, 5)).toEqual({ attempt: 3, maxRetries: 10, delayMs: 8000, status: 529, at: 5 });
  });
  it('keeps a missing status as null (a dropped connection)', () => {
    expect(apiRetryOf({ attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: null }, 5)?.status).toBeNull();
  });
  it('ignores a message without the numbers', () => {
    expect(apiRetryOf({ attempt: 1 }, 5)).toBeNull();
  });
});

describe('refusalNotice', () => {
  it('says where the turn went', () => {
    const notice = refusalNotice({ subtype: 'model_refusal_fallback', uuid: 'u1', fallback_model: 'claude-sonnet-5-5' }, 0)!;
    expect(notice.type).toBe('system');
    expect(notice.uuid).toBe('u1');
    expect(notice.message).toEqual({ content: 'Claude moved this turn to Sonnet after a refusal' });
  });
  it('says when there was no fallback', () => {
    expect(refusalNotice({ subtype: 'model_refusal_no_fallback' }, 0)?.message).toEqual({ content: 'Claude refused and no fallback model was available' });
  });
  it('leaves out a fallback that only a subagent used, and other subtypes', () => {
    expect(refusalNotice({ subtype: 'model_refusal_fallback', scope: 'local', fallback_model: 'claude-sonnet-5-5' }, 0)).toBeNull();
    expect(refusalNotice({ subtype: 'notification' }, 0)).toBeNull();
  });
});
