import { describe, expect, it } from 'vitest';
import { isSignInError } from './signInError.ts';

describe('isSignInError', () => {
  it('takes the SDK error code', () => {
    expect(isSignInError('authentication_failed', null)).toBe(true);
    expect(isSignInError('rate_limit', null)).toBe(false);
    expect(isSignInError('server_error', 'API Error: 500')).toBe(false);
  });

  it('reads what Claude Code says when there is no code', () => {
    expect(isSignInError(null, 'OAuth token has expired · Please run /login')).toBe(true);
    expect(isSignInError(undefined, 'Invalid API key · Please run /login')).toBe(true);
    expect(isSignInError(null, 'Not logged in · Please run /login')).toBe(true);
    expect(isSignInError(null, 'API Error: 401 {"error":{"message":"OAuth token has been revoked"}}')).toBe(true);
  });

  it('leaves other failures alone', () => {
    expect(isSignInError(null, null)).toBe(false);
    expect(isSignInError(null, "You've hit your limit · resets 3pm")).toBe(false);
    expect(isSignInError(null, 'The login form in src/login.ts is broken')).toBe(false);
  });
});
