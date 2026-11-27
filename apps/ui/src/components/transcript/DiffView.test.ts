import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import styles from '../../styles.css?raw';
import { DiffView } from './DiffView.tsx';

/** The rules of a selector in styles.css, as written there. */
const rule = (selector: string) => {
  const at = styles.indexOf(`${selector} {`);
  return at < 0 ? null : styles.slice(at, styles.indexOf('}', at));
};

describe('DiffView with code highlighting off', () => {
  const html = renderToStaticMarkup(createElement(DiffView, { hunks: [{ before: 'old line\nsame\n', after: 'new line\nsame\n' }] }));

  it('marks each line with its kind, the text last, after the sign', () => {
    expect(html).toMatch(/data-diff-kind="del"[^>]*><span[^>]*>−<\/span><span[^>]*>old line<\/span>/);
    expect(html).toMatch(/data-diff-kind="add"[^>]*><span[^>]*>\+<\/span><span[^>]*>new line<\/span>/);
  });

  it('strikes removed lines through and puts added lines in bold', () => {
    expect(rule(":root[data-code-plain] [data-diff-kind='del'] > :last-child")).toContain('text-decoration-line: line-through');
    expect(rule(":root[data-code-plain] [data-diff-kind='add'] > :last-child")).toContain('font-weight: 600');
    expect(rule(":root[data-code-plain] [data-diff-kind='del']")).toContain('var(--sb-muted)');
  });

  it('keeps the colours of the lines that changed', () => {
    expect(styles).not.toMatch(/data-code-plain[^{]*\{[^}]*--sb-diff-(added|removed)/);
    expect(styles).not.toMatch(/data-code-plain[^{]*\.text-(ok|error)/);
  });
});
