// Opens the real Seshboard, the built app in apps/desktop/out, in the made-up
// home folder the README screenshots use (apps/desktop/scripts/screenshot-demo.ts),
// and hands back a page the shot list can drive.
//
// Nothing here sees real data. HOME and CLAUDE_CONFIG_DIR point into the demo
// folder, so neither the app nor Claude Code can see the user's own projects or
// transcripts; the app keeps its database and preferences in a throwaway data
// folder; and the Claude Code update check reads a mock registry. The demo
// logins have no credentials, so nothing is ever sent to Claude.
//
// Called only by capture.mjs.

import { execFileSync, spawn } from 'node:child_process';
import { _electron as electron, chromium } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoWorld } from '../../apps/desktop/scripts/screenshot-demo.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = resolve(HERE, '../../apps/desktop');
export const EXTENSION_DIR = resolve(HERE, '../../apps/vscode-extension');

/// The window is captured at this size and at 2x. 16:10 like a Mac screen, and
/// narrower than the README's 1440 on purpose: the layout is the same, and the
/// app's own 13px text becomes a larger share of a 1080p frame.
export const VIEWPORT = { width: 1280, height: 800 };

/** The user's `claude`, so the demo home can offer it (its helpers find no login there and send nothing). */
function realClaude() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    try {
      return realpathSync(join(dir, 'claude'));
    } catch {
      // not here
    }
  }
  return null;
}

/** Draws the pointer the screencast leaves out.
 *
 *  CDP's `Page.startScreencast` composites the page and not the cursor, so a
 *  recording of a click is a recording of something happening for no visible
 *  reason. This puts a dot back at the position Chromium is actually reporting:
 *  it follows real mouse events rather than a scripted path, so it cannot drift
 *  from where the click lands. It is the only thing in any frame that the app
 *  did not draw. */
export const POINTER = (accent) => {
  if (document.getElementById('__promo_pointer')) return;
  const dot = document.createElement('div');
  dot.id = '__promo_pointer';
  dot.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'left:0', 'top:0',
    'width:22px', 'height:22px', 'margin:-11px 0 0 -11px',
    'border-radius:50%', 'pointer-events:none', 'opacity:0',
    'background:rgba(20,22,28,0.55)', 'border:2px solid #fff',
    'box-shadow:0 2px 10px rgba(0,0,0,0.45)',
    'transition:opacity .2s, transform .12s',
  ].join(';');
  const ring = document.createElement('div');
  ring.id = '__promo_ring';
  ring.style.cssText = [
    'position:fixed', 'z-index:2147483646', 'left:0', 'top:0',
    'width:22px', 'height:22px', 'margin:-11px 0 0 -11px',
    'border-radius:50%', 'pointer-events:none', 'opacity:0',
    `border:3px solid ${accent}`,
  ].join(';');
  document.body.append(dot, ring);

  let x = 0;
  let y = 0;
  addEventListener('mousemove', (e) => {
    x = e.clientX;
    y = e.clientY;
    dot.style.opacity = '1';
    dot.style.transform = `translate(${x}px, ${y}px)`;
    ring.style.transform = `translate(${x}px, ${y}px)`;
  }, true);
  addEventListener('mousedown', () => {
    dot.style.transform = `translate(${x}px, ${y}px) scale(0.75)`;
    ring.style.transition = 'none';
    ring.style.opacity = '0.9';
    ring.style.transform = `translate(${x}px, ${y}px) scale(1)`;
    requestAnimationFrame(() => {
      ring.style.transition = 'opacity .45s ease-out, transform .45s ease-out';
      ring.style.opacity = '0';
      ring.style.transform = `translate(${x}px, ${y}px) scale(2.6)`;
    });
  }, true);
  addEventListener('mouseup', () => {
    dot.style.transform = `translate(${x}px, ${y}px) scale(1)`;
  }, true);
};

const setPointer = (page, display) =>
  page.evaluate((d) => {
    for (const id of ['__promo_pointer', '__promo_ring']) {
      const el = document.getElementById(id);
      if (el) el.style.display = d;
    }
  }, display);

