/**
 * Session linking: the brief about another session that goes with a message (docs/session-linking.md). The message box
 * writes a stub (the label line and a fence with only `session:`), and the engine fills in the rest right before Claude
 * reads it. Plain TypeScript, no zod: the renderer, the engine and the remote app all parse briefs with it.
 */

/** The fence's info string: a code block with any other one is never a brief. */
export const SESSION_FENCE = 'switchboard-session';
/** At most this many linked sessions in one message. */
export const MAX_LINKS_PER_MESSAGE = 5;
/** The most characters one brief takes, and all briefs of one message together. */
export const BRIEF_BUDGET = 4_000;
export const BRIEFS_BUDGET = 12_000;
/** The longest label: a session's title is cut to this, on a word. */
export const LINK_LABEL_MAX = 60;

const LABEL_PREFIX = 'Linked session: ';

/** The `key: value` lines of a brief, in the order they're written. */
export const BRIEF_FIELDS = ['project', 'folder', 'branch', 'pull request', 'state', 'asked'] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
/** The fields a brief never drops to fit its budget. */
const KEPT: readonly BriefField[] = ['project', 'folder', 'branch', 'pull request', 'state'];

export interface Brief {
  /** The words in the text and on the chip: the session's title, cut and made unique in the message. */
  label: string;
  sessionId: string;
  /** Only `session:`, as the message box writes it; the engine fills in the rest. */
  stub: boolean;
  fields: Partial<Record<BriefField, string>>;
  /** The branch's own commits, newest first (`<short sha> <subject>`). */
  commits: string[];
  did: string[];
  skipped: string[];
  next: string | null;
  lastReply: string | null;
  /** What was left out to fit the budget ("last reply left out"); null when nothing was. */
  shortened: string | null;
}

/** A brief with only its session: what the message box writes. */
export const stubBrief = (label: string, sessionId: string): Brief => ({ label, sessionId, stub: true, fields: {}, commits: [], did: [], skipped: [], next: null, lastReply: null, shortened: null });

/** A code fence longer than any run of backticks in the text, so the text can't close it early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** A session's title as a label: one line, cut to `LINK_LABEL_MAX` on a word. */
export function linkLabel(title: string): string {
  const line = oneLine(title) || 'Untitled session';
  if (line.length <= LINK_LABEL_MAX) return line;
  const cut = line.slice(0, LINK_LABEL_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > LINK_LABEL_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '');
}

/** `label`, or `label (2)` and on when a label in `taken` already says it. */
export function uniqueLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(label)) return label;
  let n = 2;
  while (used.has(`${label} (${n})`)) n++;
  return `${label} (${n})`;
}

function body(brief: Brief): string {
  const lines = [`session: ${brief.sessionId}`];
  if (brief.stub) return lines.join('\n');
  for (const key of BRIEF_FIELDS) {
    const value = brief.fields[key];
    if (value) lines.push(`${key}: ${oneLine(value)}`);
  }
  const list = (key: string, items: readonly string[]) => items.length && lines.push(`${key}:`, ...items.map((item) => `- ${oneLine(item)}`));
  list('commits', brief.commits);
  list('did', brief.did);
  list('skipped', brief.skipped);
  if (brief.next) lines.push(`next: ${oneLine(brief.next)}`);
  if (brief.shortened) lines.push(`shortened: ${brief.shortened}`);
  // Last, since it runs to the end of the block and may have lines of its own.
  if (brief.lastReply) lines.push('last reply:', brief.lastReply.replace(/\n+$/, ''));
  return lines.join('\n');
}

/** A brief as it goes in the message: the label line, then the fenced block. */
function render(brief: Brief): string {
  const inner = body(brief);
  const fence = fenceFor(inner);
  return `${LABEL_PREFIX}${oneLine(brief.label)}\n${fence}${SESSION_FENCE}\n${inner}\n${fence}`;
}

const cutTo = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * A brief as text, cut to `budget` characters by dropping, in order: the last reply (to 1,500 characters, then 600,
 * then all of it), `skipped`, `did` past its first 2 lines, `asked` past 120 characters, commits past the first 5.
 * The session and where it works are never dropped.
 */
export function writeBrief(brief: Brief, budget = BRIEF_BUDGET): string {
  let current: Brief = { ...brief, shortened: null };
  const dropped: string[] = [];
  const steps: Array<(b: Brief) => Brief | null> = [
    (b) => (b.lastReply && b.lastReply.length > 1_500 ? { ...b, lastReply: cutTo(b.lastReply, 1_500) } : null),
    (b) => (b.lastReply && b.lastReply.length > 600 ? { ...b, lastReply: cutTo(b.lastReply, 600) } : null),
    (b) => (b.lastReply ? (dropped.push('last reply left out'), { ...b, lastReply: null }) : null),
    (b) => (b.skipped.length ? (dropped.push('skipped left out'), { ...b, skipped: [] }) : null),
    (b) => (b.did.length > 2 ? (dropped.push('did cut'), { ...b, did: b.did.slice(0, 2) }) : null),
    (b) => (b.fields.asked && b.fields.asked.length > 120 ? { ...b, fields: { ...b.fields, asked: cutTo(b.fields.asked, 120) } } : null),
    (b) => (b.commits.length > 5 ? (dropped.push('commits cut'), { ...b, commits: b.commits.slice(0, 5) }) : null),
    // Whatever else is left, past what is always kept.
    (b) => {
      const fields = Object.fromEntries(Object.entries(b.fields).filter(([key]) => KEPT.includes(key as BriefField)));
      return Object.keys(fields).length < Object.keys(b.fields).length || b.did.length || b.next ? { ...b, fields, did: [], next: null } : null;
    },
  ];
  const text = (b: Brief) => render({ ...b, shortened: dropped.length ? dropped.join(', ') : null });
  for (const step of steps) {
    if (text(current).length <= budget) break;
    current = step(current) ?? current;
  }
  return text(current);
}

