import { isAbsolutePath, type ContextItem } from '@switchboard/protocol/client';
import type { Choices } from '../components/newSession/choices.ts';
import { addChips, chipsSummary, type ContextChip } from '../components/composer/contextItems.ts';
import { spokenAge } from '../components/sidebar/rowLabel.ts';

/** How long a draft has to stay put before it counts as unsent, so a stray keystroke doesn't mark a session. */
export const DRAFT_SETTLE_MS = 2_000;
/** The longest preview of a draft (sidebar rows, the Unsent list, ⌘P). */
export const DRAFT_PREVIEW_MAX = 60;

const NEW_PREFIX = 'new:';

/** The key of a New session prompt: one per project, `new:` alone before a folder is picked. */
export const newDraftKey = (root: string | null) => `${NEW_PREFIX}${root ?? ''}`;
export const isNewDraftKey = (key: string) => key.startsWith(NEW_PREFIX);
/** The project folder of a New session key (null without one), or null for a session's key. */
export const draftRoot = (key: string): string | null => (isNewDraftKey(key) ? key.slice(NEW_PREFIX.length) || null : null);

/** What New session had chosen for its prompt: going back to it brings them back too. */
export interface DraftForm {
  choices: Choices;
  /** A profile picked for this session only (null: the project's, else the default). */
  profileId: string | null;
}

/** What was typed (and attached) in a message box and not sent yet. */
export interface Draft<A = unknown> {
  text: string;
  /** Images: kept while the app runs, never saved. */
  attachments: A[];
  /** When it last changed. */
  updatedAt: number;
  /** It has stayed put for a moment, so it shows as unsent (the pen, the Unsent list); it stays so until emptied. */
  counted: boolean;
  /** Images that were attached before a restart and weren't kept. */
  lostImages: number;
  /** Put in the box for you (Edit and resend) rather than left there: no "kept for you" line. */
  seeded?: boolean;
  /** New session: its choices. */
  form?: DraftForm;
  /** Files, lines and text added as context (the chips above the text), sent with it. */
  context?: ContextChip[];
}

/** There is something to send: text, or images or context without text. */
export const hasContent = (draft: { text: string; attachments: readonly unknown[]; context?: readonly unknown[] }) =>
  draft.text.trim() !== '' || draft.attachments.length > 0 || (draft.context?.length ?? 0) > 0;

/** Whether a draft shows as unsent: something to send, which counted already or hasn't changed for `DRAFT_SETTLE_MS`. */
export function isCountingDraft(draft: Pick<Draft, 'text' | 'attachments' | 'updatedAt' | 'counted'>, now: number): boolean {
  return hasContent(draft) && (draft.counted || now - draft.updatedAt >= DRAFT_SETTLE_MS);
}

