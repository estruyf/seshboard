// @ts-check
import { defineHastPlugin } from 'satteri';

/**
 * Gives every table cell its column's heading as `data-label`, so on a phone, where the CSS stacks each row into a
 * card (switchboard.css, Tables), every value keeps its label.
 */
export function tableLabels() {
  /** @param {any} node */
  const text = (node) => (node.type === 'text' ? node.value : (node.children ?? []).map(text).join(''));
  /** @param {any} node @param {string} tag @returns {any[]} */
  const all = (node, tag) => (node.children ?? []).flatMap((child) => (child.type === 'element' && child.tagName === tag ? [child] : child.type === 'element' ? all(child, tag) : []));
  return defineHastPlugin({
    name: 'switchboard-table-labels',
    element: {
      filter: ['table'],
      visit(node, ctx) {
        const labels = all(node, 'th').map((th) => text(th).trim());
        if (!labels.length) return;
        for (const row of all(node, 'tr')) {
          all(row, 'td').forEach((td, index) => {
            if (labels[index]) ctx.setProperty(td, 'dataLabel', labels[index]);
          });
        }
      },
    },
  });
}
