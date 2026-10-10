import type { DeepLink } from '@switchboard/protocol/bridge';
import { trimTrailingSeparators } from '@switchboard/protocol/paths';

/** The URL scheme Switchboard registers: `switchboard://…`. */
export const DEEP_LINK_SCHEME = 'switchboard';
/** Longest prompt a link may carry, like Claude Code's `claude-cli://` links. */
export const MAX_LINK_PROMPT = 5_000;
/** Anything longer is not a link someone typed or generated on purpose. */
const MAX_URL_LENGTH = 32_000;

/**
 * Characters that change how text displays without showing themselves: bidirectional overrides and
 * isolates, zero-width spaces and joiners, the BOM and soft hyphen. In a folder path they can make
 * one path look like another, so a path with any of them is refused.
 */
const INVISIBLE = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]/;
/** The same for a prompt, except the zero-width joiner, which emoji sequences need. */
const PROMPT_INVISIBLE = /[­؜᠎​‌‎‏‪-‮⁠-⁤⁦-⁯﻿]/;
/** Control characters; a prompt may still have tabs and new lines. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const PROMPT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SESSION_ID = /^[A-Za-z0-9-]{1,100}$/;

export type ParsedLink = { ok: true; link: DeepLink } | { ok: false; error: string };

const fail = (error: string): ParsedLink => ({ ok: false, error });

/**
 * Checks a folder from a link: absolute, local, no `..`, nothing hidden. Returns it without a trailing slash.
 * On Windows that is a drive path (`C:\…` or `C:/…`); `/…` (the current drive) is not absolute enough there.
 */
function checkFolder(cwd: string, platform: string): string | ParsedLink {
  const windows = platform === 'win32';
  const drive = windows && /^[A-Za-z]:[\\/]/.test(cwd);
  if (CONTROL.test(cwd) || INVISIBLE.test(cwd)) return fail('The folder in the link contains hidden or control characters.');
  // On Windows a drive letter looks like a one-letter URL scheme; anything else with a scheme is not a local folder.
  const scheme = windows ? /^[a-z][a-z0-9+.-]+:/i : /^[a-z][a-z0-9+.-]*:/i;
  if (cwd.startsWith('//') || cwd.startsWith('\\\\') || scheme.test(cwd)) return fail('The folder in the link is a network location; use a local folder.');
  if (windows ? !drive : !cwd.startsWith('/')) return fail(`The folder in the link must be an absolute path, like ${windows ? 'C:\\Users\\you\\dev\\project' : '/Users/you/dev/project'}.`);
  // After the drive, a colon names an alternate data stream, never a folder.
  if (windows && cwd.slice(2).includes(':')) return fail('The folder in the link may not contain a colon after the drive.');
  if (cwd.split(windows ? /[\\/]/ : '/').some((part) => part === '..' || part === '.')) return fail('The folder in the link may not contain . or .. segments.');
  if (cwd.length > 4096) return fail('The folder in the link is too long.');
  // `C:\\` is still the drive's root, not `C:` (the current folder on that drive).
  return trimTrailingSeparators(cwd);
}

/**
 * Parses and validates a `switchboard://` link. Nothing is trusted: a link can come from any web page,
 * chat message or script. Unknown parameters are ignored (so links made for a newer version still
 * work); a known parameter with a bad value refuses the whole link.
 *
 * - `switchboard://new-session?prompt=…&cwd=/abs/path` (or `project=name`, or `repo=owner/name`; `q` is an alias
 *   of `prompt`). `autostart=1` starts the session; by default it waits for the user to press Enter.
 *   `question=1` makes it a quick question, without a project (a folder, project or repo is then ignored).
 * - `switchboard://session/<sessionId>`
 *
 * `platform` decides what an absolute folder looks like (a drive path on Windows); tests pass it.
 */
