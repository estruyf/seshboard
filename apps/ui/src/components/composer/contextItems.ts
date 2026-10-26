import { isAbsolutePath, joinPath, MAX_CONTEXT_ITEMS, MAX_PROMPT_LENGTH, parseBriefs, parseGithubBlocks, pathInside, separatorOf, writeGithubStub, writeStub, type ContextItem } from '@seshboard/protocol/client';
import { basename } from '../../lib/format.ts';

/** A chip in the context tray: an item to send with the message, and an id to remove it by. */
export type ContextChip = ContextItem & { id: string };

let nextId = 0;
/** Ids only need to be unique while the app runs (chips are saved with drafts, and get new ids when read back). */
const newId = () => `ctx-${Date.now().toString(36)}-${(nextId++).toString(36)}`;

/** The same file and lines, or the same text from the same place: added twice, it shows once. */
export function sameItem(a: ContextItem, b: ContextItem): boolean {
  if (a.kind === 'file' && b.kind === 'file') return a.path === b.path && a.range?.start === b.range?.start && a.range?.end === b.range?.end;
  if (a.kind === 'text' && b.kind === 'text') return a.source === b.source && a.text === b.text && a.path === b.path;
  if (a.kind === 'session' && b.kind === 'session') return a.sessionId === b.sessionId;
  if (a.kind === 'github' && b.kind === 'github') return a.type === b.type && a.number === b.number && a.repo.toLowerCase() === b.repo.toLowerCase();
  return false;
}

/** Adds items after the chips already there, leaving out ones that are there already, up to the limit. */
export function addChips(current: readonly ContextChip[], items: readonly ContextItem[]): ContextChip[] {
  const next = [...current];
  for (const item of items) {
    if (next.length >= MAX_CONTEXT_ITEMS) break;
    if (next.some((chip) => sameItem(chip, item))) continue;
    next.push({ ...item, id: newId() } as ContextChip);
  }
  return next;
}

/**
 * `path` relative to `cwd` when it is inside it, otherwise as it is. Written with `/` on Windows too, as the `@`
 * file picker (from git) writes them.
 */
export function relativeTo(path: string, cwd: string | null): string {
  const inside = cwd ? pathInside(path, cwd) : null;
  if (!inside) return path;
  return separatorOf(cwd!) === '\\' ? inside.replace(/\\/g, '/') : inside;
}

/** A folder's path with one separator at the end, the one it is written with. */
export const asFolder = (path: string) => `${path.replace(/[\\/]+$/, '')}${separatorOf(path) === '\\' && !path.includes('/') ? '\\' : '/'}`;
const lines = (range: { start: number; end: number }) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`);

/** What a chip shows (`auth.ts:12-40`, `src/`), and its tooltip (the path, relative to the session's folder). */
export function chipLabel(item: ContextItem, cwd: string | null): { label: string; detail: string } {
  if (item.kind === 'session') return { label: item.label, detail: LINKED_SESSION_HINT };
  if (item.kind === 'github') return { label: `#${item.number} ${item.title}`, detail: GITHUB_CHIP_HINT };
  if (item.kind === 'file') {
    const where = relativeTo(item.path, cwd);
    if (item.directory) return { label: `${basename(item.path)}/`, detail: asFolder(where) };
    const range = item.range ? `:${lines(item.range)}` : '';
    return { label: `${basename(item.path)}${range}`, detail: item.range ? `${where}, lines ${lines(item.range)}` : where };
  }
  if (item.source === 'paste') return { label: item.label, detail: pasteSize(item.text) };
  const where = item.path ? relativeTo(item.path, cwd) + (item.range ? `, lines ${lines(item.range)}` : '') : null;
  const size = item.text.split('\n').length;
  return { label: item.label, detail: [where, size === 1 ? '1 line of text' : `${size} lines of text`].filter(Boolean).join(' · ') };
}

/** A linked session's chip, said as its tooltip. */
export const LINKED_SESSION_HINT = "Claude gets this session's branch, pull request, what it did and its last reply.";
/** An attached issue's or pull request's chip, said as its tooltip. */
export const GITHUB_CHIP_HINT = 'Claude gets the title, link, labels and text. For a pull request, also its branch and unresolved review comments.';

