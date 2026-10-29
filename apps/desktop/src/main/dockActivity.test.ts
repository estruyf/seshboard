import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DockActivity, FRAME_COUNT, FRAME_MS, FREE_JACKS, jackLevels, paintFrame, STILL_LEVELS, type DockActivityHost } from './dockActivity.ts';

/** A plain dark tile, opaque, as BGRA. */
const tile = (size: number) => Buffer.alloc(size * size * 4, 0).fill(Buffer.from([0x10, 0x10, 0x10, 0xff]));
const pixel = (bitmap: Buffer, size: number, x: number, y: number) => [...bitmap.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
const centre = (i: number, size: number) => [Math.round(FREE_JACKS[i]!.x * size), Math.round(FREE_JACKS[i]!.y * size)] as const;

describe('jackLevels', () => {
  it('lights one jack fully, the two before it fading, and moves on every third frame', () => {
    const first = jackLevels(0);
    expect(first[0]).toBe(1);
    expect(first[4]).toBeGreaterThan(first[3]!);
    expect(first[3]).toBeGreaterThan(0);
    expect(first[1]).toBe(0);
    expect(jackLevels(3)[1]).toBe(1);
    // It goes round.
    expect(jackLevels(FRAME_COUNT)).toEqual(first);
    expect(jackLevels(-FRAME_COUNT)).toEqual(first);
  });
});

describe('paintFrame', () => {
  it('lights the jacks to their level and leaves the rest of the icon alone', () => {
    const size = 128;
    const base = tile(size);
    const frame = paintFrame(base, size, [1, 0.5, 0, 0, 0]);
    const [x0, y0] = centre(0, size);
    const [x1, y1] = centre(1, size);
    const [x2, y2] = centre(2, size);
    // Lit: brighter in the red channel than in the blue (amber), and opaque as before.
    const lit = pixel(frame, size, x0, y0);
    expect(lit[2]).toBeGreaterThan(200);
    expect(lit[3]).toBe(0xff);
    expect(pixel(frame, size, x1, y1)[2]).toBeLessThan(lit[2]!);
    expect(pixel(frame, size, x1, y1)[2]).toBeGreaterThan(0x10);
    // Off, and away from every jack: as it was.
    expect(pixel(frame, size, x2, y2)).toEqual([0x10, 0x10, 0x10, 0xff]);
    expect(pixel(frame, size, 2, 2)).toEqual([0x10, 0x10, 0x10, 0xff]);
    // The icon's own pixels aren't touched.
    expect(pixel(base, size, x0, y0)).toEqual([0x10, 0x10, 0x10, 0xff]);
  });

  it('adds no light where the icon is transparent', () => {
    const size = 64;
    const frame = paintFrame(Buffer.alloc(size * size * 4), size, STILL_LEVELS);
    expect(frame.every((byte) => byte === 0)).toBe(true);
  });
});

function host(options: { file?: string; reducedMotion?: boolean } = {}) {
  const shown: string[] = [];
  const timers: { ms: number; tick: () => void; stopped: boolean }[] = [];
  let restored = 0;
  let reduced = options.reducedMotion ?? false;
  let file: string | undefined = 'file' in options ? options.file : '/icons/graphite.png';
  const fake: DockActivityHost<string> = {
    file: () => file,
    bitmap: (_file, size) => tile(size),
    image: (bitmap) => `${file}#${createHash('sha1').update(bitmap).digest('hex')}`,
    show: (image) => void shown.push(image),
    restore: () => void restored++,
    reducedMotion: () => reduced,
    every: (ms, tick) => {
      const timer = { ms, tick, stopped: false };
      timers.push(timer);
      return () => void (timer.stopped = true);
    },
  };
  return {
    fake,
    shown,
    timers,
    restored: () => restored,
    setFile: (next: string) => void (file = next),
    setReduced: (next: boolean) => void (reduced = next),
  };
}

describe('DockActivity', () => {
  it('animates while a session works and puts the icon back when none does', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    expect(dock.showing).toBe(true);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(FRAME_MS);
    for (let i = 0; i < FRAME_COUNT; i++) h.timers[0]!.tick();
    // One frame at once, then one a tick: a whole round comes back to the first.
    expect(h.shown).toHaveLength(FRAME_COUNT + 1);
    expect(h.shown[FRAME_COUNT]).toBe(h.shown[0]);
    expect(new Set(h.shown).size).toBe(FRAME_COUNT);

    dock.setWorking(true);
    expect(h.timers).toHaveLength(1);
    dock.setWorking(false);
    expect(dock.showing).toBe(false);
    expect(h.timers[0]!.stopped).toBe(true);
    expect(h.restored()).toBe(1);
    // Nothing to put back when nothing was shown.
    dock.setWorking(false);
    expect(h.restored()).toBe(1);
  });

  it('does nothing with the setting off, and stops when it is turned off', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setEnabled(false);
    dock.setWorking(true);
    expect(h.shown).toHaveLength(0);
    dock.setEnabled(true);
    expect(dock.showing).toBe(true);
    dock.setEnabled(false);
    expect(dock.showing).toBe(false);
    expect(h.restored()).toBe(1);
  });

  it('shows one still frame with Reduce motion on', () => {
    const h = host({ reducedMotion: true });
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    expect(h.shown).toHaveLength(1);
    expect(h.timers).toHaveLength(0);
    // A new colourway is drawn at once, as there is no next tick.
    h.setFile('/icons/signal.png');
    dock.iconChanged();
    expect(h.shown.at(-1)!.startsWith('/icons/signal.png#')).toBe(true);
    dock.setWorking(false);
    expect(h.restored()).toBe(1);
  });

  it('draws the next frame from a new colourway', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    h.setFile('/icons/ocean.png');
    dock.iconChanged();
    h.timers[0]!.tick();
    expect(h.shown.at(-1)!.startsWith('/icons/ocean.png#')).toBe(true);
  });

  it('holds for the smoke test whatever the sessions do', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.hold(true);
    dock.setWorking(false);
    expect(dock.showing).toBe(true);
    dock.hold(false);
    expect(dock.showing).toBe(false);
  });

  it('shows nothing without a file for the colourway', () => {
    const h = host({ file: undefined });
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    h.timers[0]!.tick();
    expect(h.shown).toHaveLength(0);
  });
});
