import { describe, expect, it } from 'vitest';
import { keyboardFrame } from './viewport.ts';

describe('keyboardFrame', () => {
  it('fits the session view in what the keyboard leaves, while the box has focus', () => {
    expect(keyboardFrame({ focused: true, layoutHeight: 844, viewportHeight: 508.4, offsetTop: 0 })).toEqual({ height: 508, top: 0 });
  });

  it('follows the visible part when Safari scrolls the page under the keyboard', () => {
    expect(keyboardFrame({ focused: true, layoutHeight: 844, viewportHeight: 508, offsetTop: 260.6 })).toEqual({ height: 508, top: 261 });
  });

  it('leaves the view alone without focus, or without a keyboard', () => {
    expect(keyboardFrame({ focused: false, layoutHeight: 844, viewportHeight: 508, offsetTop: 0 })).toBeNull();
    // Android resizes the page itself: nothing is covered.
    expect(keyboardFrame({ focused: true, layoutHeight: 508, viewportHeight: 508, offsetTop: 0 })).toBeNull();
    // Safari's toolbar coming and going is not a keyboard.
    expect(keyboardFrame({ focused: true, layoutHeight: 844, viewportHeight: 790, offsetTop: 0 })).toBeNull();
  });

  it('never goes above the page', () => {
    expect(keyboardFrame({ focused: true, layoutHeight: 844, viewportHeight: 500, offsetTop: -4 })).toEqual({ height: 500, top: 0 });
  });
});