/** The start of a draft for a list: its first line, whitespace collapsed, cut at `max` with an ellipsis. */
export function draftPreview(text: string, max = DRAFT_PREVIEW_MAX): string {
  const line = (text.trim().split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const sameAttachments = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * The draft after the message box changed: null when it's empty (forgotten), the same object when nothing
 * changed (a box mounting with its draft writes it back), else the new text with a fresh time. Emptying the
 * box ends counting; editing a draft that counted keeps it counted, so its pen doesn't blink while you type.
 */
export function nextDraft<A>(previous: Draft<A> | undefined, next: { text: string; attachments: A[]; context?: ContextChip[] }, now: number): Draft<A> | null {
  // The message box only says what is typed and attached; the chips change on their own (added from the editor).
  const context = next.context ?? previous?.context;
  if (!hasContent({ ...next, context })) return null;
  if (previous && previous.text === next.text && sameAttachments(previous.attachments, next.attachments) && sameAttachments(previous.context ?? [], context ?? [])) return previous;
  return {
    text: next.text,
    attachments: next.attachments,
    updatedAt: now,
    counted: previous?.counted ?? false,
    // The note about images that weren't kept, and the Edit-and-resend mark, last until it's edited.
    lostImages: 0,
    form: previous?.form,
    ...(context?.length ? { context } : {}),
  };
}

/** A draft in the Unsent list: a session's, or New session's in a project. */
export type DraftItem = { key: string; preview: string; updatedAt: number } & ({ kind: 'session'; sessionId: string } | { kind: 'new'; root: string | null });

/** The drafts that count, newest first: New session ones too. */
export function draftList(drafts: Readonly<Record<string, Draft>>): DraftItem[] {
  return Object.entries(drafts)
    .filter(([, draft]) => draft.counted && hasContent(draft))
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .map(([key, draft]): DraftItem => {
      const base = { key, preview: draftPreview(draft.text) || (draft.attachments.length ? imagesOnly(draft.attachments.length) : chipsSummary(draft.context ?? [])), updatedAt: draft.updatedAt };
      return isNewDraftKey(key) ? { ...base, kind: 'new', root: draftRoot(key) } : { ...base, kind: 'session', sessionId: key };
    });
}

/**
 * What the Unsent list shows of the drafts, as one string: views that list them re-render when it changes, not on
 * every keystroke in a box (ages are shown to the minute).
 */
export function draftListSignature(drafts: Readonly<Record<string, Draft>>): string {
  return draftList(drafts)
    .map((item) => `${item.key}\u0000${item.preview}\u0000${Math.floor(item.updatedAt / 60_000)}`)
    .join('\u0001');
}

const imagesOnly = (count: number) => (count === 1 ? '1 image' : `${count} images`);

/** The sessions among `ids` that have something unsent: archiving them asks first. */
export function sessionsWithDrafts(ids: readonly string[], drafts: Readonly<Record<string, Draft>>): string[] {
  return ids.filter((id) => {
    const draft = drafts[id];
    return !!draft && hasContent(draft);
  });
}

/** How drafts are saved in the app state: the text, when, how many images were left out, and New session's choices. */
interface StoredDraft {
  text: string;
  updatedAt: number;
  images: number;
  form?: DraftForm;
  context?: ContextItem[];
}
export interface StoredDrafts {
  version: 1;
  drafts: Record<string, StoredDraft>;
}

/** What is saved: drafts with text or context (images stay behind; a box with only images has nothing to keep). */
export function serializeDrafts(drafts: Readonly<Record<string, Draft>>): StoredDrafts {
  const out: Record<string, StoredDraft> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    if (draft.text.trim() === '' && !draft.context?.length) continue;
    // Chips get new ids when they are read back.
    const context = draft.context?.map(({ id: _id, ...item }) => item as ContextItem);
    out[key] = {
      text: draft.text,
      updatedAt: draft.updatedAt,
      images: draft.attachments.length + draft.lostImages,
      ...(draft.form ? { form: draft.form } : {}),
      ...(context?.length ? { context } : {}),
    };
  }
  return { version: 1, drafts: out };
}

const isRange = (value: unknown): value is { start: number; end: number } =>
  isRecord(value) && Number.isInteger(value.start) && Number.isInteger(value.end) && (value.start as number) >= 1 && (value.end as number) >= (value.start as number);

/** Saved context that still reads as context items; anything else is left out. */
function parseContext(value: unknown): ContextItem[] {
  if (!Array.isArray(value)) return [];
  const out: ContextItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || (raw.range !== undefined && !isRange(raw.range))) continue;
    const range = raw.range === undefined ? {} : { range: raw.range as { start: number; end: number } };
    if (raw.kind === 'file' && typeof raw.path === 'string' && isAbsolutePath(raw.path)) out.push({ kind: 'file', path: raw.path, directory: raw.directory === true, ...range });
    else if (raw.kind === 'text' && typeof raw.label === 'string' && typeof raw.text === 'string' && (raw.source === 'selection' || raw.source === 'problems' || raw.source === 'terminal' || raw.source === 'output')) {
      out.push({
        kind: 'text',
        source: raw.source,
        label: raw.label,
        text: raw.text,
        ...(typeof raw.path === 'string' && isAbsolutePath(raw.path) ? { path: raw.path } : {}),
        ...(typeof raw.language === 'string' ? { language: raw.language } : {}),
        ...range,
      });
    }
  }
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseForm(value: unknown): DraftForm | undefined {
  if (!isRecord(value) || !isRecord(value.choices)) return undefined;
  const c = value.choices;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const permissionMode = str(c.permissionMode);
  const workspace = c.workspace === 'worktree' || c.workspace === 'current' ? c.workspace : null;
  const baseRef = c.baseRef === 'fresh' || c.baseRef === 'head' ? c.baseRef : null;
  if (permissionMode === null || workspace === null || baseRef === null) return undefined;
  return {
    choices: { model: str(c.model) ?? '', effort: (str(c.effort) ?? '') as Choices['effort'], permissionMode: permissionMode as Choices['permissionMode'], workspace, baseRef, branch: str(c.branch) ?? '' },
    profileId: str(value.profileId),
  };
}

