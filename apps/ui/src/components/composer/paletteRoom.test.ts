import { describe, expect, it } from 'vitest';
import { paletteRoom } from './paletteRoom.ts';

describe('paletteRoom', () => {
  it('opens above while the list fits there', () => {
    expect(paletteRoom({ top: 500, bottom: 800 }, 900)).toEqual({ below: false, height: 288 });
  });

  it('opens below a box high in the window', () => {
    expect(paletteRoom({ top: 200, bottom: 480 }, 900)).toEqual({ below: true, height: 288 });
  });

  it('takes the side with more room when it fits on neither', () => {
    expect(paletteRoom({ top: 200, bottom: 420 }, 560)).toEqual({ below: false, height: 140 });
    expect(paletteRoom({ top: 120, bottom: 300 }, 560)).toEqual({ below: true, height: 248 });
  });
});
