/**
 * Recognising a turn that failed because Claude Code's login stopped working (signed out, expired, revoked). Pure, so it
 * is tested without Claude Code.
 */

/** The SDK's error codes on an assistant message that mean the login, not the request, is the problem. */
const SIGN_IN_CODES = new Set(['authentication_failed']);

/**
 * What Claude Code says when it has no working login, for builds that send no error code: "OAuth token has expired ·
 * Please run /login", "Invalid API key · Please run /login", "Not logged in · Please run /login".
 */
const SIGN_IN_TEXT = [/please run \/login/i, /oauth token (has )?expired/i, /\bnot logged in\b/i, /token has been revoked/i];

/** Whether a failed turn's error code or text says Claude Code has to sign in again. */
export function isSignInError(code: string | null | undefined, text: string | null | undefined): boolean {
  if (code && SIGN_IN_CODES.has(code)) return true;
  return !!text && SIGN_IN_TEXT.some((pattern) => pattern.test(text));
}
