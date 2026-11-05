import type { Paragraph, PhrasingContent, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/**
 * Which sentences of a reply Skim fades. Haiku picks the ones to keep (Settings › Conversation, off by default), since
 * only a model can weigh a sentence against what you asked. This file numbers the sentences for it, and has the last word:
 * a sentence that says something failed, was skipped or isn't finished, or asks something, stays whatever Haiku picked.
 */

/** A question, to you or not. */
const QUESTION = /\?/;
const FAILURE =
  /\b(?:fail\w*|errors?|crash\w*|bugs?|broke\w*|break\w*|exceptions?|regress\w*|flak\w+|timeouts?|timed out|reject\w*|denied|refus\w*|conflicts?|warnings?|wrong|invalid|unable|can't|cannot|couldn't|doesn't work|not work\w*|problems?|issues?|block\w*|abort\w*|missing|risk\w*|careful|caveats?|limitations?)\b/i;
const SKIPPED =
  /\b(?:skip\w*|did not|didn't|not (?:done|changed?|touched?|run|tested|fixed|included|covered|implemented)|haven't|have not|hasn't|has not|won't|will not|left out|leav\w+|ignor\w+|omitted|deferred|postponed|out of scope|ran nothing|only part|none of|estimates?)\b/i;
const UNFINISHED =
  /\b(?:todo|fixme|still|yet|remain\w*|unfinished|incomplete|not finished|not complete|partial\w*|pending|wip|stubs?|placeholders?|temporar\w*|workarounds?|for now|later|follow-?ups?|next steps?|needs? (?:to|you)|needed to|you(?: need| should| must| have to| will need|'ll need)|must|before you)\b/i;

const MUST_STAY = [QUESTION, FAILURE, SKIPPED, UNFINISHED];

/** The fewest sentences worth asking Haiku about: a shorter reply has nothing to skim. */
export const SKIM_MIN_SENTENCES = 8;

/** Under this share faded, a reply looks the same: the button and the count would be more to read than they save. */
const MIN_FADED_SHARE = 0.1;

/** Whether a sentence stays whatever Haiku picked. */
export function mustStay(sentence: string): boolean {
  const text = sentence.replace(/’/g, "'");
  return MUST_STAY.some((rule) => rule.test(text));
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Splits text into sentences, each with the space after it: together they are the text again. */
export function splitSentences(text: string): string[] {
  return [...segmenter.segment(text)].map((part) => part.segment);
}

/**
 * Stands for anything that isn't plain text while a paragraph is split: one character, so `a.ts` or a link can't end a
 * sentence with a full stop of its own. An upper-case letter, since one starts a sentence where lower case doesn't.
 */
const ATOM = 'Ʞ';

interface Sentence {
  nodes: PhrasingContent[];
  /** What it says, with inline code and link text. */
  text: string;
}

const plainText = (node: PhrasingContent): string => ('value' in node ? node.value : 'children' in node ? node.children.map(plainText).join('') : '');

function sentencesOf(paragraph: Paragraph): Sentence[] {
  const flat = paragraph.children.map((node) => (node.type === 'text' ? node.value : node.type === 'break' ? '\n' : ATOM)).join('');
  let end = 0;
  const ranges = splitSentences(flat).map((text) => ({ text, start: end, end: (end += text.length) }));
  const sentences = ranges.map((): Sentence => ({ nodes: [], text: '' }));
  let at = 0;
  let current = 0;
  for (const node of paragraph.children) {
    if (node.type !== 'text') {
      sentences[current]!.nodes.push(node);
      at += 1;
      if (at >= ranges[current]!.end && current < ranges.length - 1) current++;
      continue;
    }
    let rest = node.value;
    while (rest) {
      const take = Math.min(rest.length, ranges[current]!.end - at);
      sentences[current]!.nodes.push({ type: 'text', value: rest.slice(0, take) });
      rest = rest.slice(take);
      at += take;
      if (at >= ranges[current]!.end && current < ranges.length - 1) current++;
    }
  }
  for (const sentence of sentences) sentence.text = sentence.nodes.map(plainText).join('');
  return sentences;
}

/** A sentence that gets a number: blank space between two isn't one. */
const counts = (sentence: Sentence) => sentence.text.trim() !== '';

/** The paragraphs prose is in: at the top and in lists. Headings, tables, code and quotes stay as they are. */
function paragraphsOf(nodes: readonly RootContent[]): Paragraph[] {
  return nodes.flatMap((node) => {
    if (node.type === 'paragraph') return [node];
    if (node.type === 'list') return node.children.flatMap((item) => paragraphsOf(item.children));
    return [];
  });
}

const parse = (markdown: string) => unified().use(remarkParse).use(remarkGfm).parse(markdown);

/** A reply as Haiku reads it, and how many sentences it numbered. */
export interface SkimOutline {
  text: string;
  total: number;
}

/**
 * Numbers a reply's sentences as `fadeTree` does, so Haiku's numbers mean the same sentences. Headings stay for context;
 * what never fades (code, tables, quotes) goes as a word, since Haiku has nothing to pick there.
 */
export function skimOutline(markdown: string): SkimOutline {
  const lines: string[] = [];
  let total = 0;
  const walk = (nodes: readonly RootContent[], prefix: string) => {
    for (const node of nodes) {
      if (node.type === 'paragraph') {
        for (const sentence of sentencesOf(node).filter(counts)) lines.push(`${prefix}[${++total}] ${sentence.text.trim()}`);
      } else if (node.type === 'list') {
        for (const item of node.children) walk(item.children, `${prefix}- `);
      } else if (node.type === 'heading') {
        lines.push(`${'#'.repeat(node.depth)} ${node.children.map(plainText).join('')}`);
      } else if (node.type === 'code' || node.type === 'table' || node.type === 'blockquote') {
        lines.push(`(${node.type})`);
      }
    }
  };
  walk(parse(markdown).children, '');
  return { text: lines.join('\n'), total };
}

/** A faded sentence. `data` makes it a span with the faint colour; it starts as emphasis since that is a node that holds text. */
const fadedNode = (nodes: PhrasingContent[]): PhrasingContent => ({
  type: 'emphasis',
  data: { hName: 'span', hProperties: { className: ['text-faint'], dataSkimFaded: true } },
  children: nodes,
});

export interface FadeCount {
  faded: number;
  total: number;
}

/**
 * Fades every sentence not in `keep` (numbered from 1, as in `skimOutline`) that may fade, in place, and says how many.
 * When all or nearly none would fade, nothing does: a reply needs something to stand out, and a change too small to see
 * isn't worth a button.
 */
export function fadeTree(tree: Root, keep: readonly number[]): FadeCount {
  const kept = new Set(keep);
  let number = 0;
  const plans = paragraphsOf(tree.children).map((paragraph) => {
    const sentences = sentencesOf(paragraph).map((sentence) => {
      const fades = counts(sentence) && !kept.has(++number) && !mustStay(sentence.text);
      return { sentence, fades };
    });
    return { paragraph, sentences };
  });
  const faded = plans.flatMap((plan) => plan.sentences).filter((s) => s.fades).length;
  if (faded === 0 || faded === number || faded / number < MIN_FADED_SHARE) return { faded: 0, total: number };
  for (const { paragraph, sentences } of plans) {
    if (!sentences.some((s) => s.fades)) continue;
    paragraph.children = sentences.flatMap(({ sentence, fades }) => (fades ? [fadedNode(sentence.nodes)] : sentence.nodes));
  }
  return { faded, total: number };
}

/** The remark plugin the renderer uses for a faded reply: the words, inline code and links go through as they were. */
export function remarkSkimFade({ keep }: { keep: readonly number[] }) {
  return (tree: Root) => {
    fadeTree(tree, keep);
  };
}

/** How many sentences of a reply fade, for the line next to Show all text. */
export function fadeCountOf(markdown: string, keep: readonly number[]): FadeCount {
  return fadeTree(parse(markdown), keep);
}
