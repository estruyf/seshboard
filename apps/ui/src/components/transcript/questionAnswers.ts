/** One question Claude asked (AskUserQuestion) and what you answered. */
export interface AnsweredQuestion {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: string[];
  /** The options you picked, in the order you gave them. */
  picked: string[];
  /** What you typed yourself, when it isn't one of the options. */
  other: string | null;
}

interface QuestionInput {
  question: string;
  header?: unknown;
  multiSelect?: unknown;
  options?: unknown;
}

const labelsOf = (options: unknown): string[] =>
  Array.isArray(options) ? options.map((o) => (o as { label?: unknown } | null)?.label).filter((l): l is string => typeof l === 'string' && l !== '') : [];

/**
 * Each question's answer, from the tool's result. Claude Code writes them as `"question"="answer"` pairs joined by
 * `, ` between a sentence before and after (whose wording changes between versions), so an answer runs to the next
 * question's pair, and the last one to the last quote.
 */
export function parseAnswers(text: string, questions: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  let from = 0;
  questions.forEach((question, i) => {
    const marker = `"${question}"="`;
    const at = text.indexOf(marker, from);
    if (at === -1) return;
    const start = at + marker.length;
    const next = questions[i + 1];
    const end = next !== undefined ? text.indexOf(`", "${next}"="`, start) : text.lastIndexOf('"');
    if (end < start) return;
    out.set(question, text.slice(start, end));
    from = end;
  });
  return out;
}

/**
 * Splits an answer into the options it names and the rest. The question card joins your picks and what you typed with
 * `, `, so options are taken from the front, the longest label first (a label can hold a comma itself).
 */
export function splitAnswer(answer: string, options: readonly string[]): { picked: string[]; other: string | null } {
  const labels = [...options].sort((a, b) => b.length - a.length);
  const picked: string[] = [];
  let rest = answer;
  while (rest !== '') {
    const label = labels.find((l) => !picked.includes(l) && (rest === l || rest.startsWith(`${l}, `)));
    if (!label) break;
    picked.push(label);
    rest = rest.slice(label.length + 2);
  }
  const other = rest.trim();
  return { picked, other: other === '' ? null : other };
}

/**
 * The questions of an answered AskUserQuestion call, with your answers, or null while it waits for you, when you
 * skipped it, or when the answers can't be read (then it stays a step like any other).
 */
export function answeredQuestions(item: { name: string; input: unknown; result: { text: string; isError: boolean } | null }): AnsweredQuestion[] | null {
  if (item.name !== 'AskUserQuestion' || !item.result || item.result.isError) return null;
  const raw = (item.input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw)) return null;
  const questions = raw.filter((q): q is QuestionInput => !!q && typeof (q as QuestionInput).question === 'string');
  if (questions.length === 0) return null;
  const answers = parseAnswers(
    item.result.text,
    questions.map((q) => q.question),
  );
  if (answers.size === 0) return null;
  return questions.map((q) => {
    const options = labelsOf(q.options);
    const answer = answers.get(q.question);
    const { picked, other } = answer === undefined ? { picked: [], other: null } : splitAnswer(answer, options);
    return { question: q.question, header: typeof q.header === 'string' && q.header ? q.header : null, multiSelect: q.multiSelect === true, options, picked, other };
  });
}
