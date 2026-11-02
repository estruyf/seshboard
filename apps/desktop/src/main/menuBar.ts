/**
 * Seshboard in the menu bar (the notification area on Windows, a tray menu on Linux): an icon that lights up while
 * sessions work and shows how many need you, as the Dock and its badge do. Its frames are drawn here, from the jacks
 * and timing the Dock and `WorkingPanel` share (`@seshboard/protocol/working-panel`), so no image ships for them. The painting and the
 * rules are pure, for testing; `MenuBar` gets Electron's `Tray` through a host, as `DockActivity` does.
 */

import { NOTIFICATION_PAUSES, type NotificationPause } from '@seshboard/protocol/bridge';
import { FREE_JACK_CELLS, jackCell, PANEL_SIZE, WORKING_ROUND_MS, WORKING_STILL_LEVEL, WORKING_TAIL } from '@seshboard/protocol/working-panel';

/** A grid cell's centre on the icon's 1024px canvas (`build/icon.svg`): the jacks sit 200px apart, the first at 312. */
const centreOf = (cell: number): readonly [number, number] => {
  const { row, col } = jackCell(cell);
  return [312 + col * 200, 312 + row * 200];
};
/** The free jacks' centres, in the order the light visits them. */
export const FREE_JACK_CENTRES: readonly (readonly [number, number])[] = FREE_JACK_CELLS.map(centreOf);
/** The plugged jacks: every other cell of the grid. */
const PLUGGED_CENTRES = Array.from({ length: PANEL_SIZE * PANEL_SIZE }, (_, cell) => cell)
  .filter((cell) => !FREE_JACK_CELLS.includes(cell))
  .map(centreOf);

/** How lit each free jack is (0–1) at `round` (0–1, wrapping) through a round: the lit jack full, its tail fading. */
export function workingLevels(round: number): number[] {
  const n = FREE_JACK_CELLS.length;
  const head = (((round % 1) + 1) % 1) * n;
  return FREE_JACK_CELLS.map((_, i) => {
    const behind = (((head - i) % n) + n) % n;
    return behind < WORKING_TAIL ? 1 - behind / WORKING_TAIL : 0;
  });
}
/** Reduce motion: every free jack lit the same, as the Dock's still frame. */
export const STILL_LEVELS: readonly number[] = FREE_JACK_CELLS.map(() => WORKING_STILL_LEVEL);

/** What the icon shows: sessions working, and sessions waiting on you (the badge's count). From the Notifier's `Attention`. */
export interface MenuBarCounts {
  working: number;
  needsYou: number;
}

export type MenuBarState = 'idle' | 'working' | 'needs-you';

/** Needs you wins: the count is what to act on. Working while nothing waits; idle otherwise. */
export const menuBarState = (counts: MenuBarCounts): MenuBarState => (counts.needsYou > 0 ? 'needs-you' : counts.working > 0 ? 'working' : 'idle');

/** About four frames a second: slower than the Dock's, to keep the menu bar light. A round still takes the shared time. */
export const TRAY_FRAME_MS = 250;
export const TRAY_FRAME_COUNT = Math.round(WORKING_ROUND_MS / TRAY_FRAME_MS);
/** The icon's size in points; it is drawn at 1x and 2x. */
export const TRAY_SIZE = 16;

/** How lit each free jack is in a tray frame: the shared round, in six steps. */
export const trayLevels = (frame: number): number[] => workingLevels(frame / TRAY_FRAME_COUNT);
/** Idle: rings only. */
export const IDLE_LEVELS: readonly number[] = FREE_JACK_CENTRES.map(() => 0);

/** The jacks' sizes on the icon's 1024px canvas (Round 53's menu bar icon): plugged solid, free a ring with a light inside. */
const JACK = 72;
const RING_WIDTH = 34;
const LIGHT = 44;
/** The canvas the 3×3 panel is drawn in: the icon without its frame. */
const VIEW = { from: 100, size: 824 };
/** Samples per pixel along each axis, for smooth edges at 16px. */
const SAMPLES = 4;

