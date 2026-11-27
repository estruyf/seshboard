import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FREE_JACK_CELLS, WORKING_ROUND_MS, WORKING_STILL_LEVEL } from '@seshboard/protocol/working-panel';
import { cableHeads, DOCK_LOOKS, DockActivity, FRAME_COUNT, FRAME_MS, FRAME_SIZE, FREE_JACKS, JACK_STEPS, jackLevels, LIGHT_FRAME_COUNT, LIGHT_FRAME_MS, LIGHT_FRAME_SIZE, paintFrame, pulseLengthFor, STILL_LEVELS, type DockActivityHost } from './dockActivity.ts';

/** A plain dark tile, opaque, as BGRA. */
const tile = (size: number) => Buffer.alloc(size * size * 4, 0).fill(Buffer.from([0x10, 0x10, 0x10, 0xff]));
const pixel = (bitmap: Buffer, size: number, x: number, y: number) => [...bitmap.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
const centre = (i: number, size: number) => [Math.round(FREE_JACKS[i]!.x * size), Math.round(FREE_JACKS[i]!.y * size)] as const;

describe('shared with the working mark', () => {
  it('BUDGET: takes the order, the round and the still frame from @seshboard/protocol/working-panel, and Light shows a frame every 300 ms at 256 px', () => {
    // The icon's jacks sit 200px apart on the 1024px canvas, the first at 312.
    expect(FREE_JACKS.map((jack) => [Math.round(jack.x * 1024), Math.round(jack.y * 1024)])).toEqual(FREE_JACK_CELLS.map((cell) => [312 + (cell % 3) * 200, 312 + Math.floor(cell / 3) * 200]));
    expect(FRAME_MS * FRAME_COUNT).toBe(WORKING_ROUND_MS);
    // Light keeps the round's length with fewer frames, about 3 a second at 256px: one frame a jack, like the working mark.
    expect(LIGHT_FRAME_MS * LIGHT_FRAME_COUNT).toBe(WORKING_ROUND_MS);
    expect(LIGHT_FRAME_COUNT).toBe(FREE_JACKS.length);
    expect(1000 / LIGHT_FRAME_MS).toBeCloseTo(3.3, 1);
    // The budget: Light shows a frame every 300 ms, at 256 px.
    expect(LIGHT_FRAME_MS).toBe(300);
    expect(LIGHT_FRAME_SIZE).toBe(256);
    expect(DOCK_LOOKS.light).toEqual({ frames: LIGHT_FRAME_COUNT, ms: LIGHT_FRAME_MS, size: 256 });
    expect(DOCK_LOOKS.smooth).toEqual({ frames: FRAME_COUNT, ms: FRAME_MS, size: 512 });
    expect(STILL_LEVELS.every((level) => level === WORKING_STILL_LEVEL)).toBe(true);
  });
});

describe('jackLevels', () => {
  it('lights one jack fully, the two before it fading, and moves on every fourth frame', () => {
    const first = jackLevels(0);
    expect(first[0]).toBe(1);
    expect(first[4]).toBeGreaterThan(first[3]!);
    expect(first[3]).toBeGreaterThan(0);
    expect(first[1]).toBe(0);
    expect(jackLevels(JACK_STEPS)[1]).toBe(1);
    // It goes round.
    expect(jackLevels(FRAME_COUNT)).toEqual(first);
    expect(jackLevels(-FRAME_COUNT)).toEqual(first);
  });
});

describe('jackLevels and cableHeads with fewer frames', () => {
  it('make the same round in LIGHT_FRAME_COUNT frames: the light visits every jack and the pulse runs once', () => {
    const rounds = Array.from({ length: LIGHT_FRAME_COUNT }, (_, frame) => jackLevels(frame, LIGHT_FRAME_COUNT));
    expect(rounds[0]![0]).toBe(1);
    // One jack a frame is fully lit, and every jack gets its turn.
    for (const levels of rounds) expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let jack = 0; jack < FREE_JACKS.length; jack++) expect(Math.max(...rounds.map((levels) => levels[jack]!))).toBe(1);
    expect(jackLevels(LIGHT_FRAME_COUNT, LIGHT_FRAME_COUNT)).toEqual(rounds[0]);
    const heads = Array.from({ length: LIGHT_FRAME_COUNT }, (_, frame) => cableHeads(frame, LIGHT_FRAME_COUNT));
    for (let f = 1; f < LIGHT_FRAME_COUNT; f++) expect(heads[f]![0]).toBeGreaterThan(heads[f - 1]![0]!);
    expect(heads[0]![0]).toBeLessThan(0);
    expect(cableHeads(LIGHT_FRAME_COUNT, LIGHT_FRAME_COUNT)).toEqual(heads[0]);
  });
});

