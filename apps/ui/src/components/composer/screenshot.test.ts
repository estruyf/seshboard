import { describe, expect, it } from 'vitest';
import { SCREEN_ACCESS_HINT, screenshotOutcome } from './screenshot.ts';

describe('screenshotOutcome', () => {
  it('attaches the picture', () => {
    expect(screenshotOutcome({ kind: 'image', mediaType: 'image/png', data: 'AAA', name: 'Screenshot 10.00.00.png', screenAccess: true })).toEqual({
      image: { type: 'image', mediaType: 'image/png', data: 'AAA', name: 'Screenshot 10.00.00.png' },
      notice: null,
      noScreenAccess: false,
    });
  });

  it('attaches it and says when Screen Recording is missing', () => {
    expect(screenshotOutcome({ kind: 'image', mediaType: 'image/jpeg', data: 'B', name: 'x.jpg', screenAccess: false })).toMatchObject({ notice: SCREEN_ACCESS_HINT, noScreenAccess: true });
  });

  it('does nothing after Esc, and says why a capture failed', () => {
    expect(screenshotOutcome({ kind: 'cancelled' })).toEqual({ image: null, notice: null, noScreenAccess: false });
    expect(screenshotOutcome(undefined)).toEqual({ image: null, notice: null, noScreenAccess: false });
    expect(screenshotOutcome({ kind: 'failed', message: 'No access', screenAccess: false })).toEqual({ image: null, notice: 'No access', noScreenAccess: true });
    expect(screenshotOutcome({ kind: 'failed', message: 'Too big' })).toEqual({ image: null, notice: 'Too big', noScreenAccess: false });
  });
});
