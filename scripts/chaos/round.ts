/**
 * A round of chaos (docs/chaos-testing.md): monkey and mixed runs, and with --targeted every targeted phase, each in
 * its own app and sandbox, a few at a time. At the end it lists the signal groups first seen in this round.
 *
 *   node scripts/chaos/round.ts --seed 7000 [--monkeys 4] [--mixes 1] [--targeted] [--parallel 3] [--actions 2500] [--out dir]
 *
 * Seeds: monkeys seed..seed+N-1, mixes seed+100…, targeted phases seed+200. `npm run chaos:round -- …` builds first.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultOutDir } from './lib/harness.ts';
import { groupSignals, printGroups } from './triage.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1]!;
};
const seed = Number(arg('seed', String(Date.now() % 90_000)));
const monkeys = Number(arg('monkeys', '4'));
const mixes = Number(arg('mixes', '1'));
const parallel = Math.max(1, Number(arg('parallel', '3')));
const actions = arg('actions', '2500');
const outDir = arg('out', defaultOutDir());
mkdirSync(outDir, { recursive: true });

const TARGETED = ['speed', 'fuzz', 'editors', 'world', 'process', 'window', 'edges', 'persist', 'corrupt', 'leak', 'scale'];
const runs: Array<{ phase: string; seed: number }> = [
  ...Array.from({ length: monkeys }, (_, i) => ({ phase: 'monkey', seed: seed + i })),
  ...Array.from({ length: mixes }, (_, i) => ({ phase: 'mix', seed: seed + 100 + i })),
  ...(args.includes('--targeted') ? TARGETED.map((phase) => ({ phase, seed: seed + 200 })) : []),
];
const tags = runs.map((r) => `${r.phase}-${r.seed}`);

/** One run as a child process, its output in <out>/<phase>-<seed>.log. */
function start(run: { phase: string; seed: number }): Promise<number> {
  const log = createWriteStream(join(outDir, `${run.phase}-${run.seed}.log`));
  const child = spawn(process.execPath, [join(import.meta.dirname, 'run.ts'), '--phase', run.phase, '--seed', String(run.seed), '--actions', actions, '--out', outDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  console.log(`started ${run.phase} ${run.seed}`);
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

const queue = [...runs];
const codes = new Map<string, number>();
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let run = queue.shift(); run; run = queue.shift()) {
      const code = await start(run);
      codes.set(`${run.phase}-${run.seed}`, code);
      console.log(`finished ${run.phase} ${run.seed} (exit ${code})`);
      // A safety stop in one run stops the round.
      if (code === 3) {
        console.error('A run found real data on screen or in the profile and stopped; stopping the round.');
        process.exit(3);
      }
    }
  }),
);

console.log('\nRuns:');
for (const tag of tags) {
  let summary: { actions?: number; signals?: number; error?: string | null } = {};
  try {
    summary = JSON.parse(readFileSync(join(outDir, `${tag}.summary.json`), 'utf8'));
  } catch {
    // The run stopped before writing one; its log says why.
  }
  console.log(`  ${tag.padEnd(16)} exit ${codes.get(tag)}  ${summary.actions ?? '?'} actions, ${summary.signals ?? '?'} signals${summary.error ? `, stopped: ${summary.error.split('\n')[0]}` : ''}`);
}
const fresh = new RegExp(`^(${tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`);
const groups = groupSignals(outDir, { firstIn: fresh, quiet: true });
console.log(`\n${groups.length} signal groups first seen in this round (node scripts/chaos/triage.ts ${outDir} for all):`);
printGroups(groups);
