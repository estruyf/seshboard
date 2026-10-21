import { commandLabel } from '@switchboard/protocol';
import { isTestCommand } from './testCommands.ts';
import { oneLine, type ToolCall } from './turn.ts';

/**
 * Shell commands in plain words, for the catch-up's lines: what Claude said a command does (the Bash tool's
 * `description`), else a short command as it is, else what kind of command it was (`commandLabel`, as the steps of
 * the conversation say it). A long command, a script or a sed expression is never pasted into the card.
 */

/** Past tenses that don't add -ed. */
const IRREGULAR: Record<string, string> = {
  begin: 'began', build: 'built', do: 'did', find: 'found', get: 'got', give: 'gave', keep: 'kept', make: 'made', put: 'put',
  read: 'read', rebuild: 'rebuilt', redo: 'redid', rerun: 'reran', 're-run': 're-ran', rewrite: 'rewrote', run: 'ran', send: 'sent',
  set: 'set', split: 'split', take: 'took', undo: 'undid', write: 'wrote', see: 'saw', spin: 'spun', hide: 'hid', bring: 'brought',
};
/** Longer verbs that double their last letter, which the one-syllable rule below doesn't catch. */
const DOUBLING = new Set(['commit', 'submit', 'admit', 'forget', 'quit', 'equip', 'refer', 'prefer', 'occur', 'control']);
/** One syllable ending in one vowel and one consonant doubles it: stop, tag, grep (not fix, show, say). */
const SHORT_CVC = /^[^aeiou]*[aeiou][^aeiouwxy]$/;
/** Words a description can start with that aren't verbs ("Only…", "Also…", "TypeScript check"). */
const NOT_VERBS = /^(only|also|then|now|just|still|again|first|next|finally|the|a|an|and|all|both|some|this|that|these|those|my|our|new|\w+ly|\w+ed)$/;

/**
 * "Run the tests" as "Ran the tests": Claude starts a command's description with a verb ("Install package
 * dependencies"), put in the past tense for "What it did". Left as written when it doesn't start with one.
 */
export function pastTense(description: string): string {
  const match = /^([A-Za-z][a-z]*(?:-[a-z]+)?)\b(.*)$/s.exec(description);
  if (!match) return description;
  const [, word, rest] = match as unknown as [string, string, string];
  const verb = word.toLowerCase();
  if (NOT_VERBS.test(verb)) return description;
  let past = IRREGULAR[verb];
  if (!past) {
    if (verb.endsWith('e')) past = `${verb}d`;
    else if (/[^aeiou]y$/.test(verb)) past = `${verb.slice(0, -1)}ied`;
    else if (DOUBLING.has(verb) || SHORT_CVC.test(verb)) past = `${verb}${verb.at(-1)}ed`;
    else past = `${verb}ed`;
  }
  return `${word[0] === word[0]!.toUpperCase() ? past[0]!.toUpperCase() + past.slice(1) : past}${rest}`;
}

/** "Run Vitest" as "run Vitest", for the middle of a sentence; "TypeScript check" and "CI" keep their capitals. */
const lowerFirst = (text: string) => (/^[A-Z][a-z]+\b/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

/** The command line without what only sets it up: a leading `cd …` part and environment assignments (`CI=1`). */
const coreOf = (command: string) =>
  command
    .trim()
    .replace(/^cd\s+\S+\s*&&\s*/, '')
    .replace(/^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');

/** What a command is, without its description: "the tests", "npm run lint", "a Python script", "a git command". */
function commandNoun(command: string): string {
  if (isTestCommand(command)) return 'the tests';
  const label = commandLabel(command);
  // A long command is shortened to its program ("git"), which reads as a name, not a command.
  if (!/^[\w.-]+$/.test(label) || label === coreOf(command)) return label;
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label} command`;
}

/** A command that ran, for "What it did": "Ran the unit tests", "Ran npm run lint", "Ran a Python script". */
export function ranLine(call: ToolCall): string {
  if (call.description) return oneLine(pastTense(call.description), 120);
  if (/^sed\s+(-\w*i|--in-place)/.test(coreOf(call.command ?? ''))) return 'Edited files with sed';
  return oneLine(`Ran ${commandNoun(call.command ?? call.name)}`, 120);
}

/** A command that failed, for "Skipped or not finished": "Couldn't rewrite the imports", "npm run lint failed". */
export function failedLine(call: ToolCall): string {
  if (call.description) return oneLine(`Couldn’t ${lowerFirst(call.description)}`, 160);
  const noun = commandNoun(call.command ?? call.name);
  return oneLine(`${noun.replace(/^an? /, (article) => article[0]!.toUpperCase() + article.slice(1))} failed`, 160);
}

/** A command you said no to: "You declined: Remove the build folder", "You declined rm -rf dist". */
export function declinedLine(call: ToolCall): string {
  return oneLine(call.description ? `You declined: ${call.description}` : `You declined ${commandNoun(call.command ?? call.name)}`, 160);
}

/**
 * What makes two commands "the same" for a retry: the program and its first words, up to a flag, a quote or an
 * operator ("npm run lint", "git commit", "python3", "node scripts/build.ts").
 */
export function commandKey(command: string): string {
  const words: string[] = [];
  for (const word of coreOf(command).split(/\s+/)) {
    if (words.length === 3 || !/^[\w./:@=+-]+$/.test(word) || word.startsWith('-')) break;
    words.push(word);
  }
  return words.join(' ');
}

/** Whether a failed call was run again later and worked then, so it is no unfinished work. */
export function retriedLater(call: ToolCall, later: readonly ToolCall[]): boolean {
  if (!call.command) return false;
  const key = commandKey(call.command);
  return key !== '' && later.some((t) => t.command !== null && t.exitCode === 0 && commandKey(t.command) === key);
}