/** Drafts saved earlier, as drafts that count straight away; anything that doesn't read as one is left out. */
export function parseDrafts(value: unknown): Record<string, Draft<never>> {
  const out: Record<string, Draft<never>> = {};
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.drafts)) return out;
  for (const [key, raw] of Object.entries(value.drafts)) {
    if (!key || !isRecord(raw) || typeof raw.text !== 'string' || typeof raw.updatedAt !== 'number') continue;
    const context = addChips([], parseContext(raw.context));
    if (raw.text.trim() === '' && context.length === 0) continue;
    const form = parseForm(raw.form);
    out[key] = {
      text: raw.text,
      attachments: [],
      updatedAt: raw.updatedAt,
      counted: true,
      lostImages: typeof raw.images === 'number' && raw.images > 0 ? Math.floor(raw.images) : 0,
      ...(form ? { form } : {}),
      ...(context.length ? { context } : {}),
    };
  }
  return out;
}

/** The note under a restored draft about its images: "1 image wasn't kept." */
export function lostImagesNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 image wasn't kept." : `${count} images weren't kept.`;
}

/** "12 minutes ago", "yesterday", "Oct 3": when a draft was last changed, for the line above the message box. */
export function draftAge(timestamp: number, now: number): string {
  const spoken = spokenAge(timestamp, now);
  return spoken === 'just now' ? 'a moment ago' : spoken.replace(/^on /, '');
}

/** The line above a session's message box while it holds a kept draft. */
export function sessionDraftBanner(draft: Pick<Draft, 'updatedAt' | 'lostImages'>, now: number): string {
  return [`Unsent message from ${draftAge(draft.updatedAt, now)}, kept for you.`, lostImagesNote(draft.lostImages)].filter(Boolean).join(' ');
}

/** The line above New session's message box while it holds a kept prompt. */
export function newSessionDraftBanner(project: string | null, draft: Pick<Draft, 'updatedAt' | 'lostImages'>, now: number): string {
  const age = draftAge(draft.updatedAt, now);
  return [project ? `Your unsent prompt for ${project}, from ${age}.` : `Your unsent prompt from ${age}.`, lostImagesNote(draft.lostImages)].filter(Boolean).join(' ');
}

/**
 * What the quit prompt says: what quitting stops (`impact`, a sentence), with the unsent messages added to it, and
 * that those are kept.
 */
export function quitSummary(impact: string | null, unsent: number): string[] {
  if (unsent <= 0) return impact ? [impact] : [];
  const messages = unsent === 1 ? '1 unsent message' : `${unsent} unsent messages`;
  const kept = unsent === 1 ? 'It is kept and comes back next time.' : 'Unsent messages are kept and come back next time.';
  return [impact ? `${impact.replace(/\.$/, '')}, and you have ${messages}.` : `You have ${messages}.`, kept];
}
