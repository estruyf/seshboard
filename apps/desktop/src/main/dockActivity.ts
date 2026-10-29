/**
 * The Dock's icon while Claude works (macOS): the patch panel's empty jacks light up one after another, like activity
 * lights, with a short fading tail, and a pulse of light runs along each cable from plug to plug. Frames are drawn from the chosen colourway's own Dock file, so every colourway
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
/** Frames for each jack: the light moves on every fourth frame, and the jacks behind it fade in between. */
export const JACK_STEPS = 4;
export const FRAME_COUNT = FREE_JACKS.length * JACK_STEPS;
/** How many jacks the tail reaches back over. */
const TAIL = 2.4;
/** About 13 frames a second, so the cables' pulse runs smoothly: one round of the five jacks takes 1.5 seconds. */
export const FRAME_MS = 75;
/** The size the frames are drawn at: the Dock's largest (128pt, magnified, on a Retina screen) and then some. */
export const FRAME_SIZE = 512;

/** An amber light with a hotter centre, the same on every colourway: the holes are dark on all of them. */
const AMBER = { r: 0xff, g: 0x96, b: 0x1a };
const HOT = { r: 0xff, g: 0xfb, b: 0xec };

/**
 * The two cables (`build/icon.svg`, 1024px canvas): their curves, stroke widths, and where in a round each pulse
 * starts. Both run top to bottom like the jacks' light, half a round apart, so one of them is always lit.
 */
const CABLES: readonly { curve: readonly [number, number][]; width: number; phase: number }[] = [
  { curve: [[312, 312], [300, 650], [680, 700], [712, 512]], width: 46, phase: 0 },
  { curve: [[312, 712], [330, 838], [494, 838], [512, 712]], width: 44, phase: 0.5 },
];
/** The plugs at the cables' ends. */
const PLUG = 46;
/** How far before the first plug and past the last a pulse starts and ends, as a share of its cable, so it comes in and goes out. */
const PULSE_OUTSIDE = 0.2;
/** The pulse's length along its cable (a share of the cable), and the light it adds at its brightest (of 255). */
const PULSE_LENGTH = 0.13;
const PULSE_LIGHT = 115;

/** How lit each jack is (0–1) in a frame: the one the light is on is full, the two before it fade. */
export function jackLevels(frame: number): number[] {
  const n = FREE_JACKS.length;
  const head = (((frame % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT) / JACK_STEPS;
  return FREE_JACKS.map((_, i) => {
    const behind = (((head - i) % n) + n) % n;
    return behind < TAIL ? 1 - behind / TAIL : 0;
  });
}

/**
 * Where each cable's pulse is in a frame: 0 at its first plug, 1 at its last, a little outside both while it comes in
 * and goes out.
 */
export function cableHeads(frame: number): number[] {
  const round = (((frame % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT) / FRAME_COUNT;
  return CABLES.map((cable) => -PULSE_OUTSIDE + ((round + cable.phase) % 1) * (1 + 2 * PULSE_OUTSIDE));
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

/** A cable's pixels at one size: where each is along the cable (0–1 by length, a plug takes its end) and how much of it is cable. */
interface CablePixels {
  index: Int32Array;
  along: Float32Array;
  weight: Float32Array;
}

let cablePixels: { size: number; cables: CablePixels[] } | null = null;

/** The cables' pixels at `size`, worked out once: the frames all share them. */
function cablesAt(size: number): CablePixels[] {
  if (cablePixels?.size !== size) cablePixels = { size, cables: CABLES.map((cable) => cablePixelsAt(cable.curve, cable.width / 2, size)) };
  return cablePixels.cables;
}

function cablePixelsAt(curve: readonly [number, number][], halfWidth: number, size: number): CablePixels {
  const scale = size / 1024;
  const [a, b, c, d] = curve as [[number, number], [number, number], [number, number], [number, number]];
  const samples = 400;
  const points = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const u = 1 - t;
    const at = (k: 0 | 1) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k];
    return { x: at(0) * scale - 0.5, y: at(1) * scale - 0.5 };
  });
  const lengths = [0];
  for (let i = 1; i <= samples; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = lengths[samples]!;

  // Each pixel near the cable takes the nearest point on it: where along, and how deep inside the stroke.
  const found = new Map<number, { along: number; weight: number }>();
  const visit = (cx: number, cy: number, radius: number, each: (index: number, distance: number) => void) => {
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(size - 1, Math.ceil(cy + radius)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(size - 1, Math.ceil(cx + radius)); x++) each(y * size + x, Math.hypot(x - cx, y - cy));
    }
  };
  const stroke = halfWidth * scale;
  const nearest = new Map<number, { distance: number; along: number }>();
  points.forEach((point, i) => visit(point.x, point.y, stroke, (index, distance) => {
    const seen = nearest.get(index);
    if (distance < stroke && (!seen || distance < seen.distance)) nearest.set(index, { distance, along: lengths[i]! / total });
  }));
  // A soft edge, so the cable keeps its outline.
  for (const [index, { distance, along }] of nearest) found.set(index, { along, weight: Math.min(1, (stroke - distance) / (stroke * 0.35)) });
  // The plugs light up as the pulse goes in and out of them.
  const plug = PLUG * scale;
  for (const [end, point] of [[0, points[0]!], [1, points[samples]!]] as const) {
    visit(point.x, point.y, plug, (index, distance) => {
      const weight = Math.min(1, (plug - distance) / (10 * scale));
      if (weight > (found.get(index)?.weight ?? 0)) found.set(index, { along: end, weight });
    });
  }

  const pixels = { index: new Int32Array(found.size), along: new Float32Array(found.size), weight: new Float32Array(found.size) };
  let i = 0;
  for (const [index, { along, weight }] of found) {
    pixels.index[i] = index;
    pixels.along[i] = along;
    pixels.weight[i++] = weight;
  }
  return pixels;
}

/**
 * A frame: a copy of the icon's pixels (BGRA, `size` square, as `nativeImage.toBitmap()` gives them on macOS) with
 * each jack lit to its level, and each cable's pulse at its place along it (`cableHeads`; none when left out). Only
 * the jacks and the cables are touched; the rest is the icon as it is.
 */
export function paintFrame(base: Buffer, size: number, levels: readonly number[], heads: readonly number[] = []): Buffer {
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
  // The pulse adds white light, so each cable stays its own colour, only brighter; the jacks are clear of the cables.
  cablesAt(size).forEach((cable, k) => {
    const head = heads[k];
    if (head === undefined) return;
    for (let j = 0; j < cable.index.length; j++) {
      const a = Math.exp(-(((cable.along[j]! - head) / PULSE_LENGTH) ** 2)) * cable.weight[j]!;
      if (a < 0.01) continue;
      const i4 = cable.index[j]! * 4;
      // Premultiplied, as above: no more light than the pixel's alpha holds.
      const alpha = out[i4 + 3]!;
      const light = PULSE_LIGHT * a * (alpha / 255);
      for (let ch = 0; ch < 3; ch++) out[i4 + ch] = Math.min(alpha, Math.round(out[i4 + ch]! + light));
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
    // Reduce motion: the jacks lit, and no pulse on the cables.
    const paint = still ? [paintFrame(base, FRAME_SIZE, STILL_LEVELS)] : Array.from({ length: FRAME_COUNT }, (_, frame) => paintFrame(base, FRAME_SIZE, jackLevels(frame), cableHeads(frame)));
    this.#frames = { file, still, images: paint.map((bitmap) => this.host.image(bitmap, FRAME_SIZE)) };
    return this.#frames;
  }
}
