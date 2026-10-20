import { describe, expect, it } from 'vitest';
import { collapseMargin } from './largeTitle.ts';

describe('collapseMargin', () => {
  it('lets the title leave the top once the list scrolled 40px', () => {
    // A title whose bottom is at 103px leaves an area that starts at 63px after 40px of scroll.
    expect(collapseMargin(103)).toBe('-63px 0px 0px 0px');
    expect(collapseMargin(56.4, 40)).toBe('-16px 0px 0px 0px');
  });

  it('never moves the top up, for a title shorter than the threshold', () => {
    expect(collapseMargin(30)).toBe('0px 0px 0px 0px');
  });
});
