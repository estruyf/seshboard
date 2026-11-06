import { describe, expect, it } from 'vitest';
import { contentWidthOf, NEW_SESSION_GRID, newSessionLayout, projectsThatFit, type NewSessionMode } from './newSessionLayout.ts';

const SIDEBAR = 300;
const atWindow = (width: number, sidebar = SIDEBAR) => newSessionLayout(contentWidthOf(width - sidebar));

describe('newSessionLayout', () => {
  it.each<[number, NewSessionMode, number | null]>([
    [2560, 'three', 836],
    [1920, 'three', 836],
    [1680, 'three', 641],
    [1512, 'three', 505],
    [1470, 'two', 778],
    [1280, 'two', 588],
    [1024, 'stack', null],
    [800, 'stack', null],
  ])('a %ipx window with the sidebar open is %s', (width, mode, box) => {
    const layout = atWindow(width);
    expect(layout.mode).toBe(mode);
    if (box !== null) expect(Math.abs(layout.centre - box)).toBeLessThan(2);
  });

  it('moves a window up a layout when the sidebar closes', () => {
    expect(atWindow(1470, 0).mode).toBe('three');
    expect(atWindow(1280, 0).mode).toBe('three');
    expect(atWindow(1024, 0).mode).toBe('two');
  });

  it('changes layout exactly at the breakpoints', () => {
    expect(newSessionLayout(1120).mode).toBe('three');
    expect(newSessionLayout(1119).mode).toBe('two');
    expect(newSessionLayout(780).mode).toBe('two');
    expect(newSessionLayout(779).mode).toBe('stack');
  });

  it('grows the sides from 280 to 320 and stops at 1540 of content', () => {
    expect(newSessionLayout(1120).left).toBe(280);
    expect(newSessionLayout(1330).left).toBe(300);
    expect(newSessionLayout(1540).left).toBe(320);
    expect(newSessionLayout(3000)).toEqual(newSessionLayout(1540));
  });

  it('fills the content with its columns and gaps', () => {
    for (const content of [780, 1000, 1120, 1300, 1540]) {
      const { left, centre, right, gap } = newSessionLayout(content);
      expect((left ?? 0) + centre + (right ?? 0) + gap * (right === null ? 1 : 2)).toBeCloseTo(content);
    }
  });

  it('pads the view less below 780px, and the CSS uses the same breakpoints', () => {
    expect(contentWidthOf(779)).toBe(731);
    expect(contentWidthOf(780)).toBe(700);
    // 780 and 1120 of content, plus 40px a side; the sides reach 320 at 1620 of view.
    expect(newSessionLayout(contentWidthOf(860)).mode).toBe('two');
    expect(newSessionLayout(contentWidthOf(859)).mode).toBe('stack');
    expect(newSessionLayout(contentWidthOf(1200)).mode).toBe('three');
    expect(newSessionLayout(contentWidthOf(1199)).mode).toBe('two');
    expect(NEW_SESSION_GRID).toContain('@min-[780px]/new-session:px-10');
    expect(NEW_SESSION_GRID).toContain('@min-[860px]/new-session:grid-cols-[280px_minmax(0,1fr)]');
    expect(NEW_SESSION_GRID).toContain('@min-[1200px]/new-session:grid-cols-[clamp(280px,calc(280px+(100cqw-1200px)*0.0952381),320px)');
    expect(NEW_SESSION_GRID).toContain('max-w-[1620px]');
    expect(280 + (1620 - 1200) * 0.0952381).toBeCloseTo(320, 3);
  });
});

describe('projectsThatFit', () => {
  it('shows as many as fit, up to 9', () => {
    expect(projectsThatFit(1000, 48, 2)).toBe(9);
    expect(projectsThatFit(248, 48, 2)).toBe(5);
    expect(projectsThatFit(247, 48, 2)).toBe(4);
  });

  it('keeps 3 in a very short column, which then scrolls', () => {
    expect(projectsThatFit(40, 48, 2)).toBe(3);
  });
});
