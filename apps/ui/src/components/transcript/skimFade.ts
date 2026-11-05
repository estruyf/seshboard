import type { Paragraph, PhrasingContent, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/**
 * Which sentences of a reply Skim fades, by local rules: no model, no tokens. A sentence stays as it is unless it reads
 * as narration or filler, and what must stay visible wins over that. A reply in another language has nothing to match,
 * so it stays whole: fading too little costs some reading, fading the wrong sentence costs trust.
 */

/** A question, to you or not. */
const QUESTION = /\?/;
const NUMBER = /\d|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|hundred|thousand|million|percent|half)\b/i;
const FAILURE =
  /\b(?:fail\w*|errors?|crash\w*|bugs?|broke\w*|break\w*|exceptions?|regress\w*|flak\w+|timeouts?|timed out|reject\w*|denied|refus\w*|conflicts?|warnings?|wrong|invalid|unable|can't|cannot|couldn't|doesn't work|not work\w*|problems?|issues?|block\w*|abort\w*|missing|risk\w*|careful|caveats?|limitations?)\b/i;
const SKIPPED =
  /\b(?:skip\w*|did not|didn't|not (?:done|changed?|touched?|run|tested|fixed|included|covered|implemented)|haven't|have not|hasn't|has not|won't|will not|left out|leav\w+|ignor\w+|omitted|deferred|postponed|out of scope)\b/i;
const UNFINISHED =
  /\b(?:todo|fixme|still|yet|remain\w*|unfinished|incomplete|not finished|not complete|partial\w*|pending|wip|stubs?|placeholders?|temporar\w*|workarounds?|for now|later|follow-?ups?|next steps?|needs? (?:to|you)|needed to|you(?: need| should| must| have to| will need|'ll need)|must|before you)\b/i;

const MUST_STAY = [QUESTION, NUMBER, FAILURE, SKIPPED, UNFINISHED];

/** The words that lead into a sentence without changing what it says. */
const LEAD = String.raw`(?:(?:so|then|first|next|now|finally|after that|afterwards|also|okay|ok|alright)[,:]?\s+)*`;
const LOOKED = String.raw`went through|walked through|looked|read|checked|searched|explored|reviewed|inspected|traced|opened|examined|investigated|compared|scanned|skimmed|ran|re-?ran|started|began|tried`;

const LESS_IMPORTANT = [
  // What Claude looked at or ran on the way: "I went through the store", "I ran the tests".
  new RegExp(String.raw`^${LEAD}I(?:'ve| have)?\s+(?:also\s+|then\s+|first\s+)?(?:${LOOKED})\b`, 'i'),
  // Tests it wrote on the way; what they show is a sentence of its own.
  new RegExp(String.raw`^${LEAD}I(?:'ve| have)?\s+(?:also\s+)?(?:added|wrote|updated)\s+(?:(?:a|an|the|some|more|new|unit|smoke)\s+)*tests?\b`, 'i'),
  // What it is about to do.
  new RegExp(String.raw`^${LEAD}(?:let me(?! know)|let's|I'll|I will|I'm going to|I am going to)\b`, 'i'),
  // How the work went, rather than what it did.
  /^(?:this|that|it) (?:needed|required|took|involved|runs in|ran in)\b/i,
  // An acknowledgement that is the whole sentence.
  /^(?:great|perfect|excellent|awesome|nice|good|sure|certainly|absolutely|of course|got it|understood|okay|ok|alright|all right|done|all set|all done|there we go|that's it|that should do it)[.!]?$/i,
  // Announcing a summary.
  /^(?:here's|here is) (?:what|how|a summary|the summary)\b/i,
  /^(?:in summary|to summarize|to sum up|overall)\b/i,
  // Closing lines.
  /^(?:just )?let me know (?:if|how|when)\b/i,
  /^(?:feel free|happy to|hope (?:this|that)|I hope|anything else|just (?:say|tell me)|if you(?:'d| would)? (?:like|want|prefer))\b/i,
];

/** Whether a sentence of plain text is one Skim fades. */
export function fadesSentence(sentence: string): boolean {
  const text = sentence.replace(/’/g, "'").trim();
  if (!text) return false;
  if (MUST_STAY.some((rule) => rule.test(text))) return false;
  return LESS_IMPORTANT.some((rule) => rule.test(text));
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
  text: string;
  fades: boolean;
}

function sentencesOf(paragraph: Paragraph): Sentence[] {
  const flat = paragraph.children.map((node) => (node.type === 'text' ? node.value : node.type === 'break' ? '\n' : ATOM)).join('');
  let end = 0;
  const ranges = splitSentences(flat).map((text) => ({ text, start: end, end: (end += text.length) }));
  const sentences = ranges.map((range): Sentence => ({ nodes: [], text: range.text, fades: false }));
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
  // Code, a link or anything marked up says the sentence matters, and code is never faded. So only plain text fades, and
  // a faded sentence holds nothing but text.
  for (const sentence of sentences) sentence.fades = sentence.nodes.every((node) => node.type === 'text') && fadesSentence(sentence.text);
  return sentences;
}

/** The paragraphs prose is in: at the top and in lists. Headings, tables, code and quotes stay as they are. */
function paragraphsOf(nodes: readonly RootContent[]): Paragraph[] {
  return nodes.flatMap((node) => {
    if (node.type === 'paragraph') return [node];
    if (node.type === 'list') return node.children.flatMap((item) => paragraphsOf(item.children));
    return [];
  });
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
 * Fades a Markdown tree's less important sentences, in place, and says how many. When every sentence would fade nothing
 * does: a reply needs something to stand out, and a short one has nothing to skim.
 */
export function fadeTree(tree: Root): FadeCount {
  const plans = paragraphsOf(tree.children).map((paragraph) => ({ paragraph, sentences: sentencesOf(paragraph) }));
  const all = plans.flatMap((plan) => plan.sentences).filter((sentence) => sentence.text.trim() && sentence.nodes.length > 0);
  const faded = all.filter((sentence) => sentence.fades).length;
  if (faded === 0 || faded === all.length) return { faded: 0, total: all.length };
  for (const { paragraph, sentences } of plans) {
    if (!sentences.some((sentence) => sentence.fades)) continue;
    paragraph.children = sentences.flatMap((sentence) => (sentence.fades ? [fadedNode(sentence.nodes)] : sentence.nodes));
  }
  return { faded, total: all.length };
}

/** The remark plugin the renderer uses for a faded reply: the words, inline code and links go through as they were. */
export function remarkSkimFade() {
  return (tree: Root) => {
    fadeTree(tree);
  };
}

/** How many sentences of a reply fade, for the line next to Show all text. */
export function fadeCountOf(markdown: string): FadeCount {
  return fadeTree(unified().use(remarkParse).use(remarkGfm).parse(markdown));
}