const lineCount = (text: string) => text.replace(/\n+$/, '').split('\n').length;

/** A paste longer than this many characters, or lines, becomes a Pasted text card rather than text in the box. */
export const PASTE_CARD_CHARS = 2_000;
export const PASTE_CARD_LINES = 25;

/** Whether pasted text is long enough to go in a card: a few lines stay in the message, where you can see them. */
export const isLongPaste = (text: string) => text.length > PASTE_CARD_CHARS || lineCount(text) > PASTE_CARD_LINES;

/** "120 lines · 45,210 characters": how much a pasted text holds. */
export function pasteSize(text: string): string {
  const count = lineCount(text);
  return `${count === 1 ? '1 line' : `${count.toLocaleString('en-US')} lines`} · ${characters(text.length)}`;
}

const characters = (n: number) => (n === 1 ? '1 character' : `${n.toLocaleString('en-US')} characters`);

/** The start of a pasted text for its card: the first lines, cut short so a long one-line blob doesn't cost a layout. */
export const pastePreview = (text: string) => text.trimStart().slice(0, 400);

/** A long paste as context: "Pasted text", then "Pasted text 2" and on while others are in the box. */
export function pastedItem(text: string, chips: readonly ContextItem[]): Extract<ContextItem, { kind: 'text' }> {
  const taken = new Set(chips.filter((c) => c.kind === 'text' && c.source === 'paste').map((c) => (c as { label: string }).label));
  let n = 1;
  while (taken.has(n === 1 ? 'Pasted text' : `Pasted text ${n}`)) n++;
  return { kind: 'text', source: 'paste', label: n === 1 ? 'Pasted text' : `Pasted text ${n}`, text };
}

/** Why a message can't be sent as it is (null when it can): over the length a message can hold. */
export function tooLongReason(prompt: string): string | null {
  if (prompt.length <= MAX_PROMPT_LENGTH) return null;
  return `Too long to send: ${characters(prompt.length)}, and a message holds up to ${MAX_PROMPT_LENGTH.toLocaleString('en-US')}. Shorten it or remove a pasted text.`;
}

/** Why a paste can't be added (null when it can): longer than a whole message can be. */
export function pasteTooLongReason(text: string): string | null {
  if (text.length <= MAX_PROMPT_LENGTH) return null;
  return `Not pasted: ${characters(text.length)} is more than a message holds (${MAX_PROMPT_LENGTH.toLocaleString('en-US')}). Drop the file on the message box instead, and Claude reads what it needs.`;
}

/**
 * The `@` mention for a file or folder, as Claude Code reads it: relative to the session's folder when inside it,
 * folders ending in `/`, a range of lines as `#L12-40`, and quoted when the path has spaces.
 */
export function mentionFor(item: Extract<ContextItem, { kind: 'file' }>, cwd: string | null): string {
  let target = relativeTo(item.path, cwd);
  if (item.directory) target = asFolder(target);
  if (!item.directory && item.range) target += `#L${lines(item.range)}`;
  return /\s/.test(target) ? `@"${target}"` : `@${target}`;
}

/** A code fence longer than any run of backticks in the text, so the text can't close it early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The message Claude gets: what you typed, then the files as `@` mentions on one line (Claude reads them itself), then
 * each piece of text in a fenced block under its label, then a stub for each linked session, which the engine turns
 * into a brief about it when the message goes to Claude (docs/session-linking.md), then a stub for each attached issue
 * or pull request, which the engine turns into its title, link, labels and text.
 */
export function promptWithContext(text: string, chips: readonly ContextItem[], cwd: string | null): string {
  const files = chips.filter((c): c is Extract<ContextItem, { kind: 'file' }> => c.kind === 'file');
  const texts = chips.filter((c): c is Extract<ContextItem, { kind: 'text' }> => c.kind === 'text');
  const sessions = chips.filter((c): c is Extract<ContextItem, { kind: 'session' }> => c.kind === 'session');
  const parts = [text.trim()];
  if (files.length) parts.push(files.map((f) => mentionFor(f, cwd)).join(' '));
  for (const item of texts) {
    const fence = fenceFor(item.text);
    parts.push(`${item.label}:\n${fence}${item.language ?? ''}\n${item.text.replace(/\n+$/, '')}\n${fence}`);
  }
  for (const item of sessions) parts.push(writeStub(item.label, item.sessionId));
  for (const item of chips) if (item.kind === 'github') parts.push(writeGithubStub(item));
  return parts.filter(Boolean).join('\n\n');
}