export interface Ink {
  r: number;
  g: number;
  b: number;
}
/** macOS colours a template image itself: black, with the shape in its alpha. */
export const TEMPLATE_INK: Ink = { r: 0, g: 0, b: 0 };
/** Windows and Linux: white on a dark taskbar, near-black on a light one. */
export const LIGHT_INK: Ink = { r: 0xff, g: 0xff, b: 0xff };
export const DARK_INK: Ink = { r: 0x1f, g: 0x21, b: 0x28 };
/** The dot that says something needs you on Windows (no title there): Demo Time's `warn`, as the taskbar's dot. */
const PINK: Ink = { r: 0xed, g: 0x21, b: 0x7c };

/** How much of a pixel a disc covers, from the samples inside it. */
function coverage(px: number, py: number, scale: number, inside: (x: number, y: number) => boolean): number {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      if (inside(VIEW.from + (px + (sx + 0.5) / SAMPLES) * scale, VIEW.from + (py + (sy + 0.5) / SAMPLES) * scale)) hits++;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

/**
 * One frame of the icon, `size` pixels square, as BGRA bytes for `nativeImage.createFromBitmap`: the plugged jacks
 * solid, the free ones rings that light up to their level (`levels`, in the light's order). `dot` puts the needs-you
 * dot in the bottom right corner (Windows).
 */
export function paintTrayIcon(size: number, levels: readonly number[], ink: Ink, dot = false): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = VIEW.size / size;
  // Each jack's shapes and how opaque they are: the light makes a free jack's ring stronger and fills its middle.
  const shapes: { x: number; y: number; outer: number; inner: number; alpha: number }[] = [
    ...PLUGGED_CENTRES.map(([x, y]) => ({ x, y, outer: JACK, inner: 0, alpha: 0.95 })),
    ...FREE_JACK_CENTRES.flatMap(([x, y], i) => {
      const level = Math.max(0, Math.min(1, levels[i] ?? 0));
      const ring = { x, y, outer: JACK + RING_WIDTH / 2, inner: JACK - RING_WIDTH / 2, alpha: 0.45 + 0.55 * level };
      return level > 0 ? [ring, { x, y, outer: LIGHT, inner: 0, alpha: level }] : [ring];
    }),
  ];
  const dotR = size * 0.24;
  const dotC = size - dotR - 0.25;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let alpha = 0;
      for (const shape of shapes) {
        // Only shapes near this pixel can cover it.
        const cx = (shape.x - VIEW.from) / scale;
        const cy = (shape.y - VIEW.from) / scale;
        if (Math.abs(px + 0.5 - cx) > shape.outer / scale + 1 || Math.abs(py + 0.5 - cy) > shape.outer / scale + 1) continue;
        const covered = coverage(px, py, scale, (x, y) => {
          const d = Math.hypot(x - shape.x, y - shape.y);
          return d <= shape.outer && d >= shape.inner;
        });
        // Over: shapes that overlap add up without passing full.
        alpha += covered * shape.alpha * (1 - alpha);
      }
      let color = ink;
      if (dot) {
        const d = Math.hypot(px + 0.5 - dotC, py + 0.5 - dotC);
        // A clear gap around the dot, so it reads against the jacks under it.
        if (d <= dotR + 1) alpha = 0;
        if (d <= dotR) {
          alpha = Math.min(1, dotR - d + 0.5);
          color = PINK;
        }
      }
      const i = (py * size + px) * 4;
      pixels[i] = color.b;
      pixels[i + 1] = color.g;
      pixels[i + 2] = color.r;
      pixels[i + 3] = Math.round(255 * alpha);
    }
  }
  return pixels;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The counts in words: "2 working · 1 needs you", or "Nothing running". */
export function countsLine(counts: MenuBarCounts, separator = ' · '): string {
  const parts = [counts.working > 0 ? `${counts.working} working` : null, counts.needsYou > 0 ? `${counts.needsYou} ${plural(counts.needsYou, 'needs', 'need')} you` : null].filter(Boolean);
  return parts.length ? parts.join(separator) : 'Nothing running';
}

