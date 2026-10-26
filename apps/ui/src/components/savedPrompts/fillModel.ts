import {
  BLANK_TYPE_WORDS,
  blankSource,
  blanksOf,
  blanksSummary,
  escapeText,
  fill,
  missing,
  parse,
  type BlankSpec,
  type PromptBlank,
  type PromptScope,
  type SavedPrompt,
} from '@seshboard/protocol/client';
import { fuzzyScore } from '../../lib/fuzzy.ts';

/**
 * A prompt as the box edits it: runs of text with a blank between each two, so there is always text to type in
 * before, between and after the blanks (`texts.length === blanks.length + 1`, runs may be empty).
 */
export interface Segments {
  texts: string[];
  blanks: PromptBlank[];
}

export function toSegments(text: string): Segments {
  const texts: string[] = [''];
  const blanks: PromptBlank[] = [];
  for (const part of parse(text)) {
    if (part.kind === 'text') texts[texts.length - 1] += part.text;
    else {
      blanks.push(part);
      texts.push('');
    }
  }
  return { texts, blanks };
}

/** The prompt's text again: typed text escaped, blanks as written. */
export function fromSegments({ texts, blanks }: Segments): string {
  return texts.map((text, i) => `${escapeText(text)}${blanks[i]?.raw ?? ''}`).join('');
}

/** A blank put in at `offset` of text run `segment` (the run splits around it). */
export function insertBlank({ texts, blanks }: Segments, segment: number, offset: number, spec: BlankSpec): Segments {
  const run = texts[segment] ?? '';
  const blank: PromptBlank = { kind: 'blank', ...spec, raw: blankSource(spec) };
  return {
    texts: [...texts.slice(0, segment), run.slice(0, offset), run.slice(offset), ...texts.slice(segment + 1)],
    blanks: [...blanks.slice(0, segment), blank, ...blanks.slice(segment)],
  };
}

/** The blank at `index` taken out; the text on both sides joins up. */
export function removeBlank({ texts, blanks }: Segments, index: number): Segments {
  return {
    texts: [...texts.slice(0, index), `${texts[index] ?? ''}${texts[index + 1] ?? ''}`, ...texts.slice(index + 2)],
    blanks: blanks.filter((_, i) => i !== index),
  };
}

/** The blank at `index` with a new definition. */
export function replaceBlank(segments: Segments, index: number, spec: BlankSpec): Segments {
  return { ...segments, blanks: segments.blanks.map((blank, i) => (i === index ? { kind: 'blank', ...spec, raw: blankSource(spec) } : blank)) };
}

/** A saved prompt being filled in, in a message box: kept with the draft. */
export interface FillState {
  prompt: { id: string; name: string; scope: PromptScope };
  /** The prompt's text as written, edited around the blanks. */
  text: string;
  /** What each blank (by name) is filled with: what is sent. */
  values: Record<string, string>;
  /** What a filled blank shows when that isn't the value itself ("#132 Support Claude Code Mods" for an issue's link). */
  displays: Record<string, string>;
}

export const startFill = (prompt: Pick<SavedPrompt, 'id' | 'name' | 'scope' | 'text'>): FillState => ({
  prompt: { id: prompt.id, name: prompt.name, scope: prompt.scope },
  text: prompt.text,
  values: {},
  displays: {},
});

/** A prompt being filled with the blank at `index` taken out; what it held goes too, unless the same blank is used again. */
export function withoutBlank(state: FillState, index: number): FillState {
  const before = toSegments(state.text);
  const name = before.blanks[index]?.name;
  const segments = removeBlank(before, index);
  if (name === undefined || segments.blanks.some((blank) => blank.name === name)) return { ...state, text: fromSegments(segments) };
  const { [name]: _value, ...values } = state.values;
  const { [name]: _display, ...displays } = state.displays;
  return { ...state, text: fromSegments(segments), values, displays };
}

/** The message a filled prompt sends: the prompt, then what was added after it with a blank line between. */
export function fillMessage(state: Pick<FillState, 'text' | 'values'>, extra: string): string {
  const prompt = fill(state.text, state.values);
  const more = extra.trim();
  return more ? (prompt ? `${prompt}\n\n${more}` : more) : prompt;
}

/** The required blanks that are still empty. */
export const blanksLeft = (state: Pick<FillState, 'text' | 'values'>) => missing(state.text, state.values);

/** What a chip says to a screen reader: "Pull request, required, empty", "Branch: feat/claude-code-mods". */
export function blankAria(blank: Pick<PromptBlank, 'name' | 'type' | 'optional'>, value: string, display?: string): string {
  const words = chipLabel(blank);
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  if (value.trim()) return `${label}: ${display || value}`;
  return `${label}, ${blank.optional ? 'optional' : 'required'}, empty`;
}

/** The chip's label, in lowercase: the type's word for a blank named after its type (`{{pr:pr}}` is "pull request"), else its name ("test file"). */
export function chipLabel(blank: Pick<PromptBlank, 'name' | 'type'>): string {
  return isTypeName(blank) ? BLANK_TYPE_WORDS[blank.type] : blank.name.replace(/[_-]+/g, ' ').trim();
}

const isTypeName = (blank: Pick<PromptBlank, 'name' | 'type'>) => blank.type !== 'text' && blank.type !== 'choice' && blank.name.toLowerCase().replace(/[^a-z]/g, '') === blank.type;

/** "2 blanks · pull request, branch · used 11×": a prompt's line in Settings. */
export function promptMeta(prompt: Pick<SavedPrompt, 'text' | 'uses'>): string {
  return [blanksSummary(prompt.text), prompt.uses > 0 ? `used ${prompt.uses}×` : null].filter(Boolean).join(' · ');
}

/** "2 blanks · issue, choice" while writing a prompt (nothing for none). */
export function editorPreview(text: string): string {
  return blanksOf(text).length ? blanksSummary(text) : 'No blanks yet';
}

/** A string that tells two places apart. */
export const scopeKey = (scope: PromptScope) => (scope.kind === 'global' ? 'global' : `${scope.kind}\u0000${scope.root}`);
export const sameScope = (a: PromptScope, b: PromptScope) => scopeKey(a) === scopeKey(b);

/**
 * How well a `/` query matches a name (and a description from three letters on): the start of the name first, then
 * anywhere in it, then its letters in order, then the description. Null when it doesn't match. Commands and saved
 * prompts use the same rule.
 */
export function slashScore(query: string, name: string, description = ''): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 300 - n.length * 0.01;
  if (n.includes(q)) return 200 - n.indexOf(q);
  const fuzzy = fuzzyScore(q, n);
  if (fuzzy !== null) return 100 + Math.min(fuzzy, 90);
  if (q.length > 2 && description.toLowerCase().includes(q)) return 10;
  return null;
}
