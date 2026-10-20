/** A seeded random source (mulberry32), so a run can be replayed exactly from its seed. */
export class Rng {
  private state: number;
  readonly seed: number;
  constructor(seed: number) {
    this.seed = seed;
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Picks by weight: [[weight, value], …]. */
  weighted<T>(items: ReadonlyArray<readonly [number, T]>): T {
    const total = items.reduce((sum, [w]) => sum + w, 0);
    let r = this.next() * total;
    for (const [w, v] of items) {
      if ((r -= w) <= 0) return v;
    }
    return items[items.length - 1]![1];
  }
}