/** Hide the pointer for the stills: a dot parked in a screenshot is not something anyone would frame on purpose. */
export const hidePointer = (page) => setPointer(page, 'none');
export const showPointer = (page) => setPointer(page, '');

/// Chromium stops painting a window another one covers, and slows down one in the background. The companion beat
/// records VS Code and Seshboard at the same time, one on top of the other, so both have to keep painting.
const KEEP_PAINTING = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];

/** Resizes the window's content to `size` (points) and centres it. */
export async function sizeWindow(app, size = VIEWPORT) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.setContentSize(s.width, s.height);
    win.center();
  }, size);
}

/// Where the demo home is built. Seshboard shortens paths to `~/…` only under
/// `/Users/<name>`, so a home in the temporary folder shows every project as
/// `/private/var/folders/2d/…/Developer/acme-store`. `/Users/Shared` is the one
/// folder of that shape anyone can write to; the demo only adds these entries to
/// it, refuses to start if one is already there, and takes them away again.
export const DEMO_HOME = '/Users/Shared';
/// What the demo puts in it: the world itself, and what VS Code writes to a home folder on its first start.
const DEMO_ENTRIES = ['.claude', '.claude-work', '.local', 'Developer', '.vscode', '.vscode-shared'];

function removeDemoHome() {
  for (const name of DEMO_ENTRIES) rmSync(join(DEMO_HOME, name), { recursive: true, force: true });
}

const git = (cwd, args, env = {}) =>
  execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore', env: { ...process.env, ...env } });
const DAY = 24 * 60 * 60 * 1000;

/** Worktrees for acme-store, where Claude Code puts them (.claude/worktrees), one for each of the Worktrees tab's
 *  groups: merged and clean (safe to remove), uncommitted work and an unpushed commit (keep), and one whose folder
 *  was deleted (stale). Added here rather than in screenshot-demo.ts so the README screenshots stay as they are. */
function addWorktrees(repo) {
  // Not part of the project's changes: the session's Changes panel would list the worktrees otherwise.
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '.claude/\n');
  const tree = (name) => join(repo, '.claude', 'worktrees', name);
  const add = (name, branch) => git(repo, ['worktree', 'add', '-q', '-b', branch, tree(name), 'main']);
  // "Last active" is the newer of the branch's last commit and the folder's change time, so both are set back to
  // when the work happened; otherwise every row says "now".
  const commit = (name, file, content, message, daysAgo) => {
    writeFileSync(join(tree(name), file), content);
    git(tree(name), ['add', '-A']);
    const date = new Date(Date.now() - daysAgo * DAY).toISOString();
    git(tree(name), ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  };
  const age = (name, daysAgo) => {
    const at = new Date(Date.now() - daysAgo * DAY);
    utimesSync(tree(name), at, at);
  };

  // No commits of its own (the repo's checkout is feat/dark-mode, so main can't take a merge here).
  add('brave-humming-otter', 'fix/cart-badge');

  add('quiet-amber-falcon', 'feat/wishlist');
  commit('quiet-amber-falcon', 'src/wishlist.ts', 'export const wishlist: string[] = [];\n', 'Add a wishlist store', 3);
  writeFileSync(join(tree('quiet-amber-falcon'), 'src', 'wishlist.ts'), 'export const wishlist = new Set<string>();\n');
  writeFileSync(join(tree('quiet-amber-falcon'), 'src', 'WishlistButton.tsx'), 'export function WishlistButton() {\n  return null;\n}\n');
  age('quiet-amber-falcon', 2);

  add('swift-paper-lantern', 'chore/upgrade-vite');
  commit('swift-paper-lantern', 'vite.config.ts', 'export default {};\n', 'Upgrade to Vite 7', 9);
  age('swift-paper-lantern', 9);

  add('gentle-cobalt-heron', 'spike/search-index');
  rmSync(tree('gentle-cobalt-heron'), { recursive: true, force: true });
}

