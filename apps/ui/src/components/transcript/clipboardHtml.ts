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

/** The part of a DOM node the cleaner reads, so it runs on a selection's cloned fragment and in tests without a DOM. */
export interface ClipNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<ClipNode>;
  getAttribute?(name: string): string | null;
}

/** Never copied, with what is inside them: controls, graphics (a Mermaid diagram) and media that don't paste. */
const DROPPED = new Set(['button', 'svg', 'script', 'style', 'input', 'textarea', 'select', 'img', 'video', 'audio', 'canvas', 'iframe', 'webview', 'object', 'embed', 'template']);
/** Kept as the bare tag, without attributes. */
const KEPT = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 'del', 's', 'sup', 'sub', 'ul', 'li', 'thead', 'tbody', 'tfoot', 'tr', 'caption']);
/** Empty ones are the transcript's wrappers (the row of buttons over a code block), not content. */
const DROPPED_WHEN_EMPTY = new Set(['div', 'p']);

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const css = (style: CSSProperties) =>
  Object.entries(style)
    .map(([name, value]) => `${kebab(name)}:${value}`)
    .join(';');
const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, '&quot;');

/** Labels such as a code block's language are on screen but not selectable text; they are in the cloned fragment all the same. */
const isUnselectable = (node: ClipNode) => (node.getAttribute?.('class') ?? '').split(/\s+/).includes('select-none');

function render(node: ClipNode): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? '');
  // An element, or the fragment a selection clones into.
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const tag = node.nodeName.toLowerCase();
  if (DROPPED.has(tag) || isUnselectable(node)) return '';
  let inner = '';
  for (let i = 0; i < node.childNodes.length; i++) inner += render(node.childNodes[i]!);
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
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
  if (KEPT.has(tag)) return DROPPED_WHEN_EMPTY.has(tag) && inner.trim() === '' ? '' : `<${tag}>${inner}</${tag}>`;
  // Anything else (spans, the transcript's own wrappers) only holds its content.
  return inner;
}

/**
 * What a selection in the transcript looks like on the clipboard: the cloned fragment as HTML with its structure
 * (headings, bold, lists, links, code, tables) and nothing else, so the app it is pasted into styles it as its own text.
 * Chromium copies the computed styles instead (the theme's text colour, a background behind code) and they read badly
 * on a white page. Classes, styles, `data-*` attributes, buttons and graphics are left out; links to a file in the
 * project become their text, web links stay. `within`: the selection lies inside a code block or inline code, so the
 * fragment has no `pre` or `code` of its own and gets one here, to stay monospace. Empty when nothing is left.
 */
export function cleanSelectionHtml(fragment: ClipNode, within?: 'pre' | 'code'): string {
  const html = render(fragment);
  if (!html.trim()) return '';
  return within === 'pre' ? `<pre style="${css(PRE_STYLE)}">${html}</pre>` : within === 'code' ? `<code style="${css(CODE_STYLE)}">${html}</code>` : html;
}