describe('pulseLengthFor', () => {
  it('keeps Smooth\'s pulse, and makes Light\'s as long as one of its steps so it still runs along the cable', () => {
    const smooth = pulseLengthFor(FRAME_COUNT);
    const step = cableHeads(1, LIGHT_FRAME_COUNT)[0]! - cableHeads(0, LIGHT_FRAME_COUNT)[0]!;
    expect(pulseLengthFor(LIGHT_FRAME_COUNT)).toBeGreaterThan(smooth);
    expect(pulseLengthFor(LIGHT_FRAME_COUNT)).toBeGreaterThanOrEqual(step);
    // Smooth's steps are shorter than its pulse already.
    expect(smooth).toBeGreaterThan(cableHeads(1)[0]! - cableHeads(0)[0]!);
  });

  it('leaves no dim stretch on the cable between two of Light\'s frames', () => {
    const heads = Array.from({ length: LIGHT_FRAME_COUNT }, (_, frame) => cableHeads(frame, LIGHT_FRAME_COUNT)[0]!);
    // The least light any point of the cable gets from the nearest of a round's pulses.
    const dimmest = (length: number) => Math.min(...Array.from({ length: 101 }, (_, i) => Math.max(...heads.map((head) => Math.exp(-(((i / 100 - head) / length) ** 2))))));
    expect(dimmest(pulseLengthFor(LIGHT_FRAME_COUNT))).toBeGreaterThan(0.6);
    // With Smooth's short pulse, the same steps would leave it dim between.
    expect(dimmest(pulseLengthFor(FRAME_COUNT))).toBeLessThan(0.4);
  });
});

