import { describe, expect, it } from 'vitest';
import { scrollMovesAnchor } from './menuScroll.ts';

/** A tiny tree standing in for the DOM: `contains` is true for itself and everything below it. */
interface Tree {
  contains(n: unknown): boolean;
}
function node(...children: Tree[]): Tree {
  const self: Tree = { contains: (n) => n === self || children.some((c) => c.contains(n)) };
  return self;
}

describe('scrollMovesAnchor', () => {
  const button = node();
  const transcript = node();
  const dialogBody = node(button);

  it('keeps the menu open while the transcript scrolls (new messages stick to the bottom)', () => {
    expect(scrollMovesAnchor(transcript, button)).toBe(false);
  });

  it('keeps the menu open while its own list scrolls', () => {
    expect(scrollMovesAnchor(node(), button)).toBe(false);
  });

  it('closes when a scroller around the button scrolls, since the menu is placed once from the button', () => {
    expect(scrollMovesAnchor(dialogBody, button)).toBe(true);
  });

  it('closes when the page itself scrolls', () => {
    expect(scrollMovesAnchor({}, button)).toBe(true);
    expect(scrollMovesAnchor(null, button)).toBe(true);
  });

  it('closes when the button is gone', () => {
    expect(scrollMovesAnchor(transcript, null)).toBe(true);
  });
});
