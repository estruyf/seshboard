import { MOD_LIMITS } from '@seshboard/protocol/client';

/**
 * A mod's link target, or null when it may not be opened: only http and https, at most 2,048 characters, no control
 * characters. Main opens what passes in the browser (and refuses anything else again).
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string' || href.length === 0 || href.length > MOD_LIMITS.href) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
