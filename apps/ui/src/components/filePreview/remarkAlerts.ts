import type { Blockquote, Paragraph, Root, RootContent } from 'mdast';

export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** The title line of each kind. */
export const ALERT_TITLES: Record<AlertKind, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n)?/i;

/** The alert a blockquote starts, or null; the marker is cut out of its first text. */
function alertOf(quote: Blockquote): AlertKind | null {
  const first = quote.children[0];
  if (first?.type !== 'paragraph') return null;
  const text = first.children[0];
  if (text?.type !== 'text') return null;
  const match = MARKER.exec(text.value);
  if (!match) return null;
  text.value = text.value.slice(match[0].length);
  if (!text.value) first.children.shift();
  if (first.children.length === 0) quote.children.shift();
  return match[1]!.toLowerCase() as AlertKind;
}

function visit(nodes: RootContent[]): void {
  for (const node of nodes) {
    if (node.type === 'blockquote') {
      const kind = alertOf(node);
      if (kind) {
        const title: Paragraph = { type: 'paragraph', children: [{ type: 'text', value: ALERT_TITLES[kind] }], data: { hProperties: { dataAlertTitle: '' } } };
        node.children.unshift(title);
        node.data = { ...node.data, hProperties: { dataAlert: kind } };
      }
    }
    if ('children' in node) visit(node.children as RootContent[]);
  }
}

/**
 * GitHub's alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`): the blockquote gets
 * `data-alert="note"` and a title line, and the marker is taken out of the text. Any other blockquote is left alone.
 */
export function remarkAlerts() {
  return (tree: Root) => visit(tree.children);
}
