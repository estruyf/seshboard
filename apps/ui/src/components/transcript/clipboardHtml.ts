import type { CSSProperties } from 'react';

/** The font code keeps on the clipboard: pasted elsewhere, it still reads as code. */
export const MONO = 'ui-monospace, Menlo, Consolas, monospace';
/** The inline styles clean clipboard HTML keeps, only where the target would lose something without them: code is monospace and tables keep their borders. */
export const CODE_STYLE: CSSProperties = { fontFamily: MONO };
export const PRE_STYLE: CSSProperties = { fontFamily: MONO, whiteSpace: 'pre-wrap' };
export const TABLE_STYLE: CSSProperties = { borderCollapse: 'collapse' };
export const CELL_STYLE: CSSProperties = { border: '1px solid #d0d7de', padding: '4px 8px', textAlign: 'left', verticalAlign: 'top' };

/** Links that still lead somewhere once pasted elsewhere; a link to a file in the project doesn't. */
export const isWebLink = (href: string | null | undefined) => !!href && /^(https?:|mailto:)/i.test(href);

/**
 * The part of a DOM node the cleaner reads, so it runs without a DOM in tests. `selectionClip.ts` builds these from the
 * live page (the selected part of it, with only the text a person could select) and sets what only the live page knows:
 * `preformatted` (the element keeps its line breaks through `white-space`, as a prompt or a diff row does) and `monospace`
 * (its text is in a monospace font, which an element inherits from the container that sets it).
 */
export interface ClipNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<ClipNode>;
  getAttribute?(name: string): string | null;
  preformatted?: boolean;
  monospace?: boolean;
}

/** Never copied, with what is inside them: controls, graphics (a Mermaid diagram), media that don't paste, and the TeX source in maths. */
const DROPPED = new Set(['button', 'svg', 'script', 'style', 'input', 'textarea', 'select', 'img', 'video', 'audio', 'canvas', 'iframe', 'webview', 'object', 'embed', 'template', 'annotation', 'annotation-xml']);
/** Kept as the bare tag, without attributes. */
const KEPT = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 'del', 's', 'sup', 'sub', 'ul', 'li', 'thead', 'tbody', 'tfoot', 'tr', 'caption']);
/** Empty ones are what is left of text that could not be selected (the speaker's name) or of the transcript's wrappers (the row of buttons over a code block), not content. */
const DROPPED_WHEN_EMPTY = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** What a partial selection is wrapped in again, because its cloned content starts below it: marks that carry on through the text, code and headings. */
const WRAP_ALWAYS = new Set(['a', 'strong', 'b', 'em', 'i', 'u', 'del', 's', 'sup', 'sub', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Wrapped only when the selection spans several of the container's children (two table rows, items of a list), so a few words inside one cell or item paste as words, not as a one-cell table or a bullet. */
const CONTAINERS = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'blockquote']);
const WRAP_IN_CONTAINER = new Set([...CONTAINERS, 'li']);

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const css = (style: CSSProperties) =>
  Object.entries(style)
    .map(([name, value]) => `${kebab(name)}:${value}`)
    .join(';');
const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, '&quot;');
const tagOf = (node: ClipNode) => node.nodeName.toLowerCase();

/** Where the text is: `pre` keeps line breaks through `white-space` (so they become `<br>`), `code` is already inside code or a code block. */
interface Context {
  pre: boolean;
  code: boolean;
  /** Already in a monospace font by an element above: it is not set again. */
  mono: boolean;
}

const mono = (inner: string) => (inner ? `<code style="${css(CODE_STYLE)}">${inner}</code>` : '');
/** Block elements, which a monospace font goes on as a style (a `code` around them would put blocks inside inline code). */
const BLOCKS = new Set(['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);

/**
 * Text whose line breaks and spaces `white-space` kept: a break becomes `<br>`, and spaces that would collapse once pasted
 * (leading ones, runs) become non-breaking, so an indent survives.
 */
function preformattedText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => escapeText(line.replace(/^ +/, (spaces) => '\u00a0'.repeat(spaces.length)).replace(/ {2,}/g, (spaces) => `${'\u00a0'.repeat(spaces.length - 1)} `)).replace(/\u00a0/g, '&nbsp;'))
    .join('<br>');
}

/** Tags `markup` writes in its own way, which a monospace font is not added to. */
const OWN_MARKUP = new Set(['a', 'pre', 'code', 'table', 'th', 'td', 'ol']);

/** One element's tag around its content; `font`: it sets a monospace font that nothing above it has. */
function markup(tag: string, node: ClipNode, inner: string, font = false): string {
  if (tag === 'a') {
    const href = node.getAttribute?.('href');
    return isWebLink(href) ? `<a href="${escapeAttribute(href!)}">${inner}</a>` : inner;
  }
  if (tag === 'pre') return `<pre style="${css(PRE_STYLE)}">${inner}</pre>`;
  if (tag === 'code') return `<code style="${css(CODE_STYLE)}">${inner}</code>`;
  if (tag === 'table') return `<table style="${css(TABLE_STYLE)}">${inner}</table>`;
  if (tag === 'th' || tag === 'td') return `<${tag} style="${css(CELL_STYLE)}">${inner}</${tag}>`;
  if (tag === 'ol') {
    const start = node.getAttribute?.('start');
    return start && /^-?\d+$/.test(start) ? `<ol start="${start}">${inner}</ol>` : `<ol>${inner}</ol>`;
  }
  if (KEPT.has(tag)) {
    if (DROPPED_WHEN_EMPTY.has(tag) && inner.trim() === '') return '';
    return font && BLOCKS.has(tag) ? `<${tag} style="${css(CODE_STYLE)}">${inner}</${tag}>` : `<${tag}>${inner}</${tag}>`;
  }
  // Anything else (spans, the transcript's own wrappers) only holds its content.
  return inner;
}