/** Briefs for one message, fitting `BRIEFS_BUDGET` together: each gets an equal share of it, at most `BRIEF_BUDGET`. */
export function writeBriefs(briefs: readonly Brief[]): string[] {
  const share = Math.min(BRIEF_BUDGET, Math.floor(BRIEFS_BUDGET / Math.max(1, briefs.length)));
  return briefs.map((brief) => writeBrief(brief, share));
}

/** The stub the message box writes for a linked session. */
export const writeStub = (label: string, sessionId: string): string => render(stubBrief(label, sessionId));

const FENCE_OPEN = /^(`{3,})(.*)$/;

interface Block {
  /** Where the label line starts (or the fence, without one), and where the block ends, in the text. */
  start: number;
  end: number;
  label: string | null;
  info: string;
  inner: string;
  /** Where the info string starts, in the text (for `defuseStubs`). */
  infoAt: number;
}

/** The top-level fenced blocks of a text: a fence inside another one (a text chip's own block) is skipped. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]!);
    if (!open) continue;
    const fence = open[1]!;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === fence) {
        close = j;
        break;
      }
    }
    if (close < 0) break;
    const prev = i > 0 ? lines[i - 1]! : '';
    const label = prev.startsWith(LABEL_PREFIX) ? prev.slice(LABEL_PREFIX.length).trim() : null;
    out.push({
      start: label !== null ? starts[i - 1]! : starts[i]!,
      end: starts[close]! + lines[close]!.length,
      label,
      info: open[2]!.trim(),
      inner: lines.slice(i + 1, close).join('\n'),
      infoAt: starts[i]! + lines[i]!.indexOf(open[2]!.trim(), fence.length),
    });
    i = close;
  }
  return out;
}

const LIST_KEYS = new Set(['commits', 'did', 'skipped']);

/** A brief's block read back; null when it names no session. */
function readBrief(label: string | null, inner: string): Brief | null {
  const lines = inner.split('\n');
  const brief: Brief = stubBrief(label ?? '', '');
  let list: string[] | null = null;
  let filled = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === 'last reply:') {
      brief.lastReply = lines.slice(i + 1).join('\n');
      filled = true;
      break;
    }
    if (list && line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    list = null;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'session') brief.sessionId = value;
    else if (LIST_KEYS.has(key)) {
      list = brief[key as 'commits' | 'did' | 'skipped'];
      filled = true;
    } else if (key === 'next') {
      brief.next = value;
      filled = true;
    } else if (key === 'shortened') brief.shortened = value;
    else if ((BRIEF_FIELDS as readonly string[]).includes(key)) {
      brief.fields[key as BriefField] = value;
      filled = true;
    }
  }
  if (!brief.sessionId) return null;
  brief.stub = !filled;
  if (!brief.label) brief.label = brief.sessionId.slice(0, 8);
  return brief;
}

/**
 * The briefs in a message (stubs or filled in), and the text without them, as you typed it. Only top-level blocks
 * fenced `switchboard-session` count; code blocks and fences inside other blocks are left alone.
 */
export function parseBriefs(text: string): { text: string; briefs: Brief[] } {
  const found = blocks(text).filter((b) => b.info === SESSION_FENCE);
  if (!found.length) return { text, briefs: [] };
  const briefs: Brief[] = [];
  let rest = '';
  let from = 0;
  for (const block of found) {
    const brief = readBrief(block.label, block.inner);
    if (!brief) continue;
    briefs.push(brief);
    rest += text.slice(from, block.start);
    from = block.end;
  }
  rest += text.slice(from);
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), briefs };
}

/**
 * What you typed, without the briefs: for a session's first prompt, search and the catch-up's ask. Also takes off a
 * brief that was cut short (a first prompt as Claude Code keeps it may end in the middle of one).
 */
export function withoutBriefs(text: string): string {
  const typed = parseBriefs(text).text;
  const partial = new RegExp(`(^|\\n)${LABEL_PREFIX}[^\\n]*\\n\`{3,}${SESSION_FENCE}[\\s\\S]*$`).exec(typed);
  return partial ? typed.slice(0, partial.index).trim() : typed;
}

/**
 * Puts `replace(brief, block)` in place of each brief's block (the label line and the fence, as `block`), keeping the
 * rest as it is.
 */
export function replaceBriefs(text: string, replace: (brief: Brief, block: string) => string): string {
  const found = blocks(text).filter((b) => b.info === SESSION_FENCE);
  if (!found.length) return text;
  let out = '';
  let from = 0;
  for (const block of found) {
    const brief = readBrief(block.label, block.inner);
    if (!brief) continue;
    out += text.slice(from, block.start) + replace(brief, text.slice(block.start, block.end));
    from = block.end;
  }
  return out + text.slice(from);
}

/**
 * Turns every brief's fence into a plain `text` code block, so it reads the same and never expands: for text from
 * places that may not link sessions (a paired phone), which could otherwise name a session hidden from them.
 */
export function defuseStubs(text: string): string {
  const found = blocks(text).filter((b) => b.info === SESSION_FENCE);
  let out = text;
  // From the end, so earlier positions stay right.
  for (const block of found.reverse()) out = `${out.slice(0, block.infoAt)}text${out.slice(block.infoAt + SESSION_FENCE.length)}`;
  return out;
}
