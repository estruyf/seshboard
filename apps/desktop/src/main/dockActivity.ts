/**
 * The Dock's icon while Claude works (macOS): the patch panel's empty jacks light up one after another, like activity
 * lights, with a short fading tail. Frames are drawn from the chosen colourway's own Dock file, so every colourway
 * gets them, and no image ships for them. The painting is pure, for testing; `DockActivity` gets Electron through a host.
 */

/** The icon's empty jacks in reading order, as fractions of the 1024px macOS canvas (`build/icon.svg`). */
export const FREE_JACKS: readonly { x: number; y: number }[] = [
  [512, 312],
  [712, 312],
  [312, 512],
  [512, 512],
  [712, 712],
].map(([x, y]) => ({ x: x! / 1024, y: y! / 1024 }));

/** A jack's dark hole, and its ring, as fractions of the canvas. */
const HOLE = 34 / 1024;
const RING = 62 / 1024;
/** Frames for each jack: the light moves on every third frame, and the jacks behind it fade in between. */
const STEPS = 3;
export const FRAME_COUNT = FREE_JACKS.length * STEPS;
/** How many jacks the tail reaches back over. */
const TAIL = 2.4;
/** Frames a second: one round of the five jacks takes 1.5 seconds. */
export const FRAME_MS = 100;
/** The size the frames are drawn at: the Dock's largest (128pt, magnified, on a Retina screen) and then some. */
export const FRAME_SIZE = 512;

/** An amber light with a hotter centre, the same on every colourway: the holes are dark on all of them. */
const AMBER = { r: 0xff, g: 0x96, b: 0x1a };
const HOT = { r: 0xff, g: 0xfb, b: 0xec };

/** How lit each jack is (0–1) in a frame: the one the light is on is full, the two before it fade. */
export function jackLevels(frame: number): number[] {
  const n = FREE_JACKS.length;
  const head = (((frame % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT) / STEPS;
  return FREE_JACKS.map((_, i) => {
    const behind = (((head - i) % n) + n) % n;
    return behind < TAIL ? 1 - behind / TAIL : 0;
  });
}

/** With Reduce motion on: no movement, every empty jack lit, so the Dock still says Claude is working. */
export const STILL_LEVELS: readonly number[] = FREE_JACKS.map(() => 0.75);

/**
 * How much light covers a point `t` hole radii from a jack's centre: a solid light in the middle of the hole that
 * softens to its rim, then a glow on the ring that fades out before the ring's edge. No hard edge, so no antialiasing.
 */
function cover(t: number): number {
  const ring = RING / HOLE;
  if (t <= 0.75) return 1;
  if (t <= 1) return 1 - ((t - 0.75) / 0.25) * 0.4;
  if (t <= ring) return 0.6 * (1 - (t - 1) / (ring - 1)) ** 1.6;
  return 0;
}

/**
 * A frame: a copy of the icon's pixels (BGRA, `size` square, as `nativeImage.toBitmap()` gives them on macOS) with
 * each jack lit to its level. Only the jacks' squares are touched; the rest is the icon as it is.
 */
export function paintFrame(base: Buffer, size: number, levels: readonly number[]): Buffer {
  const out = Buffer.from(base);
  const hole = HOLE * size;
  const reach = Math.ceil(RING * size);
  FREE_JACKS.forEach((jack, i) => {
    const level = levels[i] ?? 0;
    if (level <= 0) return;
    const cx = jack.x * size - 0.5;
    const cy = jack.y * size - 0.5;
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(size - 1, Math.ceil(cy + reach)); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(size - 1, Math.ceil(cx + reach)); x++) {
        const t = Math.hypot(x - cx, y - cy) / hole;
        const a = level * cover(t);
        if (a <= 0) continue;
        // White-hot in the middle, amber towards the rim.
        const hot = Math.max(0, 1 - t / 0.7) ** 0.7;
        const i4 = (y * size + x) * 4;
        // The icon's pixels are premultiplied: the light is scaled by the pixel's own alpha (opaque on the panel).
        const alpha = out[i4 + 3]! / 255;
        const mix = (base: number, amber: number, white: number) => Math.round(base + ((amber + (white - amber) * hot) * alpha - base) * a);
        out[i4] = mix(out[i4]!, AMBER.b, HOT.b);
        out[i4 + 1] = mix(out[i4 + 1]!, AMBER.g, HOT.g);
        out[i4 + 2] = mix(out[i4 + 2]!, AMBER.r, HOT.r);
      }
    }
  });
  return out;
}

