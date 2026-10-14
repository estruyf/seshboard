/**
 * The repro cases (cases/), each with a verdict: PASS when the app does what the case expects, FAIL while the problem
 * it shows is still there. The verdicts go to `<phase>-<seed>.results.json`; a failing case makes the run exit 1.
 */
import { writeFileSync } from 'node:fs';
import { CASES } from '../cases/index.ts';
import { goHome, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export interface CaseResult {
  name: string;
  finding: string;
  expect: string;
  ok: boolean;
  saw: unknown;
  notes: Record<string, unknown>;
  ms: number;
}

export const repro: Phase = async (c, { cases }) => {
  const unknown = (cases ?? []).filter((name) => !CASES[name]);
  if (unknown.length) throw new Error(`no such case: ${unknown.join(', ')}; the cases are ${Object.keys(CASES).join(', ')}`);
  await setUp(c);
  const results: CaseResult[] = [];
  for (const [name, test] of Object.entries(CASES)) {
    if (cases && !cases.includes(name)) continue;
    const notes: Record<string, unknown> = {};
    const note = (label: string, value: unknown) => {
      notes[label] = value;
      c.log('case-note', `${name}: ${label}`, value);
    };
    c.log('case', name, test.expect);
    const t0 = Date.now();
    let verdict: { ok: boolean; saw: unknown };
    try {
      verdict = await test.run(c, note);
    } catch (error) {
      verdict = { ok: false, saw: `threw: ${String((error as Error).message ?? error).slice(0, 300)}` };
    }
    results.push({ name, finding: test.finding, expect: test.expect, ...verdict, notes, ms: Date.now() - t0 });
    console.log(`  ${verdict.ok ? 'PASS' : 'FAIL'} ${name} (${test.finding}): ${test.expect}`);
    if (!verdict.ok) console.log(`       saw ${JSON.stringify(verdict.saw).slice(0, 300)}`);
    await goHome(c).catch(() => {});
  }
  writeFileSync(c.logFile('results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`  ${results.length - failed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
};
