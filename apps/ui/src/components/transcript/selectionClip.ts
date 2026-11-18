import { cleanSelectionHtml, plainText, type ClipNode } from './clipboardHtml.ts';

/** Marks a container whose selections copy as clean HTML (`useCleanCopy`); the menus' Copy finds the root of a selection by it. */
export const CLEAN_COPY = 'data-clean-copy';

/** `white-space` values that keep a text's line breaks. */
const KEEPS_BREAKS = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces']);
const MONOSPACE = /mono|menlo|consolas|courier/i;

/** What the walk reads of a node of the page, so it runs on a small fake in tests. A DOM node has all of it. */
export interface LiveNode {
  nodeType: number;
  nodeName: string;
  localName?: string;
  data?: string;
  childNodes: ArrayLike<LiveNode>;
  parentElement: LiveNode | null;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  classList?: { contains(name: string): boolean };
}
export interface LiveRange {
  startContainer: LiveNode;
  startOffset: number;
  endContainer: LiveNode;
  endOffset: number;
  commonAncestorContainer: LiveNode;
  intersectsNode(node: LiveNode): boolean;
  /** -1 before the range, 0 in it, 1 after it. */
  comparePoint(node: LiveNode, offset: number): number;
}
export interface LiveStyle {
  userSelect: string;
  display: string;
  visibility: string;
  whiteSpace: string;
  fontFamily: string;
}

/** Whether the page shows nothing here to a person: the speaker's name for screen readers, hidden and decorative elements. */
function isUnseen(el: LiveNode, style: LiveStyle): boolean {
  return style.display === 'none' || style.visibility === 'hidden' || !!el.classList?.contains('sr-only') || el.getAttribute?.('aria-hidden') === 'true' || !!el.hasAttribute?.('hidden');
}

const isElement = (node: LiveNode) => node.nodeType === 1;
const isMonospace = (style: LiveStyle) => MONOSPACE.test(style.fontFamily);
const isInside = (node: LiveNode, root: LiveNode) => {
  for (let n: LiveNode | null = node; n; n = n.parentElement) if (n === root) return true;
  return false;
};

/**
 * The number a list shows at its first selected item: the `start` of an ordered list, moved on by the items before the
 * selection.
 */
function startOf(list: LiveNode, range: LiveRange): string | null {
  const attribute = list.getAttribute?.('start') ?? null;
  const items = Array.from(list.childNodes).filter((child) => isElement(child) && child.localName === 'li');
  const first = items.findIndex((item) => range.intersectsNode(item));
  if (first <= 0) return attribute;
  const base = Number.parseInt(attribute ?? '', 10);
  return String((Number.isNaN(base) ? 1 : base) + first);
}

function attributesOf(el: LiveNode, range: LiveRange): ClipNode['getAttribute'] {
  return (name) => (name === 'start' && el.localName === 'ol' ? startOf(el, range) : (el.getAttribute?.(name) ?? null));
}

interface Walk {
  range: LiveRange;
  style(el: LiveNode): LiveStyle;
  /** The TeX of the formulas in the selection, each copied as its source. */
  formulas: string[];
}

/** An element's children as the page shows them: a closed details shows only its summary, the rest is hidden by `content-visibility`, not `display`. */
function shown(node: LiveNode): LiveNode[] {
  const children = Array.from(node.childNodes);
  return node.localName === 'details' && !node.hasAttribute?.('open') ? children.filter((child) => isElement(child) && child.localName === 'summary') : children;
}

const textNode = (data: string): ClipNode => ({ nodeType: 3, nodeName: '#text', textContent: data, childNodes: [] });

/** The part of `el` the range covers entirely, as against one it only touches at an edge (a triple-click ends at the start of the next item). */
const isWithin = (range: LiveRange, el: LiveNode) => {
  const parent = el.parentElement;
  if (!parent) return true;
  const index = Array.from(parent.childNodes).indexOf(el);
  return range.comparePoint(parent, index) === 0 && range.comparePoint(parent, index + 1) === 0;
};

/**
 * The selected part of the live page as the cleaner reads it. It is built from the page rather than from the range's cloned
 * content, because only the page can say what a person could select: text in an element that is `user-select: none` (the
 * turn line, the Skim stats, a tool row's label) is left out, as are elements that are hidden or for screen readers only,
 * and the body of a closed `details`. Only what the range holds is kept: text outside it, under an element it starts or
 * ends in, is not, and an element the range only touches at an edge (an item at offset 0) is dropped if nothing is left.
 * A formula (`data-math-source`) is its source in `$…$`, or `$$…$$` for a block (`data-math-display`).
 */