/** What `DockActivity` needs from Electron, so a test can stand in for it. */
export interface DockActivityHost<Image> {
  /** The chosen colourway's 1024px Dock file, or undefined when the build has none. */
  file(): string | undefined;
  /** The file's pixels at `size` square (BGRA), or undefined when it can't be read. */
  bitmap(file: string, size: number): Buffer | undefined;
  image(bitmap: Buffer, size: number): Image;
  show(image: Image): void;
  /** Back to the still icon, the colourway Settings › Theme › App icon set. */
  restore(): void;
  /** System Settings › Accessibility › Display › Reduce motion. */
  reducedMotion(): boolean;
  /** Calls `tick` every `ms` until the returned function is called. */
  every(ms: number, tick: () => void): () => void;
}

/**
 * Settings › Theme › App icon › Show when Claude is working: animates the Dock's icon while a session works (main's
 * Notifier says when), and puts the colourway back when none does. The frames are made when the animation starts and
 * let go when it stops, so they take no memory while nothing works.
 */
export class DockActivity<Image> {
  #enabled = true;
  #working = false;
  /** The smoke test shows the animation without a session working. */
  #held = false;
  #frames: { file: string; still: boolean; images: Image[] } | null = null;
  #frame = 0;
  #stop: (() => void) | null = null;
  #showing = false;
  #shown = 0;

  constructor(private readonly host: DockActivityHost<Image>) {}

  /** Whether the Dock shows the activity right now (animated, or still with Reduce motion). */
  get showing(): boolean {
    return this.#showing;
  }

  /** Frames put in the Dock so far, for the smoke test. */
  get shown(): number {
    return this.#shown;
  }

  /** The setting, at launch and on every change. */
  setEnabled(on: boolean): void {
    this.#enabled = on;
    this.#update();
  }

  /** Whether a session works, after every change the Notifier sees. */
  setWorking(working: boolean): void {
    this.#working = working;
    this.#update();
  }

  /** The smoke test: shows the activity as if a session worked, until released. */
  hold(on: boolean): void {
    this.#held = on;
    this.#update();
  }

  /** Another colourway was chosen: the next frame is drawn from it (Reduce motion's still one at once). */
  iconChanged(): void {
    if (this.#showing && !this.#stop) this.#tick();
  }

  #update(): void {
    const want = this.#enabled && (this.#working || this.#held);
    if (want && !this.#showing) this.#start();
    else if (!want && this.#showing) this.#end();
  }

  #start(): void {
    this.#showing = true;
    this.#frame = 0;
    this.#tick();
    // Reduce motion: the still frame stays until the work is done.
    if (!this.#frames?.still) this.#stop = this.host.every(FRAME_MS, () => this.#tick());
  }

  #end(): void {
    this.#stop?.();
    this.#stop = null;
    this.#showing = false;
    this.#frames = null;
    this.host.restore();
  }

  #tick(): void {
    const frames = this.#framesFor(this.host.file());
    if (!frames) return;
    const image = frames.images[this.#frame % frames.images.length]!;
    this.#frame = (this.#frame + 1) % FRAME_COUNT;
    this.host.show(image);
    this.#shown++;
  }

  /** The frames for the colourway's file, made again when the colourway or Reduce motion changed. */
  #framesFor(file: string | undefined): { images: Image[]; still: boolean } | null {
    if (!file) return null;
    const still = this.host.reducedMotion();
    if (this.#frames?.file === file && this.#frames.still === still) return this.#frames;
    const base = this.host.bitmap(file, FRAME_SIZE);
    if (!base) return null;
    const levels = still ? [STILL_LEVELS] : Array.from({ length: FRAME_COUNT }, (_, frame) => jackLevels(frame));
    this.#frames = { file, still, images: levels.map((level) => this.host.image(paintFrame(base, FRAME_SIZE, level), FRAME_SIZE)) };
    return this.#frames;
  }
}
