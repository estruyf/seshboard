import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  fitSidebar,
  MAIN_MIN_WIDTH,
  parseSidebarState,
  shownWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  snapFromCollapsed,
  snapWidth,
  stepState,
  toggledState,
} from './sidebarWidth.ts';

describe('clampSidebarWidth', () => {
  it('keeps widths inside the limits', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(2000)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(361.6)).toBe(362);
  });

  it('falls back to the default for nonsense', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe('snapWidth', () => {
  it('closes under 110', () => {
    expect(snapWidth(-40)).toEqual({ state: 'closed', width: 0 });
    expect(snapWidth(109)).toEqual({ state: 'closed', width: 0 });
    expect(snapWidth(Number.NaN)).toEqual({ state: 'closed', width: 0 });
  });

  it('shows the rail from 110 to 200', () => {
    expect(snapWidth(110)).toEqual({ state: 'minimal', width: SIDEBAR_RAIL_WIDTH });
    expect(snapWidth(199)).toEqual({ state: 'minimal', width: SIDEBAR_RAIL_WIDTH });
  });

  it('opens at 240 from 200 to 240, then at the dragged width', () => {
    expect(snapWidth(200)).toEqual({ state: 'open', width: 240 });
    expect(snapWidth(239)).toEqual({ state: 'open', width: 240 });
    expect(snapWidth(300.4)).toEqual({ state: 'open', width: 300 });
    expect(snapWidth(900)).toEqual({ state: 'open', width: SIDEBAR_MAX_WIDTH });
  });
});

describe('snapFromCollapsed', () => {
  it('collapses the same way', () => {
    expect(snapFromCollapsed(150, 400)).toEqual({ state: 'minimal', width: SIDEBAR_RAIL_WIDTH });
    expect(snapFromCollapsed(60, 400)).toEqual({ state: 'closed', width: 0 });
  });

  it('opens at 240, or at the last open width when that is closer', () => {
    expect(snapFromCollapsed(210, 400)).toEqual({ state: 'open', width: 240 });
    expect(snapFromCollapsed(330, 400)).toEqual({ state: 'open', width: 400 });
    expect(snapFromCollapsed(600, 400)).toEqual({ state: 'open', width: 400 });
  });
});

describe('stepState', () => {
  it('changes the width in steps while open, within the limits', () => {
    expect(stepState({ state: 'open', width: 320 }, 'right')).toEqual({ state: 'open', width: 336 });
    expect(stepState({ state: 'open', width: 320 }, 'left')).toEqual({ state: 'open', width: 304 });
    expect(stepState({ state: 'open', width: 250 }, 'left')).toEqual({ state: 'open', width: 240 });
    expect(stepState({ state: 'open', width: 520 }, 'right')).toEqual({ state: 'open', width: 520 });
  });

  it('goes from the minimum width to the rail, then closed, and back', () => {
    const rail = stepState({ state: 'open', width: 240 }, 'left');
    expect(rail).toEqual({ state: 'minimal', width: 240 });
    const closed = stepState(rail, 'left');
    expect(closed).toEqual({ state: 'closed', width: 240 });
    expect(stepState(closed, 'left')).toEqual(closed);
    expect(stepState(closed, 'right')).toEqual({ state: 'minimal', width: 240 });
  });

  it('opens from the rail at the last open width', () => {
    expect(stepState({ state: 'minimal', width: 380 }, 'right')).toEqual({ state: 'open', width: 380 });
  });
});

describe('toggledState', () => {
  it('collapses to what the preference says, and always opens again', () => {
    expect(toggledState('open', 'minimal')).toBe('minimal');
    expect(toggledState('open', 'closed')).toBe('closed');
    expect(toggledState('minimal', 'closed')).toBe('open');
    expect(toggledState('closed', 'minimal')).toBe('open');
  });
});

describe('shownWidth and parseSidebarState', () => {
  it('shows 0, the rail or the open width', () => {
    expect(shownWidth('closed', 400)).toBe(0);
    expect(shownWidth('minimal', 400)).toBe(SIDEBAR_RAIL_WIDTH);
    expect(shownWidth('open', 400)).toBe(400);
  });

  it('reads only known states', () => {
    expect(parseSidebarState('minimal')).toBe('minimal');
    expect(parseSidebarState('wide')).toBe('open');
    expect(parseSidebarState(undefined)).toBe('open');
  });
});

describe('fitSidebar', () => {
  it('leaves the sidebar alone when the window has room', () => {
    expect(fitSidebar('open', 320, 1440)).toEqual({ state: 'open', width: 320 });
    expect(fitSidebar('open', 320, 900)).toEqual({ state: 'open', width: 320 });
  });

  it('narrows the open sidebar so the main area keeps its minimum', () => {
    expect(fitSidebar('open', 520, 900)).toEqual({ state: 'open', width: 900 - MAIN_MIN_WIDTH });
    expect(fitSidebar('open', 320, MAIN_MIN_WIDTH + SIDEBAR_MIN_WIDTH)).toEqual({ state: 'open', width: SIDEBAR_MIN_WIDTH });
  });

  it('shows the rail when even the minimum width does not fit (zoomed in, a small window)', () => {
    expect(fitSidebar('open', 320, MAIN_MIN_WIDTH + SIDEBAR_MIN_WIDTH - 1)).toEqual({ state: 'minimal', width: SIDEBAR_RAIL_WIDTH });
    expect(fitSidebar('open', 320, 625)).toEqual({ state: 'minimal', width: SIDEBAR_RAIL_WIDTH });
    expect(fitSidebar('open', 320, 300)).toEqual({ state: 'minimal', width: SIDEBAR_RAIL_WIDTH });
  });

  it('keeps the rail and closed as they are', () => {
    expect(fitSidebar('minimal', 320, 400)).toEqual({ state: 'minimal', width: SIDEBAR_RAIL_WIDTH });
    expect(fitSidebar('closed', 320, 400)).toEqual({ state: 'closed', width: 0 });
  });

  it('ignores a viewport width that is not a number', () => {
    expect(fitSidebar('open', 320, Number.NaN)).toEqual({ state: 'open', width: 320 });
  });
});
