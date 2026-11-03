import { describe, expect, it } from 'vitest';
import { WORKING_ROUND_MS } from '@seshboard/protocol/working-panel';
import { jackLevels, FRAME_COUNT } from './dockActivity.ts';
import {
  countsLine,
  FREE_JACK_CENTRES,
  STILL_LEVELS,
  workingLevels,
  IDLE_LEVELS,
  LIGHT_INK,
  MenuBar,
  menuBarState,
  paintTrayIcon,
  panelHeight,
  panelPosition,
  quitsWhenAllClosed,
  TEMPLATE_INK,
  TRAY_FRAME_COUNT,
  TRAY_FRAME_MS,
  trayLevels,
  trayMenu,
  trayTitle,
  trayTooltip,
  type MenuBarHost,
} from './menuBar.ts';

/** A pixel's alpha at a jack's centre, on a `size` icon. */
const alphaAt = (bitmap: Buffer, size: number, [x, y]: readonly [number, number]) => {
  const px = Math.floor(((x - 100) / 824) * size);
  const py = Math.floor(((y - 100) / 824) * size);
  return bitmap[(py * size + px) * 4 + 3]!;
};

describe('the icon state', () => {
  it('is needs you with any count, else working, else idle', () => {
    expect(menuBarState({ working: 0, needsYou: 0 })).toBe('idle');
    expect(menuBarState({ working: 2, needsYou: 0 })).toBe('working');
    expect(menuBarState({ working: 2, needsYou: 1 })).toBe('needs-you');
    expect(menuBarState({ working: 0, needsYou: 1 })).toBe('needs-you');
  });

  it('names the state in the tooltip, and the count next to the icon on macOS only', () => {
    expect(trayTooltip({ working: 3, needsYou: 1 })).toBe('Seshboard: 3 working, 1 needs you');
    expect(trayTooltip({ working: 0, needsYou: 2 })).toBe('Seshboard: 2 need you');
    expect(trayTooltip({ working: 0, needsYou: 0 })).toBe('Seshboard: nothing running');
    expect(countsLine({ working: 2, needsYou: 1 })).toBe('2 working · 1 needs you');
    expect(trayTitle({ working: 1, needsYou: 2 }, 'darwin')).toBe('2');
    expect(trayTitle({ working: 1, needsYou: 0 }, 'darwin')).toBe('');
    expect(trayTitle({ working: 1, needsYou: 2 }, 'win32')).toBe('');
  });
});

describe('the frames', () => {
  it('go round the free jacks in the shared order, at about four frames a second', () => {
    expect(TRAY_FRAME_MS * TRAY_FRAME_COUNT).toBe(WORKING_ROUND_MS);
    expect(1000 / TRAY_FRAME_MS).toBe(4);
    for (let frame = 0; frame < TRAY_FRAME_COUNT; frame++) expect(trayLevels(frame)).toEqual(workingLevels(frame / TRAY_FRAME_COUNT));
    // In step with the Dock: the same light at the same point of the round.
    for (let frame = 0; frame < TRAY_FRAME_COUNT; frame++) {
      const dock = jackLevels((frame / TRAY_FRAME_COUNT) * FRAME_COUNT);
      trayLevels(frame).forEach((level, i) => expect(level).toBeCloseTo(dock[i]!));
    }
    // The brightest jack moves forward through the order.
    const heads = Array.from({ length: TRAY_FRAME_COUNT }, (_, f) => {
      const levels = trayLevels(f);
      return levels.indexOf(Math.max(...levels));
    });
    expect(heads[0]).toBe(0);
    expect(heads.at(-1)).toBe(FREE_JACK_CENTRES.length - 1);
    expect(FREE_JACK_CENTRES).toEqual([
      [512, 312],
      [712, 312],
      [312, 512],
      [512, 512],
      [712, 712],
    ]);
  });

  it('draws plugged jacks solid, free ones as rings, and fills the lit one', () => {
    const size = 32;
    const idle = paintTrayIcon(size, IDLE_LEVELS, TEMPLATE_INK);
    expect(idle).toHaveLength(size * size * 4);
    // A plugged jack (top left) is solid in the middle; a free one (top middle) is empty there, a ring.
    expect(alphaAt(idle, size, [312, 312])).toBeGreaterThan(220);
    expect(alphaAt(idle, size, [512, 312])).toBe(0);
    const lit = paintTrayIcon(size, [1, 0, 0, 0, 0], TEMPLATE_INK);
    expect(alphaAt(lit, size, [512, 312])).toBeGreaterThan(220);
    expect(alphaAt(lit, size, [712, 312])).toBe(0);
  });

  it('has one still frame with every free jack filled for Reduce motion', () => {
    const still = paintTrayIcon(32, STILL_LEVELS, TEMPLATE_INK);
    for (const centre of FREE_JACK_CENTRES) expect(alphaAt(still, 32, centre)).toBeGreaterThan(150);
  });

  it('puts the needs-you dot in the corner on Windows, in pink', () => {
    const size = 32;
    const plain = paintTrayIcon(size, IDLE_LEVELS, LIGHT_INK);
    const dotted = paintTrayIcon(size, IDLE_LEVELS, LIGHT_INK, true);
    const i = ((size - 5) * size + (size - 5)) * 4;
    expect(dotted[i + 2]).toBe(0xed);
    expect(dotted[i + 3]).toBeGreaterThan(200);
    expect(plain[i + 2]).toBe(0xff);
  });
});

