import { describe, expect, it } from 'vitest';
import { README_END, README_START, shortcutsMarkdown, withShortcuts } from './shortcutsDoc.ts';
import readme from '../../../../README.md?raw';

describe('the README shortcuts table', () => {
  it('is up to date with the registry (run npm run docs:shortcuts)', () => {
    expect(readme).toContain(README_START);
    expect(withShortcuts(readme)).toBe(readme);
  });

  it('writes one table per section, escaping what Markdown would read', () => {
    const markdown = shortcutsMarkdown();
    expect(markdown).toContain('**General**');
    expect(markdown).toContain('| ⌘K or ⌘⇧P | Command palette (in the terminal ⌘K clears it, so use ⌘⇧P) |');
    expect(markdown).toContain('| ⌘\\\\ | Close the other panes (with more than one pane open; Keeps the pane you are in) |');
    expect(markdown).not.toContain('Project actions');
  });

  it('replaces only what is between the markers', () => {
    const readme = `before\n${README_START}\nold\n${README_END}\nafter`;
    expect(withShortcuts(readme, 'new')).toBe(`before\n${README_START}\n\nnew\n\n${README_END}\nafter`);
    expect(() => withShortcuts('no markers', 'new')).toThrow();
  });
});
