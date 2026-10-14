import type { Chaos } from '../lib/harness.ts';

export interface PhaseOptions {
  /** How many random steps a monkey or mixed run takes. */
  actions: number;
  /** Only these repro cases (`--case a,b`), or all of them. */
  cases: string[] | null;
}

/** One kind of run: it gets a launched app in a fresh sandbox, and its signals are what it found. */
export type Phase = (c: Chaos, options: PhaseOptions) => Promise<void>;
