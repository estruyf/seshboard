import { describe, expect, it } from 'vitest';
import { dragPosition, drawerLabel, drawerWidth, needsYouElsewhere, settle, startsEdgeSwipe } from './drawer.ts';
import { addSample, axisOf, velocity } from './gesture.ts';

describe('the edge swipe', () => {
  it('starts within 20px of the left edge', () => {
    expect(startsEdgeSwipe(0)).toBe(true);
    expect(startsEdgeSwipe(20)).toBe(true);
    expect(startsEdgeSwipe(21)).toBe(false);
  });

  it('only counts a mostly sideways drag, once it moved a few pixels', () => {
    expect(axisOf(4, 2)).toBeNull();
    expect(axisOf(45, 10)).toBe('x');
    expect(axisOf(30, 25)).toBe('y');
    expect(axisOf(-30, 5)).toBe('x');
    expect(axisOf(2, 40)).toBe('y');
  });
});

describe('dragPosition', () => {
  it('follows the finger from closed to the right, and from open to the left', () => {
    expect(dragPosition('closed', 120, 330)).toBe(120);
    expect(dragPosition('open', -100, 330)).toBe(230);
  });

  it('stops at both ends', () => {
    expect(dragPosition('closed', -50, 330)).toBe(0);
    expect(dragPosition('closed', 500, 330)).toBe(330);
    expect(dragPosition('open', 40, 330)).toBe(330);
  });
});

describe('settle', () => {
  it('opens past 40px to the right, and stays closed short of it', () => {
    expect(settle('closed', 41, 0)).toBe('open');
    expect(settle('closed', 40, 0)).toBe('closed');
    expect(settle('closed', 10, 0)).toBe('closed');
  });

  it('closes past 40px to the left', () => {
    expect(settle('open', -60, 0)).toBe('closed');
    expect(settle('open', -20, 0)).toBe('open');
  });

  it('lets a flick decide, whichever way it goes', () => {
    expect(settle('closed', 20, 0.8)).toBe('open');
    expect(settle('closed', 200, -0.8)).toBe('closed');
    expect(settle('open', -10, -0.6)).toBe('closed');
    expect(settle('open', -200, 0.6)).toBe('open');
  });
});

describe('velocity', () => {
  it('measures the last 100ms of the drag', () => {
    let samples = [{ x: 0, t: 0 }];
    samples = addSample(samples, { x: 10, t: 50 });
    samples = addSample(samples, { x: 100, t: 200 });
    samples = addSample(samples, { x: 160, t: 250 });
    expect(velocity(samples)).toBeCloseTo(60 / 50);
  });

  it('is 0 for a finger that stopped before it lifted, or a single sample', () => {
    expect(velocity([])).toBe(0);
    expect(velocity([{ x: 5, t: 10 }])).toBe(0);
    const quick = [
      { x: 0, t: 0 },
      { x: 30, t: 10 },
    ];
    expect(velocity(quick)).toBe(3);
    expect(velocity(quick, 300)).toBe(0);
  });
});

describe('the drawer button', () => {
  it('counts what needs you, leaving out the open session', () => {
    const sessions = [
      { id: 'a', status: 'needs-you' },
      { id: 'b', status: 'needs-you' },
      { id: 'c', status: 'working' },
      { id: 'd', status: 'needs-you' },
    ];
    expect(needsYouElsewhere(sessions, 'a')).toBe(2);
    expect(needsYouElsewhere(sessions, null)).toBe(3);
  });

  it('says so in its label', () => {
    expect(drawerLabel(0)).toBe('Sessions');
    expect(drawerLabel(1)).toBe('Sessions, 1 needs you');
    expect(drawerLabel(2)).toBe('Sessions, 2 need you');
  });

  it('takes 86% of a phone’s width, and at most 400px', () => {
    expect(drawerWidth(390)).toBe(335);
    expect(drawerWidth(820)).toBe(400);
  });
});
