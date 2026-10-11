/**
 * Launches the built app in smoke mode, which drives the real UI step by step (see `runSmokeStep` in
 * src/main/index.ts), then prints each step's result and how long it took.
 * Usage: npm run smoke (builds first). Writes .smoke/*.png and .smoke/result.json.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

interface StepResult {
  label: string;
  result: string;
  ok: boolean;
  ms: number;
}

const appDir = join(import.meta.dirname, '..');
const outDir = join(appDir, '.smoke');
rmSync(outDir, { recursive: true, force: true });

// --packaged runs the built app (npm run dist) instead of the development build: Switchboard.app, or on Windows
// the unpacked folder for this PC's architecture.
const packaged = process.argv.includes('--packaged');
const packagedApp = () =>
  process.platform === 'win32'
    ? join(appDir, 'dist', process.arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked', 'Switchboard.exe')
    : join(appDir, 'dist', 'mac-arm64', 'Switchboard.app', 'Contents', 'MacOS', 'Switchboard');
const command = packaged ? packagedApp() : (createRequire(import.meta.url)('electron') as unknown as string);
const started = performance.now();
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(command, packaged ? [] : [appDir], {
  env: { ...childEnv, SWITCHBOARD_SMOKE_OUT: outDir, ELECTRON_ENABLE_LOGGING: '0' },
  stdio: 'inherit',
});

const code: number = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
const resultFile = join(outDir, 'result.json');
if (!existsSync(resultFile)) {
  console.error(`✗ smoke test failed: app exited with code ${code} before writing any results`);
  process.exit(1);
}
if (code !== 0) {
  console.error(`✗ smoke test failed: app exited with code ${code}${code === 2 ? ' (the watchdog stopped a run that hung)' : ''}`);
  process.exitCode = 1;
}

const result = JSON.parse(readFileSync(resultFile, 'utf8'));
const steps = result.steps as StepResult[];
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
console.log('');
if (result.connectedMs !== null) console.log(`✓ UI talking to the engine ${result.connectedMs}ms after process start (diagnostics loaded at ${result.loadedMs}ms)`);
// Steps skipped after a timeout are counted, not listed one by one.
const skipped = steps.filter((step) => step.result === 'not run');
for (const step of steps) if (step.result !== 'not run') console.log(`${step.ok ? '✓' : '✗'} ${step.label}: ${step.result}  ${seconds(step.ms)}`);
const failed = steps.filter((step) => !step.ok);
if (failed.length || !steps.length) process.exitCode = 1;
if (result.stoppedBy) console.log(`✗ the run stopped after "${result.stoppedBy}" took too long; ${skipped.length} steps after it did not run`);
console.log(`  rendering on screen: ${JSON.stringify(result.rendering)}`);
if (result.notifications.length) console.log(`  notifications: ${result.notifications.map((n: { kind: string; title: string; suppressed: boolean }) => `${n.kind} "${n.title}"${n.suppressed ? ' (suppressed: you were looking)' : ''}`).join('; ')}`);
console.log(`  slowest: ${(result.slowest as StepResult[]).map((step) => `${step.label.split(':')[0]} ${seconds(step.ms)}`).join(', ')}`);
if (result.reports[0]) console.log(`  claude ${result.reports[0].claudeVersion ?? 'not found'} · engine ping ${result.reports[0].pingMs}ms · electron ${result.versions.electron}`);
if (packaged) console.log('  (packaged app)');
console.log(`${failed.length ? `✗ ${failed.length} of ${steps.length} steps failed` : `✓ all ${steps.length} steps passed`} in ${seconds(performance.now() - started)}, screenshots in ${outDir}`);
