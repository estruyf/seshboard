import { blankSource, freeBlankName, type BlankType } from '@switchboard/protocol/client';

/** Something in a sent message that could be a blank: where it is, what it is and the blank it would become. */
export interface BlankSuggestion {
  start: number;
  end: number;
  text: string;
  type: Extract<BlankType, 'issue' | 'pr' | 'branch' | 'file'>;
  /** The blank's name, before it is made unique in the prompt. */
  name: string;
}

/** The usual starts of a branch name: `feat/…`, `fix/…`, a worktree's `claude/…`. */
const BRANCH_PREFIXES = 'feat|feature|fix|bugfix|hotfix|chore|docs|refactor|release|perf|test|ci|build|style|claude|dev';

interface Rule {
  type: BlankSuggestion['type'];
  name: string;
  pattern: RegExp;
}

// In order: a link to a pull request isn't also an issue, and a path with a branch-like start stays a file.
const RULES: Rule[] = [
  { type: 'pr', name: 'pr', pattern: /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+(?:\/[\w-]+)?/g },
  { type: 'issue', name: 'issue', pattern: /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/g },
  { type: 'pr', name: 'pr', pattern: /(?<![\w#&/])(?:PR|pull request) #\d+\b/gi },
  { type: 'issue', name: 'issue', pattern: /(?<![\w#&/])#\d+\b/g },
  // A path with a folder and an extension, or an @ mention.
  { type: 'file', name: 'file', pattern: /(?<![\w@/.-])@?(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8}\b|(?<![\w@])@[\w./-]+\.[A-Za-z0-9]{1,8}\b/g },
  { type: 'branch', name: 'branch', pattern: new RegExp(`(?<![\\w/.-])(?:${BRANCH_PREFIXES})\\/[\\w.-]+(?:\\/[\\w.-]+)*(?<![.])`, 'g') },
];

/**
 * GitHub issue and pull request links (and `#123`), branch names and file paths in a message, in order and without
 * overlaps, for Save as prompt to offer as blanks. `branches` are the project's local branches: any of them that
 * shows up counts as a branch too. What sits inside `{{…}}` already is left alone.
 */
export function detectSuggestions(text: string, branches: readonly string[] = []): BlankSuggestion[] {
  const found: BlankSuggestion[] = [];
  const taken = (start: number, end: number) => found.some((s) => start < s.end && end > s.start);
  // Blanks that are there already.
  for (const match of text.matchAll(/\{\{[^{}]*\}\}/g)) found.push({ start: match.index, end: match.index + match[0].length, text: match[0], type: 'file', name: '' });
  const blanksAt = found.length;
  const rules: Rule[] = [...RULES];
  const known = branches.filter((b) => b.length > 2 && /^[\w./-]+$/.test(b) && !/^(main|master|develop|trunk)$/.test(b));
  if (known.length) rules.push({ type: 'branch', name: 'branch', pattern: new RegExp(`(?<![\\w/.-])(?:${known.map(escapeRegex).join('|')})(?![\\w/-])`, 'g') });
  for (const rule of rules) {
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken(start, end)) continue;
      found.push({ start, end, text: match[0], type: rule.type, name: rule.name });
    }
  }
  return found.slice(blanksAt).sort((a, b) => a.start - b.start);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with one suggestion turned into a blank of its type, with a name the prompt doesn't use yet. */
export function applySuggestion(text: string, suggestion: Pick<BlankSuggestion, 'start' | 'end' | 'type' | 'name'>): string {
  const name = freeBlankName(text, suggestion.name);
  return `${text.slice(0, suggestion.start)}${blankSource({ name, type: suggestion.type, options: [], optional: false })}${text.slice(suggestion.end)}`;
}
