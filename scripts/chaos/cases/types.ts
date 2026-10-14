import type { Chaos } from '../lib/harness.ts';

/** What a case saw, and whether the app did what `expect` says. */
export interface Verdict {
  ok: boolean;
  saw: unknown;
}

/**
 * A minimal reproduction with a verdict. `ok: true` means the app behaves as `expect` says: for a case that shows a
 * problem, that it is fixed; for a check (`finding: 'check'` or an old ID), that it still holds.
 */
export interface Case {
  /** The finding this case shows (an ID from the chaos hunt report, `CE1`), an older one it guards (`D1`), or `check`. */
  finding: string;
  /** What the app should do, in a sentence. */
  expect: string;
  /** Changes the sandbox in a way later cases could notice (they run in this order in one app unless `--fresh`). */
  mutates?: boolean;
  run(c: Chaos, note: (label: string, value: unknown) => void): Promise<Verdict>;
}
