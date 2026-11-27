import type { CompanionContextItemInput, CompanionProject, CompanionSession, CompanionTarget } from '@seshboard/protocol/companion-client';

/**
 * What the extension sends, and where: pure functions, so the tests run without a browser. The popup and the
 * background script (the right-click menu) both use them.
 */

/** The page in the browser: its address and title, and the text selected on it (empty when none). */
export interface PageInfo {
  url: string;
  title: string;
  selection: string;
}

/** The longest text the extension sends from a page (the protocol takes more; a page selection rarely needs it). */
export const MAX_SELECTION = 100_000;

/** A title cut to fit a chip. */
export function shortTitle(title: string, max = 60): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The page's host, for a chip without a title (`github.com`). */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * The chips for a page: the selection (with where it came from), the page itself (its title and address), or both.
 * A selection always says which page it is from, so Claude can open it.
 */
export function pageItems(page: PageInfo, include: { selection: boolean; page: boolean }): CompanionContextItemInput[] {
  const name = shortTitle(page.title) || hostOf(page.url);
  const items: CompanionContextItemInput[] = [];
  const selection = page.selection.trim().slice(0, MAX_SELECTION);
  if (include.selection && selection) {
    items.push({ kind: 'text', source: 'page', label: `Selection on ${name}`, text: `${selection}\n\nFrom ${page.title.trim() || page.url} (${page.url})` });
  }
  if (include.page) items.push({ kind: 'text', source: 'page', label: name, text: `${page.title.trim() || page.url}\n${page.url}` });
  return items;
}

/** One choice in the popup's list of where to send. */
export interface TargetOption {
  /** Unique in the list, for the select's value. */
  value: string;
  /** A session's title, or a project's name. */
  label: string;
  /** The line under it: where a session is, or a project's folder. */
  detail: string;
  /** A tag after the label: `On screen` in Seshboard, the page's `This page` project, or `Needs you`. */
  tag: string | null;
  /** The group it is listed under. */
  group: 'sessions' | 'new';
  target: CompanionTarget;
}

/** The last part of a path, on either system. */
const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** What the picker's button says for a choice. */
export const targetSummary = (option: TargetOption) => (option.group === 'new' ? `New session in ${option.label}` : option.label);

/**
 * The choices that match what was typed: every word somewhere in the label, the detail or the tag, without regard to
 * case. Nothing typed keeps them all.
 */
export function filterTargets(options: readonly TargetOption[], query: string): TargetOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((o) => {
    const text = `${o.label} ${o.detail} ${o.tag ?? ''} ${o.group === 'new' ? 'new session' : ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Sessions shown in the list: what needs you, what is working, then the most recent. */
const MAX_SESSIONS = 15;

/**
 * Where the popup can send: the session on screen in Seshboard and the other listed sessions, then New session in
 * each project, the one the page belongs to first.
 */
export function targetOptions(sessions: readonly CompanionSession[], focused: CompanionSession | null, projects: readonly CompanionProject[], matched: string | null): TargetOption[] {
  const listed = focused ? [focused, ...sessions.filter((s) => s.id !== focused.id)] : [...sessions];
  const out: TargetOption[] = listed.slice(0, MAX_SESSIONS).map((s) => ({
    value: `session:${s.id}`,
    label: shortTitle(s.title, 80),
    detail: [lastPart(s.projectRoot), s.branch].filter(Boolean).join(' · '),
    tag: s.id === focused?.id ? 'On screen' : s.status === 'needs-you' ? 'Needs you' : null,
    group: 'sessions',
    target: { kind: 'session', sessionId: s.id },
  }));
  const ordered = matched ? [...projects.filter((p) => p.root === matched), ...projects.filter((p) => p.root !== matched)] : projects;
  for (const project of ordered) {
    out.push({ value: `new:${project.root}`, label: project.name, detail: project.root, tag: project.root === matched ? 'This page' : null, group: 'new', target: { kind: 'new', cwd: project.root } });
  }
  return out;
}

/**
 * The choice the popup starts on: New session in the page's project when it belongs to one, else the session on
 * screen in Seshboard, else the first in the list.
 */
export function defaultTarget(options: readonly TargetOption[], focused: CompanionSession | null, matched: string | null): string | null {
  if (matched) return `new:${matched}`;
  if (focused) return `session:${focused.id}`;
  return options[0]?.value ?? null;
}

/**
 * The choice the right-click panel starts on. Send: the session on screen in Seshboard, else New session in the page's
 * project. Start session: New session in the page's project. Null when neither is there: the panel waits for a pick.
 */
export function menuDefault(action: 'send' | 'start', options: readonly TargetOption[], focused: CompanionSession | null, matched: string | null): string | null {
  const has = (value: string) => options.some((o) => o.value === value);
  if (action === 'send' && focused && has(`session:${focused.id}`)) return `session:${focused.id}`;
  if (matched && has(`new:${matched}`)) return `new:${matched}`;
  return null;
}

/** The sessions waiting on you, for the badge and the top of the popup. */
export const waitingSessions = (sessions: readonly CompanionSession[]) => sessions.filter((s) => s.status === 'needs-you');

/** The badge's text: how many sessions wait on you, or nothing. */
export const badgeText = (sessions: readonly CompanionSession[]) => {
  const count = waitingSessions(sessions).length;
  return count === 0 ? '' : count > 9 ? '9+' : String(count);
};

/** What the popup asks a local page's content script for: the errors it recorded. */
export const CONSOLE_MESSAGE = 'seshboard-console';

/** One thing that went wrong in a local page (content/console-main.ts). */
export interface ConsoleEntry {
  kind: 'error' | 'exception' | 'rejection' | 'network';
  message: string;
  at: number;
}

/** The chip for a page's console errors, the most recent last. Null without any. */
export function consoleItem(entries: readonly ConsoleEntry[], page: Pick<PageInfo, 'url'>): CompanionContextItemInput | null {
  if (entries.length === 0) return null;
  const where = hostOf(page.url);
  const time = (at: number) => new Date(at).toISOString().slice(11, 19);
  const text = [`Errors in the console of ${page.url}:`, '', ...entries.map((e) => `[${time(e.at)}] ${e.kind}: ${e.message}`)].join('\n');
  return { kind: 'text', source: 'console', label: `Console errors on ${where} (${entries.length})`, text: text.slice(0, MAX_SELECTION), language: 'text' };
}

/** The screenshot as Attach images takes it: a JPEG data URL from captureVisibleTab, without its prefix. */
export function screenshotImage(dataUrl: string, page: Pick<PageInfo, 'url'>): { type: 'image'; mediaType: 'image/jpeg' | 'image/png'; data: string; name: string } | null {
  const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mediaType = match[1] as 'image/jpeg' | 'image/png';
  return { type: 'image', mediaType, data: match[2]!, name: `${hostOf(page.url).replace(/[^\w.-]+/g, '-')}.${mediaType === 'image/png' ? 'png' : 'jpg'}` };
}
