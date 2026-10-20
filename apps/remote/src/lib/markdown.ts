import { marked, type Token, type Tokens } from 'marked';

/**
 * Markdown in Claude's answers, as plain data for React to draw: never HTML. `marked`'s lexer reads the text; this
 * maps its tokens to a few node types, so raw HTML in a transcript stays text (React escapes it) and a link only works
 * for `http:` and `https:`. Pure, so what can and can't come out of it is easy to check.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  /** `href` null: not a web address, so it shows as text. */
  | { type: 'link'; href: string | null; children: Inline[] }
  | { type: 'br' };

export type Block =
  | { type: 'heading'; depth: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'table'; align: Array<'left' | 'center' | 'right' | null>; header: Inline[][]; rows: Inline[][][] }
  | { type: 'quote'; children: Block[] }
  | { type: 'rule' };

/** Only web addresses open; `javascript:`, `data:`, `file:` and relative links don't. */
export function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Markdown keeps `&amp;` and friends as written; they read as the character. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Neighbouring text runs as one, so a word isn't split into several nodes. */
function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (node.type === 'text' && last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + node.text };
    else out.push(node);
  }
  return out;
}

function inline(tokens: readonly Token[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) out.push(...inline(t.tokens));
        else out.push({ type: 'text', text: decodeEntities(t.text) });
        break;
      }
      case 'escape':
        out.push({ type: 'text', text: (token as Tokens.Escape).text });
        break;
      case 'strong':
      case 'em':
      case 'del':
        out.push({ type: token.type, children: inline((token as Tokens.Strong).tokens) });
        break;
      case 'codespan':
        out.push({ type: 'code', text: (token as Tokens.Codespan).text });
        break;
      case 'link': {
        const t = token as Tokens.Link;
        out.push({ type: 'link', href: safeHref(t.href), children: inline(t.tokens) });
        break;
      }
      case 'image': {
        // Pictures stay on the computer (and the app's CSP loads none): the alt text, linked when it's on the web.
        const t = token as Tokens.Image;
        const href = safeHref(t.href);
        const alt = { type: 'text' as const, text: t.text || 'image' };
        out.push(href ? { type: 'link', href, children: [alt] } : alt);
        break;
      }
      case 'br':
        out.push({ type: 'br' });
        break;
      default:
        // Raw HTML and anything new: as the text it was written as.
        out.push({ type: 'text', text: token.raw });
    }
  }
  return merge(out);
}

function blocks(tokens: readonly Token[]): Block[] {
  const out: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        break;
      case 'heading': {
        const t = token as Tokens.Heading;
        out.push({ type: 'heading', depth: t.depth, children: inline(t.tokens) });
        break;
      }
      case 'paragraph':
        out.push({ type: 'paragraph', children: inline((token as Tokens.Paragraph).tokens) });
        break;
      case 'text': {
        // A tight list item's text: one paragraph.
        const t = token as Tokens.Text;
        out.push({ type: 'paragraph', children: t.tokens?.length ? inline(t.tokens) : [{ type: 'text', text: decodeEntities(t.text) }] });
        break;
      }
      case 'list': {
        const t = token as Tokens.List;
        out.push({ type: 'list', ordered: t.ordered, start: typeof t.start === 'number' ? t.start : 1, items: t.items.map((item) => blocks(item.tokens)) });
        break;
      }
      case 'code': {
        const t = token as Tokens.Code;
        out.push({ type: 'code', lang: t.lang?.trim() || null, text: t.text });
        break;
      }
      case 'table': {
        const t = token as Tokens.Table;
        out.push({ type: 'table', align: t.align, header: t.header.map((cell) => inline(cell.tokens)), rows: t.rows.map((row) => row.map((cell) => inline(cell.tokens))) });
        break;
      }
      case 'blockquote':
        out.push({ type: 'quote', children: blocks((token as Tokens.Blockquote).tokens) });
        break;
      case 'hr':
        out.push({ type: 'rule' });
        break;
      default:
        // A block of raw HTML and anything new: a paragraph of the text as written.
        if (token.raw.trim()) out.push({ type: 'paragraph', children: [{ type: 'text', text: token.raw.replace(/\n+$/, '') }] });
    }
  }
  return out;
}

/** Claude's text as blocks. GitHub's flavour: tables, strikethrough, and line breaks kept as written. */
export function parseMarkdown(text: string): Block[] {
  return blocks(marked.lexer(text, { gfm: true, breaks: true }));
}
