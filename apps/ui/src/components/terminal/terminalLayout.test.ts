import { describe, expect, it } from 'vitest';
import {
  CHAT_MIN_HEIGHT,
  CHAT_MIN_WIDTH,
  clampPanelHeight,
  clampPanelWidth,
  effectiveDock,
  PANEL_DEFAULT_HEIGHT,
  PANEL_DEFAULT_WIDTH,
  PANEL_KEY_STEP,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  panelSizeForKey,
  parseDock,
  maxBottomHeight,
  maxRightWidth,
  rightBlocked,
} from './terminalLayout.ts';

const window = { width: 1400, height: 900 };

describe('effectiveDock', () => {
  it('keeps the dock the user chose while the right side is free', () => {
    expect(effectiveDock('bottom', null)).toBe('bottom');
    expect(effectiveDock('right', null)).toBe('right');
  });
  it('docks below while the right side is taken or too narrow', () => {
    expect(effectiveDock('right', 'changes')).toBe('bottom');
    expect(effectiveDock('right', 'narrow')).toBe('bottom');
  });
  it('stays below when it was below anyway', () => {
    expect(effectiveDock('bottom', 'changes')).toBe('bottom');
  });
});

describe('rightBlocked', () => {
  it('is taken by the Changes panel', () => {
    expect(rightBlocked(true, 1600)).toBe('changes');
  });
  it('is too narrow when the view cannot fit the panel and the conversation', () => {
    expect(rightBlocked(false, PANEL_MIN_WIDTH + CHAT_MIN_WIDTH - 1)).toBe('narrow');
    expect(rightBlocked(false, PANEL_MIN_WIDTH + CHAT_MIN_WIDTH)).toBeNull();
  });
  it('is free before the view is measured', () => {
    expect(rightBlocked(false, null)).toBeNull();
  });
});

describe('maxRightWidth', () => {
  it('leaves the conversation its minimum', () => {
    expect(maxRightWidth(1000)).toBe(1000 - CHAT_MIN_WIDTH);
  });
  it('never goes under the panel minimum, and has no limit before the view is measured', () => {
    expect(maxRightWidth(500)).toBe(PANEL_MIN_WIDTH);
    expect(maxRightWidth(null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('maxBottomHeight', () => {
  it('leaves the conversation its minimum, so a short stacked pane keeps its message box', () => {
    expect(maxBottomHeight(700)).toBe(700 - CHAT_MIN_HEIGHT);
    expect(maxBottomHeight(348)).toBe(PANEL_MIN_HEIGHT + 8);
  });
  it('never goes under the panel minimum, and has no limit before the view is measured', () => {
    expect(maxBottomHeight(200)).toBe(PANEL_MIN_HEIGHT);
    expect(maxBottomHeight(null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('parseDock', () => {
  it('reads a stored dock and defaults to below', () => {
    expect(parseDock('right')).toBe('right');
    expect(parseDock('bottom')).toBe('bottom');
    expect(parseDock(undefined)).toBe('bottom');
    expect(parseDock('left')).toBe('bottom');
  });
});

describe('clampPanelHeight', () => {
  it('keeps a height within the limits, rounded', () => {
    expect(clampPanelHeight(300.6, 900)).toBe(301);
  });
  it('never goes below the minimum or above 75% of the window', () => {
    expect(clampPanelHeight(10, 900)).toBe(PANEL_MIN_HEIGHT);
    expect(clampPanelHeight(5000, 900)).toBe(675);
  });
  it('falls back to the default for a bad value', () => {
    expect(clampPanelHeight(Number.NaN, 900)).toBe(PANEL_DEFAULT_HEIGHT);
  });
});

describe('clampPanelWidth', () => {
  it('defaults to 500px and keeps at least 360px', () => {
    expect(clampPanelWidth(Number.NaN, 1400)).toBe(PANEL_DEFAULT_WIDTH);
    expect(clampPanelWidth(100, 1400)).toBe(PANEL_MIN_WIDTH);
  });
  it('takes at most 70% of the window', () => {
    expect(clampPanelWidth(2000, 1000)).toBe(700);
  });
  it('keeps the minimum in a window too small for it', () => {
    expect(clampPanelWidth(600, 400)).toBe(PANEL_MIN_WIDTH);
  });
});

describe('panelSizeForKey', () => {
  it('below: ↑ makes the panel taller and ↓ shorter', () => {
    expect(panelSizeForKey('bottom', 'ArrowUp', 280, window)).toBe(280 + PANEL_KEY_STEP);
    expect(panelSizeForKey('bottom', 'ArrowDown', 280, window)).toBe(280 - PANEL_KEY_STEP);
  });
  it('on the right: ← makes the panel wider and → narrower', () => {
    expect(panelSizeForKey('right', 'ArrowLeft', 500, window)).toBe(500 + PANEL_KEY_STEP);
    expect(panelSizeForKey('right', 'ArrowRight', 500, window)).toBe(500 - PANEL_KEY_STEP);
  });
  it('ignores the arrows of the other direction and other keys', () => {
    expect(panelSizeForKey('bottom', 'ArrowLeft', 280, window)).toBeNull();
    expect(panelSizeForKey('right', 'ArrowUp', 500, window)).toBeNull();
    expect(panelSizeForKey('right', 'Enter', 500, window)).toBeNull();
  });
  it('stays within the limits', () => {
    expect(panelSizeForKey('right', 'ArrowRight', PANEL_MIN_WIDTH, window)).toBe(PANEL_MIN_WIDTH);
    expect(panelSizeForKey('bottom', 'ArrowDown', PANEL_MIN_HEIGHT, window)).toBe(PANEL_MIN_HEIGHT);
  });
});