/** The icon's tooltip, which names its state: "Seshboard: 3 working, 1 needs you". */
export const trayTooltip = (counts: MenuBarCounts): string => `Seshboard: ${countsLine(counts, ', ').replace(/^Nothing running$/, 'nothing running')}`;

/** macOS: the count next to the icon, as on the Dock's badge; empty at 0. Elsewhere the tooltip and the dot say it. */
export const trayTitle = (counts: MenuBarCounts, platform: NodeJS.Platform): string => (platform === 'darwin' && counts.needsYou > 0 ? String(counts.needsYou) : '');

/** The right-click menu (on Linux the only one, as a tray there can't open a panel): what main builds from. */
export type TrayMenuItem =
  | { kind: 'line'; label: string }
  | { kind: 'separator' }
  | { kind: 'action'; id: 'open' | 'new-session' | 'quit'; label: string }
  | { kind: 'pause'; label: string; choices: { id: NotificationPause | 'resume'; label: string }[] };

export function trayMenu(counts: MenuBarCounts, paused: boolean): TrayMenuItem[] {
  return [
    { kind: 'line', label: countsLine(counts) },
    { kind: 'separator' },
    { kind: 'action', id: 'open', label: 'Open Seshboard' },
    { kind: 'action', id: 'new-session', label: 'New session…' },
    { kind: 'pause', label: 'Pause notifications', choices: [...NOTIFICATION_PAUSES.map(({ id, label }) => ({ id, label })), ...(paused ? [{ id: 'resume' as const, label: 'Resume notifications' }] : [])] },
    { kind: 'separator' },
    { kind: 'action', id: 'quit', label: 'Quit Seshboard' },
  ];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The panel is as tall as what it shows, up to 70% of the screen. */
export const PANEL_WIDTH = 380;
export const panelHeight = (content: number, workArea: Rect): number => Math.max(120, Math.min(Math.ceil(content), Math.floor(workArea.height * 0.7)));

/**
 * Where the panel goes: under the icon in the menu bar (macOS), above it on a taskbar at the bottom (Windows), and
 * under it on one at the top. Centred on the icon, and kept 8px inside the screen's work area.
 */
export function panelPosition(tray: Rect, size: { width: number; height: number }, workArea: Rect): { x: number; y: number } {
  const gap = 6;
  const margin = 8;
  const below = tray.y + tray.height / 2 < workArea.y + workArea.height / 2;
  const left = Math.round(tray.x + tray.width / 2 - size.width / 2);
  const x = Math.max(workArea.x + margin, Math.min(left, workArea.x + workArea.width - size.width - margin));
  const y = below ? Math.max(workArea.y + gap, tray.y + tray.height + gap) : Math.min(tray.y, workArea.y + workArea.height) - size.height - gap;
  return { x, y };
}

/**
 * Whether closing the last window quits the app. macOS never does (the app stays in the Dock or the menu bar);
 * Windows and Linux do unless Keep running when the window closes is on.
 */
export const quitsWhenAllClosed = (platform: NodeJS.Platform, keepRunning: boolean): boolean => platform !== 'darwin' && !keepRunning;

export interface MenuBarHost<Image> {
  readonly platform: NodeJS.Platform;
  /** Puts the icon in the menu bar with its first image (a new `Tray`). */
  show(image: Image): void;
  /** Takes the icon away (`tray.destroy()`). */
  hide(): void;
  setImage(image: Image): void;
  setTitle(title: string): void;
  setToolTip(text: string): void;
  /** The counts changed: the right-click menu's lines say them. */
  setMenu(counts: MenuBarCounts): void;
  /** An image from frames at 1x and 2x; `template` lets macOS colour it. */
  image(frames: { bitmap: Buffer; size: number; scale: number }[], template: boolean): Image;
  /** System Settings › Accessibility › Display › Reduce motion. */
  reducedMotion(): boolean;
  /** Windows and Linux: whether the taskbar is dark, for the icon's ink. */
  darkTaskbar(): boolean;
  /** Calls `tick` every `ms` until the returned function is called. */
  every(ms: number, tick: () => void): () => void;
}

/**
 * Settings › General › Menu bar › Show in the menu bar: the icon, its three states (idle, working, needs you) and its
 * count, from the same `Attention` as the Dock and the badge (the Notifier says when they change). It animates only
 * while something works, and swaps images with `setImage` at four frames a second.
 */
export class MenuBar<Image> {
  #enabled = false;
  #counts: MenuBarCounts = { working: 0, needsYou: 0 };
  #visible = false;
  #frame = 0;
  #stop: (() => void) | null = null;
  #images = new Map<string, Image>();
  #shown = 0;

  constructor(private readonly host: MenuBarHost<Image>) {}

  get visible(): boolean {
    return this.#visible;
  }

  get state(): MenuBarState {
    return menuBarState(this.#counts);
  }

  get counts(): MenuBarCounts {
    return this.#counts;
  }

  /** Whether the light moves right now. */
  get animating(): boolean {
    return this.#stop !== null;
  }

  /** Images put in the menu bar so far, for the smoke test. */
  get shown(): number {
    return this.#shown;
  }

  /** The setting, at launch and on every change. */
  setEnabled(on: boolean): void {
    this.#enabled = on;
    this.#update();
  }

  /** After every change the Notifier sees. */
  setCounts(counts: MenuBarCounts): void {
    if (counts.working === this.#counts.working && counts.needsYou === this.#counts.needsYou) return;
    this.#counts = { ...counts };
    this.#update();
  }

  /** The system's appearance or Reduce motion changed: frames are drawn again. */
  refresh(): void {
    this.#images.clear();
    if (!this.#visible) return;
    this.#stopTimer();
    this.#update();
  }

  #update(): void {
    if (!this.#enabled) {
      this.#stopTimer();
      if (this.#visible) this.host.hide();
      this.#visible = false;
      return;
    }
    const moving = this.#counts.working > 0 && !this.host.reducedMotion();
    const image = moving ? this.#movingImage(this.#frame) : this.#stillImage();
    if (!this.#visible) {
      this.host.show(image);
      this.#visible = true;
    } else if (!moving || !this.#stop) this.host.setImage(image);
    this.#shown++;
    this.host.setTitle(trayTitle(this.#counts, this.host.platform));
    this.host.setToolTip(trayTooltip(this.#counts));
    this.host.setMenu(this.#counts);
    if (moving && !this.#stop) this.#stop = this.host.every(TRAY_FRAME_MS, () => this.#tick());
    else if (!moving) this.#stopTimer();
  }

  #tick(): void {
    this.#frame = (this.#frame + 1) % TRAY_FRAME_COUNT;
    this.host.setImage(this.#movingImage(this.#frame));
    this.#shown++;
  }

  #stopTimer(): void {
    this.#stop?.();
    this.#stop = null;
    this.#frame = 0;
  }

  /** Idle and needs you without work: rings only. Working with Reduce motion: one frame with the free jacks lit. */
  #stillImage(): Image {
    return this.#cached('still', this.#counts.working > 0 ? STILL_LEVELS : IDLE_LEVELS);
  }

  #movingImage(frame: number): Image {
    return this.#cached(`frame-${frame}`, trayLevels(frame));
  }

  #cached(name: string, levels: readonly number[]): Image {
    const mac = this.host.platform === 'darwin';
    // Windows has no title next to the icon: a dot on it says something needs you.
    const dot = !mac && this.#counts.needsYou > 0;
    const key = `${name}:${levels.join(',')}:${dot}`;
    const cached = this.#images.get(key);
    if (cached) return cached;
    const ink = mac ? TEMPLATE_INK : this.host.darkTaskbar() ? LIGHT_INK : DARK_INK;
    const image = this.host.image(
      [1, 2].map((scale) => ({ bitmap: paintTrayIcon(TRAY_SIZE * scale, levels, ink, dot), size: TRAY_SIZE * scale, scale })),
      mac,
    );
    this.#images.set(key, image);
    return image;
  }
}
