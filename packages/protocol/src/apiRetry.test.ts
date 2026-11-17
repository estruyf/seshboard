import { describe, expect, it } from 'vitest';
import { apiRetryCause, apiRetryLine } from './apiRetry.ts';

const retry = { attempt: 3, maxRetries: 10, delayMs: 8_000, status: 529, at: 1_000 };

describe('apiRetryLine', () => {
  it('names the cause from the status', () => {
    expect(apiRetryCause(529)).toBe('API overloaded');
    expect(apiRetryCause(429)).toBe('API rate limited');
    expect(apiRetryCause(500)).toBe('API error');
    expect(apiRetryCause(null)).toBe('API error');
  });

  it('counts the wait down', () => {
    expect(apiRetryLine(retry, 1_000)).toBe('API overloaded, retrying (3 of 10) in 8s');
    expect(apiRetryLine(retry, 4_500)).toBe('API overloaded, retrying (3 of 10) in 5s');
    expect(apiRetryLine({ ...retry, delayMs: 65_000 }, 1_000)).toBe('API overloaded, retrying (3 of 10) in 1m 5s');
  });

  it('leaves the time out when the wait is over or the clock is not known', () => {
    expect(apiRetryLine(retry, 9_000)).toBe('API overloaded, retrying (3 of 10)');
    expect(apiRetryLine(retry, null)).toBe('API overloaded, retrying (3 of 10)');
  });

  it('leaves the count out without a maximum', () => {
    expect(apiRetryLine({ ...retry, maxRetries: 0, status: null }, null)).toBe('API error, retrying');
  });
});
