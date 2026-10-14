/**
 * a. The monkey: a seeded random walk over everything on screen, with the invariant checks every 25 steps.
 */
import { expensiveChecks, unstick } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { monkeyStep } from '../lib/monkey.ts';
import { setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const monkey: Phase = async (c, { actions }) => {
  await setUp(c);
  await c.sampleMemory();
  for (let i = 0; i < actions; i++) {
    try {
      await monkeyStep(c);
    } catch (e) {
      c.log('step-error', String((e as Error).message).slice(0, 200));
    }
    await sleep(c.rng.int(20, 160));
    if (i % 25 === 24) {
      await unstick(c);
      await expensiveChecks(c);
    }
    if (i % 100 === 99) console.log(`  ${i + 1} actions, ${c.signals.length} signals`);
  }
};