/** Builds the demo world and opens Seshboard in it. `stop()` closes both. */
export async function openApp({ scheme = 'dark' } = {}) {
  const taken = DEMO_ENTRIES.filter((name) => existsSync(join(DEMO_HOME, name)));
  if (taken.length) {
    throw new Error(`${taken.map((n) => join(DEMO_HOME, n)).join(', ')} already exist${taken.length === 1 ? 's' : ''}. Remove ${taken.length === 1 ? 'it' : 'them'} if a capture left ${taken.length === 1 ? 'it' : 'them'} behind.`);
  }
  const world = createDemoWorld(DEMO_HOME);
  addWorktrees(join(world.home, 'Developer', 'acme-store'));
  const claude = realClaude();
  if (claude) {
    mkdirSync(join(world.home, '.local', 'bin'), { recursive: true });
    symlinkSync(claude, join(world.home, '.local', 'bin', 'claude'));
  }
  // The app's own data: its database, preferences and the companion's engine.json.
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-promo-data-')));
  // Every session in the list, not only those started in Seshboard: the demo's were "started in a terminal".
  writeFileSync(join(dataDir, 'preferences.json'), `${JSON.stringify({ colorScheme: scheme, sessionScope: 'all', confirmQuit: false, autoUpdate: false }, null, 2)}\n`);

  const electronPath = createRequire(join(APP_DIR, 'package.json'))('electron');
  // Set inside VS Code's terminal, where it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  let app = null;
  const stop = async () => {
    await app?.close().catch(() => {});
    world.stop();
    removeDemoHome();
    rmSync(dataDir, { recursive: true, force: true });
  };
  // Ctrl-C mid-capture still takes the demo folders out of /Users/Shared.
  process.once('SIGINT', () => void stop().then(() => process.exit(130)));
  try {
    app = await electron.launch({
      executablePath: electronPath,
      // --use-mock-keychain: HOME is the demo folder, where macOS finds no login keychain; never ask it for one.
      args: [APP_DIR, '--force-device-scale-factor=2', '--force-color-profile=srgb', '--use-mock-keychain', ...KEEP_PAINTING],
      env: {
        ...env,
        HOME: world.home,
        CLAUDE_CONFIG_DIR: join(world.home, '.claude'),
        SESHBOARD_DATA_DIR: dataDir,
        // The Claude Code check reads a registry with nothing newer, and an update is refused anyway.
        SESHBOARD_CLAUDE_REGISTRY: `data:application/json,${encodeURIComponent(JSON.stringify({ latest: '0.0.1', stable: '0.0.1' }))}`,
        SESHBOARD_NO_CLAUDE_UPDATE: '1',
        // Forces the scheme without saving it (the preference file alone loses to the system's).
        SESHBOARD_COLOR_SCHEME: scheme,
        ELECTRON_ENABLE_LOGGING: '0',
      },
      // Playwright emulates a light scheme unless told otherwise; the app's own setting (above) decides instead.
      colorScheme: null,
      timeout: 60_000,
    });
    const page = await app.firstWindow();
    await sizeWindow(app);
    await page.locator('[data-session-id]').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.evaluate(POINTER, '#ffd43b');
    await settle(page);
    return { app, page, world, dataDir, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Wait for the app to stop moving: two frames, then `ms`. */
export async function settle(page, ms = 500) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
}

// ---- VS Code, for the companion beat ------------------------------------------

export const CODE_APP = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const CODE_CLI = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
const CODE_PORT = 9339;

/** Opens an isolated VS Code (its own profile and extensions folder, the
 *  companion loaded from apps/vscode-extension) on `folder`, with `file` open.
 *
 *  It can only ever reach the Seshboard opened by `openApp`: the companion's
 *  `switchboard.appDataFolder` points at that app's data folder, which replaces
 *  the usual places it looks rather than adding to them, and HOME is the demo
 *  home, where no other Seshboard keeps its data either. */
export async function openCode({ dataDir, folder, file }) {
  // Installed from its package, as people get it: loaded as a development extension, the title bar says so.
  const { version } = JSON.parse(readFileSync(join(EXTENSION_DIR, 'package.json'), 'utf8'));
  const vsix = join(EXTENSION_DIR, `switchboard-companion-${version}.vsix`);
  if (!existsSync(vsix)) throw new Error(`no ${vsix}: run npm run package:vscode in the repo root`);
  // Short, under /tmp: VS Code puts its instance socket in here, and macOS limits socket paths to 104 bytes.
  const dir = realpathSync(mkdtempSync('/tmp/sbcode-'));
  mkdirSync(join(dir, 'user', 'User'), { recursive: true });
  writeFileSync(join(dir, 'user', 'User', 'settings.json'), `${JSON.stringify(CODE_SETTINGS(dataDir), null, 2)}\n`);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const profile = [`--user-data-dir=${join(dir, 'user')}`, `--extensions-dir=${join(dir, 'extensions')}`];
  execFileSync(CODE_CLI, [...profile, '--install-extension', vsix], { stdio: 'ignore', env: { ...env, HOME: DEMO_HOME } });
  const child = spawn(
    CODE_APP,
    [
      ...profile,
      `--remote-debugging-port=${CODE_PORT}`,
      '--force-device-scale-factor=2',
      // Never the real keychain. With HOME pointed at the demo, macOS can't find the login keychain when VS Code
      // asks for its storage key, and offers to *reset* it. The mock keychain keeps that question from being asked.
      '--use-mock-keychain',
      ...KEEP_PAINTING,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--new-window',
      folder,
      file,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, HOME: DEMO_HOME } },
  );
  // Kept for when it doesn't come up: the reason is in its own output.
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('exit', (code) => (log += `\n[exited with ${code}]`));
  const stop = async () => {
    await browser?.close().catch(() => {});
    // Wait for it to be gone: its helpers keep writing to the profile folder until then.
    const exited = child.exitCode === null ? new Promise((r) => child.once('exit', r)) : Promise.resolve();
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dir, { recursive: true, force: true });
  };

  let browser = null;
  try {
    for (let i = 0; i < 60 && !browser; i++) {
      await new Promise((r) => setTimeout(r, 500));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CODE_PORT}`).catch(() => null);
    }
    if (!browser) throw new Error(`VS Code did not open its debugging port:\n${log.slice(-2000)}`);
    let page = null;
    for (let i = 0; i < 40 && !page; i++) {
      page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('workbench')) ?? null;
      if (!page) await new Promise((r) => setTimeout(r, 250));
    }
    if (!page) throw new Error('VS Code opened no workbench window');
    // A CDP client can't call Electron to size the window, and Electron has no Browser.setWindowBounds. The whole
    // workbench, title bar included, is the page, so giving the page Seshboard's size comes to the same thing.
    // The session stays attached: the override ends with it.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 2, mobile: false });
    await page.waitForFunction((w) => innerWidth === w, VIEWPORT.width, { timeout: 5_000 });
    await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 30_000 });
    await page.evaluate(POINTER, '#ffd43b');
    return { page, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** VS Code as it comes, minus what would sit over the shot: no AI side bar, no tips, no update or git prompts. */
const CODE_SETTINGS = (dataDir) => ({
  'switchboard.appDataFolder': dataDir,
  'switchboard.editorTitleButton': true,
  'switchboard.bringToFront': false,
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.layoutControl.enabled': false,
  'chat.disableAIFeatures': true,
  'chat.commandCenter.enabled': false,
  'window.titleBarStyle': 'custom',
  'window.commandCenter': false,
  'window.restoreWindows': 'none',
  'editor.fontSize': 15,
  'editor.lineHeight': 24,
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.renderLineHighlight': 'none',
  'editor.hover.enabled': false,
  'editor.lightbulb.enabled': 'off',
  'git.blame.statusBarItem.enabled': false,
  'git.openRepositoryInParentFolders': 'never',
  'git.autofetch': false,
  'extensions.ignoreRecommendations': true,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'security.workspace.trust.enabled': false,
});
