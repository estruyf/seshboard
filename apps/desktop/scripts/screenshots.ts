/**
 * Takes the README screenshots: builds a made-up home folder (scripts/screenshot-demo.ts), runs the
 * built app in it through the screenshot tour (src/main/screenshotTour.ts), and frames the results
 * into docs/screenshots (scripts/screenshot-frame.mjs).
 * Usage: npm run screenshots (builds first). The raw captures stay in .screenshots/ for a look.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createDemoWorld, linkClaude } from './screenshot-demo.ts';

const appDir = join(import.meta.dirname, '..');
const rawDir = join(appDir, '.screenshots');
const outDir = join(appDir, '..', '..', 'docs', 'screenshots');
const electron = createRequire(import.meta.url)('electron') as unknown as string;
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

function run(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  // Set inside VS Code's terminal, where it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _, ...rest } = env;
  const child = spawn(electron, args, { env: rest, stdio: 'inherit' });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

const world = createDemoWorld();
linkClaude(world.home);
console.log(`demo home: ${world.home}`);

let code: number;
try {
  // HOME and CLAUDE_CONFIG_DIR both point into the demo, so neither the app nor Claude Code sees real data.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: world.home, CLAUDE_CONFIG_DIR: join(world.home, '.claude'), SESHBOARD_SCREENSHOTS_OUT: rawDir, ELECTRON_ENABLE_LOGGING: '0' };
  code = await run([appDir], env);
} finally {
  world.stop();
}
if (code !== 0) {
  console.error(`✗ screenshot tour failed: app exited with code ${code}`);
  process.exit(1);
}
// Start from an empty folder, so a view dropped from the tour doesn't leave its old picture behind.
for (const name of readdirSync(outDir)) if (name.endsWith('.png')) rmSync(join(outDir, name));
console.log(`framing into ${outDir}`);
if ((await run([join(appDir, 'scripts', 'screenshot-frame.mjs'), rawDir, outDir, '1440'], process.env)) !== 0) process.exit(1);
rmSync(world.home, { recursive: true, force: true });
console.log('✓ screenshots written');
