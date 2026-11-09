import { localPreviewUrl } from '@seshboard/protocol';
import { plainText } from './outputMessage.ts';

/** The most addresses a terminal offers; a dev server prints one or two (Local, Network). */
export const MAX_SERVER_URLS = 4;

// An address with its scheme, `[::1]` included. Trailing punctuation is trimmed after.
const WITH_SCHEME = /\bhttps?:\/\/(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?(?:[/?#][^\s'"<>`]*)?/gi;
// `localhost:3000` without a scheme, as Express and many scripts print it.
const BARE_HOST = /(?<![\w/.@-])(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b(\/[^\s'"<>`]*)?/gi;
// "Listening on port 3000", "Server running on port 8080".
const PORT_ONLY = /\b(?:listening|running|started|serving|available)\b.*?\bport\s*:?\s*(\d{2,5})\b/i;
// A dev server's own line for this computer: Vite's and Next's `Local:`, Astro's `Local`.
const LOCAL_LINE = /\blocal\b/i;

const trimEnd = (url: string) => url.replace(/[.,;:!?)\]}'"]+$/, '');

/** The local addresses on one line of plain text, in order. */
function lineUrls(line: string): string[] {
  const found: string[] = [];
  for (const match of line.matchAll(WITH_SCHEME)) found.push(trimEnd(match[0]));
  if (found.length === 0) {
    for (const match of line.matchAll(BARE_HOST)) found.push(trimEnd(`http://${match[0]}`));
  }
  if (found.length === 0) {
    const port = PORT_ONLY.exec(line);
    if (port) found.push(`http://localhost:${port[1]}/`);
  }
  return found.map(localPreviewUrl).filter((url): url is string => url !== null);
}

/**
 * The addresses of a server a command started, from its output (plain text, escape codes gone): local ones only,
 * those on a `Local:` line first, without repeats, at most `MAX_SERVER_URLS`.
 */
export function serverUrls(text: string): string[] {
  const local: string[] = [];
  const other: string[] = [];
  for (const line of text.split('\n')) {
    const urls = lineUrls(line);
    if (urls.length > 0) (LOCAL_LINE.test(line) ? local : other).push(...urls);
  }
  return [...new Set([...local, ...other])].slice(0, MAX_SERVER_URLS);
}

/** Lines that may hold an address, kept per terminal so a later chunk can be read with them. */
export const MAX_URL_LINES = 40;

/**
 * The lines to keep after `added`: the newest `MAX_URL_LINES`, but a `Local:` line stays however much a server logs
 * after it (requests to `http://localhost:3000/api` would push the banner out).
 */
export function keepUrlLines(kept: readonly string[], added: readonly string[]): string[] {
  const lines = [...kept, ...added];
  while (lines.length > MAX_URL_LINES) {
    const other = lines.findIndex((line) => !LOCAL_LINE.test(line));
    lines.splice(other === -1 ? 0 : other, 1);
  }
  return lines;
}

/**
 * Reads a chunk of terminal output for addresses. `carry` is the unfinished last line of the chunk before, as it came
 * (an address or an escape code can be split between chunks); the result has the whole lines, as plain text, that
 * may hold an address, and the new unfinished line.
 */
export function scanChunk(carry: string, chunk: string): { lines: string[]; carry: string } {
  const all = (carry + chunk).split('\n');
  // Held back until its line ends; a line that never ends is cut, so the carry stays small.
  const rest = all.pop()!.slice(-2000);
  const lines = all.length > 0 ? plainText(all.join('\n')).split('\n') : [];
  return { lines: lines.filter((line) => /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::|port/i.test(line)), carry: rest };
}
