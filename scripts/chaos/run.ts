/**
 * One chaos run: the built app in a fresh sandbox, one phase, one seed (docs/chaos-testing.md).
 *
 *   node scripts/chaos/run.ts --phase monkey [--seed 1001] [--actions 2500] [--out dir]
 *   node scripts/chaos/run.ts --phase repro [--case deadWarm,fileAsFolder] [--fresh]
 *   node scripts/chaos/run.ts --list
 *
 * `npm run chaos -- …` builds the app first. Artefacts go to tests/chaos-hunt-<today>/runs (git ignores them).
 * macOS only for now.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from './cases/index.ts';
import { Chaos, defaultOutDir, repoRoot, writesOutsideSandbox } from './lib/harness.ts';
import { PHASES } from './phases/index.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

if (args.includes('--list') || args.includes('--help')) {
  console.log('Phases (--phase):');
  for (const [name, { about }] of Object.entries(PHASES)) console.log(`  ${name.padEnd(8)} ${about}`);
  console.log('\nRepro cases (--phase repro --case a,b):');
  for (const [name, c] of Object.entries(CASES)) console.log(`  ${name.padEnd(22)} ${c.finding.padEnd(6)} ${c.expect}`);
  process.exit(0);
}
if (process.platform !== 'darwin') {
  console.error('The chaos harness runs on macOS only (it uses ps, /usr/bin/git and /private/tmp, and the fakes are shell scripts).');
  process.exit(2);
}
if (!existsSync(join(repoRoot, 'apps', 'desktop', 'out', 'main', 'index.js'))) {
  console.error('Build the app first: npm run build -w @switchboard/desktop (npm run chaos does it for you).');
  process.exit(2);
}

const phase = arg('phase', 'monkey')!;
const seed = Number(arg('seed', String(Date.now() % 100_000)));
const actions = Number(arg('actions', '1000'));
const cases = arg('case')?.split(',') ?? null;
const outDir = arg('out', defaultOutDir())!;
mkdirSync(outDir, { recursive: true });
const entry = PHASES[phase];
if (!entry) {
  console.error(`No phase "${phase}". The phases: ${Object.keys(PHASES).join(', ')} (--list says what each does).`);
  process.exit(2);
}

/** One app, one sandbox, one phase. Returns false when the run stopped on an error. */
async function runOnce(runSeed: number, only: string[] | null): Promise<boolean> {
  console.log(`phase ${phase} seed ${runSeed}${only ? ` (${only.join(', ')})` : ''}`);
  const chaos = new Chaos({ seed: runSeed, phase, outDir });
  const started = Date.now();
  let error: string | null = null;
  try {
    await chaos.launch();
    console.log(`  sandbox ${chaos.world.root}, engine pid ${chaos.enginePid}`);
    await entry!.run(chaos, { actions, cases: only });
    await chaos.pollPage();
    const outside = writesOutsideSandbox(chaos.world.root);
    if (outside.length) chaos.signal('write-outside-sandbox', outside.join(', '));
  } catch (e) {
    error = (e as Error).stack ?? String(e);
    console.error(`  ✗ ${error}`);
    // A real home folder, user name or app data on screen: stop everything.
    if (/^Error: SAFETY/.test(error)) process.exit(3);
  } finally {
    await chaos.close().catch(() => {});
    if (chaos.world) chaos.destroyWorld();
  }
  const summary = { phase, seed: runSeed, ms: Date.now() - started, actions: chaos.actionCount, engineRestarts: chaos.engineRestarts, signals: chaos.signals.length, error };
  writeFileSync(chaos.logFile('summary.json'), JSON.stringify({ ...summary, memory: chaos.memory, signalList: chaos.signals }, null, 1));
  console.log(JSON.stringify(summary));
  return error === null;
}

// --fresh: every repro case in its own app and sandbox, so no case sees what another changed.
const fresh = phase === 'repro' && args.includes('--fresh');
const names = fresh ? (cases ?? Object.keys(CASES)) : [null];
let allRan = true;
for (const [i, name] of names.entries()) allRan = (await runOnce(fresh ? seed + i : seed, name ? [name] : cases)) && allRan;
if (!allRan) process.exitCode = 1;