const MENTION = String.raw`@(?:"[^"\n]+"|[^\s"]\S*)`;
/** The line of mentions, either last or right before the first text block, as `promptWithContext` writes it. */
const MENTION_LINE = new RegExp(String.raw`(^|\n\n)(${MENTION}(?: ${MENTION})*)(?=\n\n[^\n]*:\n\x60{3,}|$)`, 'g');

function fileFromMention(mention: string, cwd: string | null): Extract<ContextItem, { kind: 'file' }> | null {
  let target = mention.slice(1).replace(/^"(.*)"$/, '$1');
  let range: { start: number; end: number } | undefined;
  const hash = /#L(\d+)(?:-(\d+))?$/.exec(target);
  if (hash) {
    range = { start: Number(hash[1]), end: Number(hash[2] ?? hash[1]) };
    target = target.slice(0, hash.index);
  }
  const directory = /[\\/]$/.test(target);
  if (directory) target = target.replace(/[\\/]+$/, '');
  if (!target) return null;
  const path = isAbsolutePath(target) ? target : cwd ? joinPath(cwd, target) : null;
  if (!path) return null;
  return range && !directory ? { kind: 'file', path, directory, range } : { kind: 'file', path, directory };
}

/**
 * The other way round from `promptWithContext`, for a message taken back to the box: its line of file mentions as
 * chips again, and the text without it. A prompt without one comes back as it is.
 */
export function contextFromPrompt(sent: string, cwd: string | null): { text: string; context: ContextItem[] } {
  // Attached issues and linked sessions come back as chips, whether they were expanded yet or not; a session's label
  // stays in the text.
  const { text: withoutIssues, blocks } = parseGithubBlocks(sent);
  const { text: prompt, briefs } = parseBriefs(withoutIssues);
  const github: ContextItem[] = blocks.map((b) => ({ kind: 'github', type: b.type, repo: b.repo, number: b.number, title: b.title, url: b.url }));
  const linked: ContextItem[] = [...briefs.map((brief): ContextItem => ({ kind: 'session', sessionId: brief.sessionId, label: brief.label })), ...github];
  const match = [...prompt.matchAll(MENTION_LINE)].at(-1);
  if (!match) return { text: prompt, context: linked };
  const files = (match[2]!.match(new RegExp(MENTION, 'g')) ?? []).map((m) => fileFromMention(m, cwd));
  if (files.some((f) => !f)) return { text: prompt, context: linked };
  const before = prompt.slice(0, match.index);
  const after = prompt.slice(match.index + match[0].length).replace(/^\n\n/, '');
  return { text: [before, after].filter(Boolean).join('\n\n'), context: [...(files as ContextItem[]), ...linked] };
}

/** Dropped files and folders, as context. */
export const droppedItems = (dropped: ReadonlyArray<{ path: string; directory: boolean }>): ContextItem[] =>
  dropped.filter((f) => isAbsolutePath(f.path)).map((f) => ({ kind: 'file', path: f.path, directory: f.directory }));

/** A short summary of chips for a list (the Unsent list, a sidebar row): "2 files", "1 file and 1 text". */
export function chipsSummary(chips: readonly ContextItem[]): string {
  const files = chips.filter((c) => c.kind === 'file').length;
  const sessions = chips.filter((c) => c.kind === 'session').length;
  const issues = chips.filter((c) => c.kind === 'github' && c.type === 'issue').length;
  const prs = chips.filter((c) => c.kind === 'github' && c.type === 'pr').length;
  const texts = chips.length - files - sessions - issues - prs;
  const say = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  const parts = [
    files && say(files, 'file', 'files'),
    texts && say(texts, 'text', 'texts'),
    sessions && say(sessions, 'linked session', 'linked sessions'),
    issues && say(issues, 'issue', 'issues'),
    prs && say(prs, 'pull request', 'pull requests'),
  ].filter(Boolean) as string[];
  return parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join(' and ');
}