describe('cableHeads', () => {
  it('runs each pulse from before its first plug to past its last once a round, the two half a round apart', () => {
    const heads = Array.from({ length: FRAME_COUNT }, (_, frame) => cableHeads(frame));
    expect(heads[0]![0]).toBeLessThan(0);
    expect(Math.max(...heads.map((h) => h[0]!))).toBeGreaterThan(1);
    // Always forward within a round.
    for (let f = 1; f < FRAME_COUNT; f++) expect(heads[f]![0]).toBeGreaterThan(heads[f - 1]![0]!);
    expect(cableHeads(FRAME_COUNT / 2)[0]).toBeCloseTo(heads[0]![1]!);
    expect(cableHeads(FRAME_COUNT)).toEqual(heads[0]);
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

  it('runs a pulse along the cables that brightens their own colour, plug to plug', () => {
    const size = 128;
    // A warm tile, like the long cable: the pulse adds the same light to every channel, so the hue stays.
    const base = Buffer.alloc(size * size * 4, 0).fill(Buffer.from([0x40, 0x70, 0xc0, 0xff]));
    const at = (x: number, y: number) => [Math.round((x / 1024) * size), Math.round((y / 1024) * size)] as const;
    const [fx, fy] = at(312, 312);
    const [tx, ty] = at(712, 512);
    const off = [0, 0, 0, 0, 0];

    const start = paintFrame(base, size, off, [0, -1]);
    const lit = pixel(start, size, fx, fy);
    expect(lit[0]! - 0x40).toBeGreaterThan(50);
    expect(lit[1]! - 0x70).toBe(lit[0]! - 0x40);
    expect(lit[2]).toBeGreaterThan(lit[1]!);
    expect(lit[3]).toBe(0xff);
    expect(pixel(start, size, tx, ty)).toEqual([0x40, 0x70, 0xc0, 0xff]);

    const end = paintFrame(base, size, off, [1, -1]);
    expect(pixel(end, size, fx, fy)).toEqual([0x40, 0x70, 0xc0, 0xff]);
    expect(pixel(end, size, tx, ty)[0]).toBeGreaterThan(0x40 + 50);
    // No pulse given, no light.
    expect(paintFrame(base, size, off).equals(base)).toBe(true);
  });

  it('adds no light where the icon is transparent', () => {
    const size = 64;
    const frame = paintFrame(Buffer.alloc(size * size * 4), size, STILL_LEVELS, [0.5, 0.5]);
    expect(frame.every((byte) => byte === 0)).toBe(true);
  });
});

function host(options: { file?: string; reducedMotion?: boolean } = {}) {
  const calls = { file: 0, reducedMotion: 0 };
  const sizes: number[] = [];
  const shown: string[] = [];
  const timers: { ms: number; tick: () => void; stopped: boolean }[] = [];
  let restored = 0;
  let reduced = options.reducedMotion ?? false;
  let file: string | undefined = 'file' in options ? options.file : '/icons/graphite.png';
  const fake: DockActivityHost<string> = {
    file: () => (calls.file++, file),
    bitmap: (_file, size) => (sizes.push(size), tile(size)),
    image: (bitmap) => `${file}#${createHash('sha1').update(bitmap).digest('hex')}`,
    show: (image) => void shown.push(image),
    restore: () => void restored++,
    reducedMotion: () => (calls.reducedMotion++, reduced),
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
    calls,
    sizes,
    restored: () => restored,
    setFile: (next: string) => void (file = next),
    setReduced: (next: boolean) => void (reduced = next),
  };
}

describe('DockActivity', () => {
  it('animates Smooth at 13 frames a second, 512px, while a session works and puts the icon back when none does', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setMode('smooth');
    dock.setWorking(true);
    expect(dock.showing).toBe(true);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(FRAME_MS);
    expect(new Set(h.sizes)).toEqual(new Set([FRAME_SIZE]));
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

  it('is Light by default: about 3 frames a second at 256px, one round in the same time', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(LIGHT_FRAME_MS);
    expect(new Set(h.sizes)).toEqual(new Set([LIGHT_FRAME_SIZE]));
    for (let i = 0; i < LIGHT_FRAME_COUNT; i++) h.timers[0]!.tick();
    expect(h.shown).toHaveLength(LIGHT_FRAME_COUNT + 1);
    expect(h.shown[LIGHT_FRAME_COUNT]).toBe(h.shown[0]);
    expect(new Set(h.shown).size).toBe(LIGHT_FRAME_COUNT);
    // The frames are 256px bitmaps.
    expect(h.sizes.length).toBe(1);
  });

  it('does nothing with the setting off, and stops when it is turned off', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setMode('off');
    dock.setWorking(true);
    expect(h.shown).toHaveLength(0);
    dock.setMode('light');
    expect(dock.showing).toBe(true);
    dock.setMode('off');
    expect(dock.showing).toBe(false);
    expect(h.restored()).toBe(1);
  });

  it('switches between Light and Smooth while it shows, without putting the icon back', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    dock.setMode('smooth');
    expect(h.timers[0]!.stopped).toBe(true);
    expect(h.timers).toHaveLength(2);
    expect(h.timers[1]!.ms).toBe(FRAME_MS);
    expect(h.sizes).toEqual([LIGHT_FRAME_SIZE, FRAME_SIZE]);
    expect(h.restored()).toBe(0);
    dock.setMode('light');
    expect(h.timers[1]!.stopped).toBe(true);
    expect(h.timers[2]!.ms).toBe(LIGHT_FRAME_MS);
    expect(h.restored()).toBe(0);
    // The same mode again changes nothing.
    dock.setMode('light');
    expect(h.timers).toHaveLength(3);
    dock.setWorking(false);
    expect(h.timers[2]!.stopped).toBe(true);
    expect(h.restored()).toBe(1);
  });

  it('reads the colourway and Reduce motion once per start, not on every frame', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    for (let i = 0; i < 50; i++) h.timers[0]!.tick();
    expect(h.calls).toEqual({ file: 1, reducedMotion: 1 });
    // A new start reads them again.
    dock.setWorking(false);
    dock.setWorking(true);
    expect(h.calls).toEqual({ file: 2, reducedMotion: 2 });
  });

  it('reads them again on refresh, and swaps the animation and the still frame when Reduce motion changes', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    // Nothing shows: nothing to read.
    dock.refresh();
    expect(h.calls).toEqual({ file: 0, reducedMotion: 0 });
    dock.setWorking(true);
    h.setReduced(true);
    dock.refresh();
    expect(h.calls).toEqual({ file: 2, reducedMotion: 2 });
    expect(h.timers[0]!.stopped).toBe(true);
    expect(h.timers).toHaveLength(1);
    const shownStill = h.shown.length;
    h.setReduced(false);
    dock.refresh();
    expect(h.timers).toHaveLength(2);
    expect(h.timers[1]!.stopped).toBe(false);
    expect(h.shown.length).toBe(shownStill + 1);
    // The same Reduce motion: the animation keeps its timer.
    dock.refresh();
    expect(h.timers).toHaveLength(2);
  });

  it('shows one still frame with Reduce motion on', () => {
    const h = host({ reducedMotion: true });
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    expect(h.shown).toHaveLength(1);
    expect(h.timers).toHaveLength(0);
    // A new colourway is drawn at once, as there is no next tick.
    h.setFile('/icons/signal.png');
    dock.refresh();
    expect(h.shown.at(-1)!.startsWith('/icons/signal.png#')).toBe(true);
    dock.setWorking(false);
    expect(h.restored()).toBe(1);
  });

  it('draws the next frame from a new colourway', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    h.setFile('/icons/ocean.png');
    dock.refresh();
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

  it('redraws the still frame at the new size when the mode changes under Reduce motion, with no timer', () => {
    const h = host({ reducedMotion: true });
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    expect(h.sizes).toEqual([LIGHT_FRAME_SIZE]);
    dock.setMode('smooth');
    expect(h.sizes).toEqual([LIGHT_FRAME_SIZE, FRAME_SIZE]);
    expect(h.shown).toHaveLength(2);
    expect(h.timers).toHaveLength(0);
    expect(dock.showing).toBe(true);
    expect(h.restored()).toBe(0);
  });

  it('holds with the setting on, not with it off, and says how long its frames show', () => {
    const h = host();
    const dock = new DockActivity(h.fake);
    expect(dock.frameMs).toBeNull();
    dock.setMode('off');
    dock.hold(true);
    expect(dock.showing).toBe(false);
    dock.setMode('smooth');
    expect(dock.showing).toBe(true);
    expect(dock.frameMs).toBe(FRAME_MS);
    dock.setMode('light');
    expect(dock.frameMs).toBe(LIGHT_FRAME_MS);
    // A held animation survives work ending, and ends when released.
    dock.setWorking(true);
    dock.setWorking(false);
    expect(dock.showing).toBe(true);
    dock.hold(false);
    expect(dock.showing).toBe(false);
    expect(dock.frameMs).toBeNull();
  });

  it('shows nothing without a file for the colourway', () => {
    const h = host({ file: undefined });
    const dock = new DockActivity(h.fake);
    dock.setWorking(true);
    h.timers[0]!.tick();
    expect(h.shown).toHaveLength(0);
  });
});