export function parseDeepLink(raw: string, platform: string = process.platform): ParsedLink {
  if (raw.length > MAX_URL_LENGTH) return fail('The link is too long.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('That is not a valid Switchboard link.');
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return fail('That is not a Switchboard link.');
  // `switchboard://new-session` puts the action in the host; `switchboard:new-session` in the path.
  let parts: string[];
  try {
    parts = [url.hostname, ...url.pathname.split('/')].filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return fail('That is not a valid Switchboard link.');
  }
  const action = parts[0]?.toLowerCase() ?? '';

  if (action === 'new-session') {
    if (parts.length > 1) return fail('Unexpected path after new-session in the link.');
    const params = url.searchParams;
    const prompt = params.get('prompt') ?? params.get('q');
    if (prompt !== null) {
      if (prompt.length > MAX_LINK_PROMPT) return fail(`The prompt in the link is longer than ${MAX_LINK_PROMPT.toLocaleString('en-US')} characters.`);
      if (PROMPT_CONTROL.test(prompt) || PROMPT_INVISIBLE.test(prompt)) return fail('The prompt in the link contains hidden or control characters.');
    }
    let cwd: string | null = null;
    const rawCwd = params.get('cwd');
    if (rawCwd !== null && rawCwd !== '') {
      const checked = checkFolder(rawCwd, platform);
      if (typeof checked !== 'string') return checked;
      cwd = checked;
    }
    let project: string | null = null;
    const rawProject = params.get('project');
    if (rawProject !== null && rawProject.trim() !== '') {
      if (CONTROL.test(rawProject) || INVISIBLE.test(rawProject)) return fail('The project in the link contains hidden or control characters.');
      if (rawProject.length > 200) return fail('The project name in the link is too long.');
      project = rawProject.trim();
    }
    const rawStart = params.get('autostart')?.toLowerCase() ?? null;
    if (rawStart !== null && !['', '1', 'true', 'yes', '0', 'false', 'no'].includes(rawStart)) return fail('autostart in the link must be 1 or 0.');
    // Present without a value (`&autostart`) counts as on, like a flag.
    const autostart = rawStart !== null && ['', '1', 'true', 'yes'].includes(rawStart);
    const rawQuestion = params.get('question')?.toLowerCase() ?? null;
    if (rawQuestion !== null && !['', '1', 'true', 'yes', '0', 'false', 'no'].includes(rawQuestion)) return fail('question in the link must be 1 or 0.');
    const question = rawQuestion !== null && ['', '1', 'true', 'yes'].includes(rawQuestion);
    let repo: string | null = null;
    const rawRepo = params.get('repo');
    if (rawRepo !== null && rawRepo !== '') {
      const trimmed = rawRepo.replace(/\.git$/, '');
      if (!REPO.test(trimmed) || trimmed.length > 200) return fail('The repo in the link must look like owner/name.');
      repo = trimmed;
    }
    // A quick question has no folder. Otherwise a folder wins over a project, and a project over a repository:
    // only the strongest is passed on.
    return {
      ok: true,
      link: {
        action: 'new-session',
        prompt: prompt?.replace(/\r\n?/g, '\n') || null,
        cwd: question ? null : cwd,
        project: question || cwd ? null : project,
        repo: question || cwd || project ? null : repo,
        autostart,
        question,
      },
    };
  }

  if (action === 'session') {
    const id = parts[1] ?? '';
    if (parts.length !== 2 || !SESSION_ID.test(id)) return fail('The link does not name a valid session.');
    return { ok: true, link: { action: 'session', sessionId: id } };
  }

  return fail(action ? `Switchboard links can't do "${action.slice(0, 40)}". Use new-session or session.` : 'The link has no action. Use new-session or session.');
}

/**
 * `switchboard://show`: brings the window up without changing what it shows. The VS Code companion opens it to start
 * Switchboard outside macOS, where it can't open the app by its bundle id. Main handles it; the window never sees it.
 */
export function isShowLink(raw: string): boolean {
  if (raw.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(raw);
    return url.protocol === `${DEEP_LINK_SCHEME}:` && !url.search && [url.hostname, ...url.pathname.split('/')].filter(Boolean).join('/').toLowerCase() === 'show';
  } catch {
    return false;
  }
}

/** The first `switchboard://` link in a command line (a second instance started with a link, outside macOS). */
export function linkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)) ?? null;
}