describe('the panel', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  it('sits under a menu bar icon and above a taskbar icon, inside the screen', () => {
    expect(panelPosition({ x: 1200, y: 0, width: 24, height: 24 }, { width: 380, height: 400 }, workArea)).toEqual({ x: 1022, y: 31 });
    // Near the right edge it moves left to stay on screen.
    expect(panelPosition({ x: 1420, y: 0, width: 24, height: 24 }, { width: 380, height: 400 }, workArea).x).toBe(1440 - 380 - 8);
    // Windows: the taskbar under the work area.
    const windows = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(panelPosition({ x: 1700, y: 1048, width: 24, height: 24 }, { width: 380, height: 400 }, windows)).toEqual({ x: 1522, y: 1040 - 400 - 6 });
  });

  it('is as tall as its content, up to 70% of the screen', () => {
    expect(panelHeight(300.2, workArea)).toBe(301);
    expect(panelHeight(5000, workArea)).toBe(612);
  });
});

describe('closing the last window', () => {
  it('quits on Windows and Linux only when Keep running is off, and never on macOS', () => {
    expect(quitsWhenAllClosed('win32', false)).toBe(true);
    expect(quitsWhenAllClosed('linux', false)).toBe(true);
    expect(quitsWhenAllClosed('win32', true)).toBe(false);
    expect(quitsWhenAllClosed('linux', true)).toBe(false);
    expect(quitsWhenAllClosed('darwin', false)).toBe(false);
    expect(quitsWhenAllClosed('darwin', true)).toBe(false);
  });
});

describe('the right-click menu', () => {
  it('says the counts, then Open, New session, Pause and Quit', () => {
    const items = trayMenu({ working: 2, needsYou: 1 }, false);
    expect(items[0]).toEqual({ kind: 'line', label: '2 working · 1 needs you' });
    expect(items.flatMap((item) => (item.kind === 'action' || item.kind === 'pause' ? [item.label] : []))).toEqual(['Open Seshboard', 'New session…', 'Pause notifications', 'Quit Seshboard']);
    const pause = (paused: boolean) => trayMenu({ working: 0, needsYou: 0 }, paused).find((item) => item.kind === 'pause');
    expect(pause(false)?.kind === 'pause' && pause(false)!.choices.map((c) => c.id)).toEqual(['1h', '3h', 'tomorrow']);
    expect(pause(true)?.kind === 'pause' && pause(true)!.choices.at(-1)?.id).toBe('resume');
  });
});

