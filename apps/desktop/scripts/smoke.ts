/**
 * Launches the built app in smoke mode, which drives the real UI step by step (see `runSmokeStep` in
 * src/main/index.ts), then prints each step's result and how long it took.
 * Usage: npm run smoke (builds first). Writes .smoke/*.png and .smoke/result.json.
 *
 * --demo runs it in the made-up home folder the README screenshots use (scripts/screenshot-demo.ts) instead of
 * the user's own: projects, sessions and a running one, the same on every machine. CI runs it this way
 * (npm run smoke:demo), since a runner's home folder has no ~/.claude.
 */
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoWorld, linkClaude, type DemoWorld } from './screenshot-demo.ts';

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
const childEnv: NodeJS.ProcessEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

let world: DemoWorld | null = null;
if (process.argv.includes('--demo')) {
  world = createDemoWorld();
  linkClaude(world.home);
  // The home folder is HOME on macOS and USERPROFILE on Windows; with CLAUDE_CONFIG_DIR, neither the app nor
  // Claude Code sees the real one.
  Object.assign(childEnv, { HOME: world.home, USERPROFILE: world.home, CLAUDE_CONFIG_DIR: join(world.home, '.claude'), SWITCHBOARD_SMOKE_DEMO: '1' });
  console.log(`demo home: ${world.home}`);
}

// A fake gh, so the Create pull request step never reaches GitHub: it says it is signed in, and refuses everything
// else (so the pull request lists are empty, as without gh). Windows can't start a script without a shell; there the
// step stays read-only with the real gh.
if (process.platform !== 'win32') {
  mkdirSync(outDir, { recursive: true });
  const fakeGh = join(outDir, 'gh');
  writeFileSync(fakeGh, '#!/bin/sh\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\necho "the smoke test\'s gh never reaches GitHub" >&2\nexit 1\n');
  chmodSync(fakeGh, 0o755);
  childEnv.SWITCHBOARD_GH = fakeGh;
}

// A second computer for Other computers: the real Remote hub over made-up sessions (scripts/remote-demo.ts), in a
// throwaway folder on a free port. It writes a fresh pairing link to a file, which the smoke step pastes when it gets
// there (a link is good for two minutes; the run is longer).
const freePort = await new Promise<number>((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number };
    server.close(() => resolve(port));
  });
});
const computerDir = mkdtempSync(join(tmpdir(), 'switchboard-smoke-computer-'));
const computerLink = join(computerDir, 'link.txt');
const otherComputer = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', join(appDir, '..', '..', 'scripts', 'remote-demo.ts')], {
  env: { ...process.env, SWITCHBOARD_DEMO_DIR: computerDir, SWITCHBOARD_DEMO_NAME: 'Smoke Mac', SWITCHBOARD_DEMO_LINK_FILE: computerLink, PORT: String(freePort) },
  stdio: 'ignore',
});
childEnv.SWITCHBOARD_SMOKE_COMPUTER_LINK = computerLink;

// Claude Code mods: the test mod in a throwaway folder (Claude Code writes its types into a mod's folder), a throwaway
// Claude config folder for its profile, and an empty folder for its session.
const modsDir = mkdtempSync(join(tmpdir(), 'switchboard-smoke-mods-'));
cpSync(join(appDir, '..', '..', 'tests', 'fixtures', 'smoke-mod'), join(modsDir, 'smoke-mod'), { recursive: true });
for (const folder of ['config', 'project']) mkdirSync(join(modsDir, folder));
childEnv.SWITCHBOARD_SMOKE_MODS = JSON.stringify({ pluginDir: join(modsDir, 'smoke-mod'), configDir: join(modsDir, 'config'), cwd: join(modsDir, 'project'), out: join(modsDir, 'started.json') });

const child = spawn(command, packaged ? [] : [appDir], {
  env: { ...childEnv, SWITCHBOARD_SMOKE_OUT: outDir, ELECTRON_ENABLE_LOGGING: '0' },
  stdio: 'inherit',
});

const code: number = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
otherComputer.kill();
rmSync(computerDir, { recursive: true, force: true, maxRetries: 5 });
rmSync(modsDir, { recursive: true, force: true, maxRetries: 5 });
if (world) {
  world.stop();
  rmSync(world.home, { recursive: true, force: true, maxRetries: 5 });
}
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
if (result.window) console.log(`  window ${result.window.content.join('×')} on a ${result.window.workArea.width}×${result.window.workArea.height} screen`);
if (result.reports[0]) console.log(`  claude ${result.reports[0].claudeVersion ?? 'not found'} · engine ping ${result.reports[0].pingMs}ms · electron ${result.versions.electron}`);
if (packaged) console.log('  (packaged app)');
if (world) console.log('  (demo home)');
console.log(`${failed.length ? `✗ ${failed.length} of ${steps.length} steps failed` : `✓ all ${steps.length} steps passed`} in ${seconds(performance.now() - started)}, screenshots in ${outDir}`);