function build(node: LiveNode, walk: Walk, select: string): ClipNode | null {
  const { range } = walk;
  if (node.nodeType === 3) {
    if (select === 'none' || !range.intersectsNode(node)) return null;
    const data = node.data ?? '';
    const sliced = data.slice(node === range.startContainer ? range.startOffset : 0, node === range.endContainer ? range.endOffset : data.length);
    return sliced ? textNode(sliced) : null;
  }
  if (!isElement(node) || !range.intersectsNode(node)) return null;
  const style = walk.style(node);
  if (isUnseen(node, style)) return null;
  const source = node.getAttribute?.('data-math-source');
  if (source) {
    walk.formulas.push(source);
    const display = !!node.hasAttribute?.('data-math-display');
    const formula = textNode(display ? `$$${source}$$` : `$${source}$`);
    return display ? { nodeType: 1, nodeName: 'DIV', textContent: null, childNodes: [formula] } : formula;
  }
  const own = style.userSelect && style.userSelect !== 'auto' ? style.userSelect : select;
  const childNodes = shown(node).flatMap((child) => build(child, walk, own) ?? []);
  if (childNodes.length === 0 && node.localName !== 'br' && node.localName !== 'hr' && !isWithin(range, node)) return null;
  return { nodeType: 1, nodeName: node.nodeName, textContent: null, childNodes, getAttribute: attributesOf(node, range), preformatted: KEEPS_BREAKS.has(style.whiteSpace), monospace: isMonospace(style) };
}

/** The nearest formula wrapper at or above `node`, below `root`. */
function formulaAround(node: LiveNode, root: LiveNode): LiveNode | null {
  for (let n: LiveNode | null = node; n && n !== root; n = n.parentElement) if (isElement(n) && n.getAttribute?.('data-math-source')) return n;
  return null;
}

/**
 * The selection as it goes on the clipboard, from `range` inside `root`: clean HTML and the text, or null when the range is
 * not wholly inside `root` or has nothing to copy. `selectedText` is what the browser would copy as text, which is the clip's
 * text too; only when a formula's TeX is missing from it (the page gave none) is the text made from the clip.
 */
export function clipFromRange(root: LiveNode, range: LiveRange, style: (el: LiveNode) => LiveStyle, selectedText: () => string): { html: string; text: string } | null {
  if (!isInside(range.startContainer, root) || !isInside(range.endContainer, root)) return null;
  const common = range.commonAncestorContainer;
  // A selection inside a formula is the whole formula.
  const formula = formulaAround(common, root);
  const element = formula ? formula.parentElement : isElement(common) ? common : common.parentElement;
  if (!element) return null;
  const elementStyle = style(element);
  // `user-select` as it is used: the window is `none` except where `.select-text` opts in, and Chromium puts that on the elements below. Climbs for a browser that does not.
  let select = 'auto';
  for (let e: LiveNode | null = element; e; e = e.parentElement) {
    const value = style(e).userSelect;
    if (value && value !== 'auto') {
      select = value;
      break;
    }
  }
  const walk: Walk = { range, style, formulas: [] };
  // What is selected below the common ancestor: its children, or the slice of the text node when the selection is inside one.
  const below = formula ? [formula] : isElement(common) ? shown(common) : [common];
  const childNodes = below.flatMap((child) => build(child, walk, select) ?? []);
  const fragment: ClipNode = { nodeType: 11, nodeName: '#document-fragment', textContent: null, childNodes, preformatted: KEEPS_BREAKS.has(elementStyle.whiteSpace), monospace: isMonospace(elementStyle) };
  const ancestors: ClipNode[] = [];
  // From the common ancestor up to the root, which is the page's prose container and holds nothing the clipboard keeps.
  for (let e: LiveNode | null = element; e && e !== root && isInside(e, root); e = e.parentElement) {
    ancestors.push({ nodeType: 1, nodeName: e.nodeName, textContent: null, childNodes: [], getAttribute: attributesOf(e, range) });
  }
  const html = cleanSelectionHtml(fragment, ancestors);
  if (!html) return null;
  const selected = selectedText();
  return { html, text: walk.formulas.every((tex) => selected.includes(tex)) ? selected : plainText(fragment) };
}

export interface Clip {
  html: string;
  text: string;
}

/** The selection as the clipboard gets it, from the clean-copy root it lies in; null when it lies in none or is empty. */
export function currentClip(): Clip | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const common = selection.getRangeAt(0).commonAncestorContainer;
  const root = (common instanceof Element ? common : common.parentElement)?.closest(`[${CLEAN_COPY}]`);
  return root ? selectionClip(root) : null;
}

/** The selection as it goes on the clipboard, if it is wholly inside `root`: the one place that decides it, for ⌘C, the floating toolbar's Copy and the menus'. */
export function selectionClip(root: Element): Clip | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return clipFromRange(root as unknown as LiveNode, selection.getRangeAt(0) as unknown as LiveRange, (el) => getComputedStyle(el as unknown as Element), () => selection.toString());
}

/**
 * Copy for the buttons and menus that copy the selection: what ⌘C puts on the clipboard (`clip`, worked out when the menu
 * opened, or the selection as it is now), and `fallback` as text when it lies outside the clean-copy containers.
 */
export async function copySelection(fallback: string, clip?: Clip | null): Promise<void> {
  const found = clip ?? currentClip();
  try {
    if (found) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([found.html], { type: 'text/html' }), 'text/plain': new Blob([found.text], { type: 'text/plain' }) })]);
    else await navigator.clipboard.writeText(fallback);
  } catch {
    await navigator.clipboard.writeText(found?.text ?? fallback).catch(() => {});
  }
}