/** A block that keeps its line breaks in a monospace font (a diff row, a command's output): code, so it pastes as a code block with its indent. */
const isCodeRow = (node: ClipNode, context: Context) => node.nodeType === 1 && !!node.preformatted && !!node.monospace && !context.code && BLOCKS.has(tagOf(node));

function renderChildren(node: ClipNode, context: Context): string {
  let html = '';
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]!;
    if (!isCodeRow(child, context) || DROPPED.has(tagOf(child))) {
      html += render(child, context);
      continue;
    }
    // Rows that follow each other are one code block, a line each.
    const rows: string[] = [];
    while (i < node.childNodes.length && isCodeRow(node.childNodes[i]!, context)) rows.push(renderChildren(node.childNodes[i++]!, { pre: true, code: true, mono: true }));
    i--;
    html += `<pre style="${css(PRE_STYLE)}">${rows.join('\n')}</pre>`;
  }
  return html;
}

function render(node: ClipNode, context: Context): string {
  // A line break in text that keeps them through `white-space` is gone once pasted, unless it is a `<br>`.
  if (node.nodeType === 3) return context.pre && !context.code ? preformattedText(node.textContent ?? '') : escapeText(node.textContent ?? '');
  // An element, or the fragment a selection clones into.
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const tag = tagOf(node);
  if (DROPPED.has(tag)) return '';
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
  const font = !!node.monospace && !context.mono && !context.code;
  const next = { pre: context.pre || !!node.preformatted, code: context.code || tag === 'pre' || tag === 'code', mono: context.mono || !!node.monospace };
  let inner = renderChildren(node, next);
  if (font && !KEPT.has(tag) && !OWN_MARKUP.has(tag)) inner = mono(inner);
  return markup(tag, node, inner, font);
}

const BLOCK_TEXT = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'blockquote', 'ul', 'ol', 'table', 'pre', 'hr']);

/** A selection's text from the cleaned tree, for when it differs from what the browser would copy (a formula's source). Blocks on their own lines, cells apart by a tab. */
export function plainText(fragment: ClipNode): string {
  let out = '';
  const lineBreak = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };
  const walk = (node: ClipNode) => {
    if (node.nodeType === 3) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const tag = tagOf(node);
    if (DROPPED.has(tag)) return;
    if (tag === 'br') {
      out += '\n';
      return;
    }
    const block = BLOCK_TEXT.has(tag);
    if (block) lineBreak();
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]!);
    if (tag === 'td' || tag === 'th') out += '\t';
    if (block) lineBreak();
  };
  walk(fragment);
  return out.replace(/\t\n/g, '\n').replace(/\n+$/, '');
}

/**
 * What a selection in the page looks like on the clipboard: its content as HTML with its structure (headings, bold,
 * lists, links, code, tables) and nothing else, so the app it is pasted into styles it as its own text. Chromium copies
 * the computed styles instead (the theme's text colour, a background behind code) and they read badly on a white page.
 * Classes, styles, `data-*` attributes, buttons and graphics are left out; links to a file in the project become their
 * text, web links stay; line breaks kept by `white-space` become `<br>`.
 *
 * `fragment` holds what is selected below the common ancestor. `ancestors` are the elements from the common ancestor (when
 * it is an element) up to the page's prose, innermost first: marks and headings around a selection come back around it, so
 * a few words in a bold run, a link or a heading stay bold, a link or a heading; a container's own tag (`table`, `tbody`,
 * `tr`, `ul`, `ol`, `blockquote`, and the `li`s above them) only when the selection spans several of its children, so
 * two table rows paste as a table and one cell's words as words. Empty when nothing is left.
 */
export function cleanSelectionHtml(fragment: ClipNode, ancestors: readonly ClipNode[] = []): string {
  const code = ancestors.some((a) => tagOf(a) === 'pre' || tagOf(a) === 'code');
  // A selection inside a block that keeps its line breaks in a monospace font (a diff row) is a code block.
  const block = !!fragment.preformatted && !!fragment.monospace && !code;
  const context = { pre: !!fragment.preformatted, code: code || block, mono: !!fragment.monospace };
  let html = renderChildren(fragment, context);
  if (block && html.trim()) html = `<pre style="${css(PRE_STYLE)}">${html}</pre>`;
  // A span, not code: what is selected in a monospace container may hold blocks.
  else if (fragment.monospace && !code && !block && html.trim() && !(html.startsWith('<pre ') && html.endsWith('</pre>') && html.split('<pre ').length === 2)) html = `<span style="${css(CODE_STYLE)}">${html}</span>`;
  if (!html.trim()) return '';
  const spans = ancestors.length > 0 && CONTAINERS.has(tagOf(ancestors[0]!));
  for (const ancestor of ancestors) {
    const tag = tagOf(ancestor);
    if (WRAP_ALWAYS.has(tag) || (spans && WRAP_IN_CONTAINER.has(tag))) html = markup(tag, ancestor, html);
  }
  return html;
}
