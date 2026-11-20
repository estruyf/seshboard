/**
 * Skim's marks: Claude ends a long reply with one hidden line that quotes the start of its key sentences,
 * `<!-- keep: "first words" | "other words" -->`. Plain helpers, without zod, for the app, the engine and the phone:
 * every place that shows a reply takes the line off first.
 */

/** The instruction Seshboard appends to the agent's system prompt (Settings › Conversation). */
export const SKIM_MARKS_PROMPT = `When your turn ends with a reply of 8 or more sentences, end that reply with one hidden line: <!-- keep: "first words of a sentence" | "first words of another" -->. Quote the first words, exactly, of about a third of its sentences: the ones the user most needs, such as decisions, results, open problems and questions. Seshboard hides the line and fades the other sentences.`;

/** The line at the very end of a reply, with whatever space came before it. */
const MARKS = /\s*<!--\s*keep:([\s\S]*?)-->\s*$/;
/** What it quotes: straight or curly double quotes. */
const QUOTE = /"([^"\n]+)"|“([^”\n]+)”/g;
/** A keep line still being written: its start, on the last line. */
const OPENING = '<!-- keep:';

export interface SkimMarks {
  /** The reply without the line. */
  text: string;
  /** The starts of the sentences to keep; null when the reply has no line. */
  quotes: string[] | null;
}

/** Takes the keep line off a finished reply, and says what it quoted. */
export function skimMarks(text: string): SkimMarks {
  const match = MARKS.exec(text);
  if (!match) return { text, quotes: null };
  const quotes = [...match[1]!.matchAll(QUOTE)].map((m) => (m[1] ?? m[2] ?? '').trim()).filter(Boolean);
  return { text: text.slice(0, match.index), quotes };
}

/** A reply as it streams in: a keep line, finished or not, never shows. */
export function withoutSkimMarks(text: string): string {
  const finished = skimMarks(text);
  if (finished.quotes) return finished.text;
  const start = text.lastIndexOf('\n') + 1;
  const last = text.slice(start).trimStart();
  // `<!-- ke` is the line on its way; anything else that starts with `<` is the reply's own.
  const opening = last.length > 0 && (last.startsWith(OPENING) || OPENING.startsWith(last.replace(/\s+/g, ' ')));
  return opening && last.startsWith('<') ? text.slice(0, start).trimEnd() : text;
}