describe('MenuBar', () => {
  function host(platform: NodeJS.Platform = 'darwin', reduced = false) {
    const h = {
      calls: [] as string[],
      images: [] as string[],
      titles: [] as string[],
      tips: [] as string[],
      timers: [] as { ms: number; tick: () => void; stopped: boolean }[],
      reduced,
      host: null as unknown as MenuBarHost<string>,
    };
    let made = 0;
    h.host = {
      platform,
      show: (image) => (h.calls.push('show'), h.images.push(image)),
      hide: () => h.calls.push('hide'),
      setImage: (image) => h.images.push(image),
      setTitle: (title) => h.titles.push(title),
      setToolTip: (tip) => h.tips.push(tip),
      setMenu: () => {},
      image: (frames, template) => `image-${made++}-${frames.map((f) => f.size).join('+')}-${template ? 'template' : 'plain'}`,
      reducedMotion: () => h.reduced,
      darkTaskbar: () => true,
      every: (ms, tick) => {
        const timer = { ms, tick, stopped: false };
        h.timers.push(timer);
        return () => void (timer.stopped = true);
      },
    };
    return h;
  }

  it('shows a still template icon while idle, and nothing when off', () => {
    const h = host();
    const bar = new MenuBar(h.host);
    bar.setEnabled(true);
    expect(h.calls).toEqual(['show']);
    expect(h.images[0]).toMatch(/16\+32-template$/);
    expect(h.timers).toHaveLength(0);
    expect(h.tips.at(-1)).toBe('Seshboard: nothing running');
    bar.setEnabled(false);
    expect(h.calls).toEqual(['show', 'hide']);
    expect(bar.visible).toBe(false);
  });

  it('moves the light while something works, and stops when it is done', () => {
    const h = host();
    const bar = new MenuBar(h.host);
    bar.setEnabled(true);
    bar.setCounts({ working: 1, needsYou: 0 });
    expect(bar.animating).toBe(true);
    expect(h.timers[0]!.ms).toBe(TRAY_FRAME_MS);
    for (let i = 0; i < TRAY_FRAME_COUNT; i++) h.timers[0]!.tick();
    // Six frames, then the first one again (made once, reused).
    const frames = h.images.slice(-TRAY_FRAME_COUNT - 1);
    expect(new Set(frames.slice(1)).size).toBe(TRAY_FRAME_COUNT);
    expect(frames.at(-1)).toBe(frames[0]);
    bar.setCounts({ working: 0, needsYou: 0 });
    expect(h.timers[0]!.stopped).toBe(true);
    expect(bar.animating).toBe(false);
  });

  it('shows the count with needs you, moving while work goes on and still otherwise', () => {
    const h = host();
    const bar = new MenuBar(h.host);
    bar.setEnabled(true);
    bar.setCounts({ working: 1, needsYou: 2 });
    expect(bar.state).toBe('needs-you');
    expect(bar.animating).toBe(true);
    expect(h.titles.at(-1)).toBe('2');
    bar.setCounts({ working: 0, needsYou: 2 });
    expect(bar.animating).toBe(false);
    bar.setCounts({ working: 0, needsYou: 0 });
    expect(h.titles.at(-1)).toBe('');
  });

  it('shows one still frame with Reduce motion', () => {
    const h = host('darwin', true);
    const bar = new MenuBar(h.host);
    bar.setEnabled(true);
    bar.setCounts({ working: 2, needsYou: 0 });
    expect(bar.animating).toBe(false);
    expect(h.timers).toHaveLength(0);
  });

  it('draws plain images with a dot on Windows while something needs you, and no title', () => {
    const h = host('win32');
    const bar = new MenuBar(h.host);
    bar.setEnabled(true);
    expect(h.images[0]).toMatch(/plain$/);
    const before = h.images.length;
    bar.setCounts({ working: 0, needsYou: 1 });
    expect(h.images[before]).not.toBe(h.images[0]);
    expect(h.titles.every((t) => t === '')).toBe(true);
    expect(h.tips.at(-1)).toBe('Seshboard: 1 needs you');
  });
});
