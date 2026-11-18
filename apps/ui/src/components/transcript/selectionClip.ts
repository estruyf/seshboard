import { cleanSelectionHtml, type ClipNode } from './clipboardHtml.ts';

/** `white-space` values that keep a text's line breaks. */
const KEEPS_BREAKS = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces']);
const MONOSPACE = /mono|menlo|consolas|courier/i;

/** Whether the page shows nothing here to a person: the speaker's name for screen readers, hidden and decorative elements. */
function isUnseen(el: Element, style: CSSStyleDeclaration): boolean {
  return style.display === 'none' || style.visibility === 'hidden' || el.classList.contains('sr-only') || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden');
}

/**
 * `user-select` of an element as it is used: the window is `user-select: none` except where `.select-text` opts in, and
 * Chromium puts that on the elements below. Climbs for a browser that does not.
 */
function selectOf(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const value = getComputedStyle(e).userSelect;
    if (value && value !== 'auto') return value;
  }
  return 'auto';
}

/** The number a list shows at its first selected item: the `start` of an ordered list, moved on by the items before the selection. */
function startOf(list: Element, range: Range): string | null {
  const attribute = list.getAttribute('start');
  const items = [...list.children].filter((child) => child.localName === 'li');
  const first = items.findIndex((item) => range.intersectsNode(item));
  if (first <= 0) return attribute;
  const base = Number.parseInt(attribute ?? '', 10);
  return String((Number.isNaN(base) ? 1 : base) + first);
}

function attributesOf(el: Element, range: Range): ClipNode['getAttribute'] {
  return (name) => (name === 'start' && el.localName === 'ol' ? startOf(el, range) : el.getAttribute(name));
}

const isMonospace = (style: CSSStyleDeclaration) => MONOSPACE.test(style.fontFamily);

/**
 * The selected part of the live page as the cleaner reads it. It is built from the page rather than from the range's cloned
 * content, because only the page can say what a person could select: text in an element that is `user-select: none` (the
 * turn line, the Skim stats, a tool row's label) is left out, as are elements that are hidden or for screen readers only.
 * That keeps the HTML in line with `selection.toString()`.
 */
function build(node: Node, range: Range, select: string, parentMonospace: boolean): ClipNode | null {
  if (node.nodeType === 3) {
    if (select === 'none') return null;
    const text = node as Text;
    const data = text.data.slice(text === range.startContainer ? range.startOffset : 0, text === range.endContainer ? range.endOffset : text.length);
    return data ? { nodeType: 3, nodeName: '#text', textContent: data, childNodes: [] } : null;
  }
  if (!(node instanceof Element) || !range.intersectsNode(node)) return null;
  const style = getComputedStyle(node);
  if (isUnseen(node, style)) return null;
  const own = style.userSelect && style.userSelect !== 'auto' ? style.userSelect : select;
  const monospace = isMonospace(style);
  const childNodes = [...node.childNodes].flatMap((child) => build(child, range, own, monospace) ?? []);
  return { nodeType: 1, nodeName: node.nodeName, textContent: null, childNodes, getAttribute: attributesOf(node, range), preformatted: KEEPS_BREAKS.has(style.whiteSpace), monospace: monospace && !parentMonospace };
}

/**
 * The selection as it goes on the clipboard: clean HTML and the text, or null when it is not wholly inside `root` or has
 * nothing to copy. The one place that decides it, for ⌘C (`useCleanCopy`) and the context menu's Copy (`SelectionMenu`).
 */
export function selectionClip(root: Element): { html: string; text: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const common = range.commonAncestorContainer;
  const element = common instanceof Element ? common : common.parentElement;
  if (!element) return null;
  const style = getComputedStyle(element);
  const select = selectOf(element);
  const monospace = isMonospace(style);
  // What is selected below the common ancestor: its children, or the slice of the text node when the selection is inside one.
  const below = common instanceof Element ? [...common.childNodes] : [common];
  const childNodes = below.flatMap((child) => build(child, range, select, monospace) ?? []);
  const fragment: ClipNode = { nodeType: 11, nodeName: '#document-fragment', textContent: null, childNodes, preformatted: KEEPS_BREAKS.has(style.whiteSpace), monospace };
  const ancestors: ClipNode[] = [];
  // From the common ancestor up to the root, which is the page's prose container and holds nothing the clipboard keeps.
  for (let e: Element | null = element; e && root.contains(e) && e !== root; e = e.parentElement) {
    ancestors.push({ nodeType: 1, nodeName: e.nodeName, textContent: null, childNodes: [], getAttribute: attributesOf(e, range) });
  }
  const html = cleanSelectionHtml(fragment, ancestors);
  return html ? { html, text: selection.toString() } : null;
}
