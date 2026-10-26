// Retakes every picture the video is cut from: the real Seshboard (and, for
// the companion beat, a real VS Code), driven by Playwright in the demo world.
//
//   node scripts/capture.mjs              everything
//   node scripts/capture.mjs shots        the stills only
//   node scripts/capture.mjs clips        the recorded beats only
//   node scripts/capture.mjs home profile just those, by name
//
// Needs the app built (npm run build in the repo root) and, for the companion
// beat, the extension packaged (npm run package:vscode) and VS Code installed.
//
// Stills land in public/shots/<name>.png at 2x (2560x1600). Recorded beats land
// in public/clips/<name>.mp4 at a constant 30 fps, with public/clips.json saying
// how long each one is: the composition reads that rather than carrying a table
// of frame numbers, so re-recording a beat doesn't mean re-cutting around it.
//
// Every run builds a fresh world, so the steps always run in the same order and
// a beat that isn't asked for still happens (later shots depend on it); it just
// isn't recorded.

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_FPS } from './clips.mjs';
import { addProjects, clickOn, need, openProjects, openSession, openSettings, park, pause, reset, sessionId, typeText, until, workSessionsListed } from './drive.mjs';
import { ffmpeg } from './ffmpeg.mjs';
import { DEMO_HOME, hidePointer, openApp, openCode, settle, showPointer } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, '../public');
const SHOTS_DIR = join(PUBLIC, 'shots');
const CLIPS_DIR = join(PUBLIC, 'clips');
const TMP = join(PUBLIC, '.frames');

const argv = process.argv.slice(2);
// A beat recorded in two windows is asked for by its first name: `companion` takes companion-code with it.
const wants = (kind, name) => argv.length === 0 || argv.includes(kind) || argv.includes(name) || argv.includes(name.split('-')[0]);

const HERO = 'Add dark mode toggle';
const ACME = join(DEMO_HOME, 'Developer', 'acme-store');

// ---- stills ------------------------------------------------------------------

/** A still is taken with nothing under the pointer: hiding the dot isn't enough, the row it was left on keeps its hover. */
async function still(page, name) {
  if (!wants('shots', name)) return;
  await park(page);
  await hidePointer(page);
  await settle(page, 500);
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
  await showPointer(page);
  console.log(`  shots/${name}.png`);
}

// ---- the screencast ----------------------------------------------------------

/** Starts CDP's screencast on `page`; the function it returns stops it and hands back the frames. */
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    frames.push({ t: metadata.timestamp, data });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  // Generous rather than exact: a ceiling. The frames come at the surface's 2x because of --force-device-scale-factor.
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 4096, maxHeight: 4096, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
    return frames.sort((a, b) => a.t - b.t);
  };
}

/** Writes frames out as constant-rate h264 over [t0, t1] (seconds since the epoch).
 *
 *  CDP sends a frame when the page paints and not otherwise, so what comes back
 *  is a variable-rate stream with a timestamp on each frame. Resampling onto a
 *  fixed 30 fps grid here (for each output frame, the last one painted at or
 *  before its time) is what makes a frame number in the timeline mean a fixed
 *  number of milliseconds. Two pages recorded together share t0 and t1, so
 *  frame N of one is the same moment as frame N of the other. */
function encode(name, frames, t0, t1) {
  if (!frames.length) throw new Error(`${name}: the page never painted`);
  const src = join(TMP, name, 'src');
  const seq = join(TMP, name, 'seq');
  rmSync(join(TMP, name), { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  mkdirSync(seq, { recursive: true });
  const paths = frames.map((frame, i) => {
    const path = join(src, `${String(i).padStart(5, '0')}.jpg`);
    writeFileSync(path, Buffer.from(frame.data, 'base64'));
    return path;
  });
  const count = Math.max(2, Math.round((t1 - t0) * CLIP_FPS));
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const at = t0 + i / CLIP_FPS;
    while (cursor + 1 < frames.length && frames[cursor + 1].t <= at) cursor++;
    // Hard links rather than copies: most frames of a beat repeat the one before.
    linkSync(paths[cursor], join(seq, `${String(i).padStart(5, '0')}.jpg`));
  }
  mkdirSync(CLIPS_DIR, { recursive: true });
  ffmpeg([
    '-framerate', String(CLIP_FPS),
    '-i', join(seq, '%05d.jpg'),
    // Even dimensions: h264's chroma subsampling has no answer for odd ones.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-crf', '15', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(CLIPS_DIR, `${name}.mp4`),
  ]);
  rmSync(join(TMP, name), { recursive: true, force: true });
  console.log(`  clips/${name}.mp4  ${count} frames, ${(count / CLIP_FPS).toFixed(1)}s (${frames.length} painted)`);
  return { frames: count, fps: CLIP_FPS };
}

const manifestPath = join(PUBLIC, 'clips.json');
// Merged rather than replaced, so re-recording one beat by name leaves the others' lengths alone.
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

/** Records `run` on each of `pages` (`{ clipName: page }`), all on one clock. Not wanted: `run` happens unrecorded. */
async function record(pages, ...rest) {
  const run = rest.pop();
  // `pointerless`: windows nobody points at in this beat, where a parked dot would only be in the way.
  const { pointerless = [] } = rest[0] ?? {};
  if (!Object.keys(pages).some((name) => wants('clips', name))) {
    await run();
    return;
  }
  for (const [name, page] of Object.entries(pages)) await (pointerless.includes(name) ? hidePointer(page) : showPointer(page));
  const stops = await Promise.all(Object.values(pages).map(startScreencast));
  await pause(Object.values(pages)[0], 300);
  const t0 = Date.now() / 1000;
  await run();
  await pause(Object.values(pages)[0], 400);
  const t1 = Date.now() / 1000;
  const streams = await Promise.all(stops.map((stop) => stop()));
  Object.keys(pages).forEach((name, i) => {
    if (wants('clips', name)) manifest[name] = encode(name, streams[i], t0, t1);
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---- setup that is never on screen -------------------------------------------

/** acme-store's actions, as pills above the message box: two scripts from package.json and one prompt. */
async function addActions(page) {
  await openSession(page, HERO);
  // Saving closes the editor; the dashed pill (none yet) or the + beside the pills opens it again.
  const editor = async () => {
    await page.locator('[data-add-action-pill], [data-edit-action-pills]').first().click();
    await need(page, '[data-save-action]');
  };
  for (const name of ['Test', 'Dev']) {
    await editor();
    await page.locator('[data-action-suggestion]', { hasText: name }).first().click();
    await page.locator('[data-save-action]').first().click();
    await until(page, () => !document.querySelector('[data-save-action]'));
  }
  await editor();
  await page.locator('[data-add-action]').first().click();
  await page.locator('[data-action-name]').fill('Review');
  await page.locator('[data-action-type="prompt"]').click();
  await page.locator('[data-action-command]').fill('Review the changes on this branch for bugs and missing tests. Don’t change anything yet.');
  await page.locator('[data-save-action]').first().click();
  await until(page, () => document.querySelectorAll('[data-action-pill]').length === 3);
}

// ---- the run -----------------------------------------------------------------

mkdirSync(TMP, { recursive: true });
const { page, dataDir, stop } = await openApp();
let code = null;
try {
  console.log('setting up');
  await addProjects(page);

  // Beat: a second Claude account. Its sessions join the list as it's added.
  console.log('profile');
  await reset(page);
  await openSettings(page, 'profiles');
  await park(page);
  await settle(page, 400);
  await record({ profile: page }, async () => {
    await pause(page, 500);
    await clickOn(page, '[data-add-profile]', { after: 600 });
    await clickOn(page, '[data-new-profile-name]', { after: 200 });
    await page.keyboard.press('Meta+A');
    await typeText(page, 'Work', { delay: 90 });
    await pause(page, 500);
    await clickOn(page, '[data-add-profile-submit]', { after: 300 });
    await until(page, () => document.querySelectorAll('[data-profiles] [data-profile]').length === 2);
    await workSessionsListed(page);
    await pause(page, 1600);
  });

  // The work project is in the list once its login is.
  await addProjects(page);
  await addActions(page);

  // Beat: open payments-api from Projects and, on its Settings tab, put it on the work login with its own defaults.
  console.log('project');
  await reset(page);
  await openProjects(page);
  const row = (name) => `[data-project-row="${join(DEMO_HOME, 'Developer', name)}"]`;
  await park(page);
  await settle(page, 400);
  const choose = async (select, option) => {
    await clickOn(page, select, { after: 450 });
    await clickOn(page, page.getByRole('option', { name: option }).first(), { after: 650 });
  };
  await record({ project: page }, async () => {
    await pause(page, 400);
    await clickOn(page, `${row('payments-api')} [data-project-open]`, { after: 600 });
    await clickOn(page, '[data-project-tab="settings"]', { after: 500 });
    await choose('[data-project-profile]', /Work/);
    await choose('[data-default-effort]', /High effort/);
    await choose('[data-default-workspace]', /New worktree/);
    await pause(page, 900);
  });

  await openProjects(page);
  await still(page, 'projects');
  await page.locator(`${row('acme-store')} [data-project-open]`).click();
  await need(page, '[data-project-page]');
  await page.locator('[data-project-tab="worktrees"]').first().click();
  await need(page, '[data-worktree-row]');
  await still(page, 'worktrees');
  await page.locator('[data-project-tab="overview"]').first().click();

  // The stills.
  console.log('stills');
  await reset(page);
  await pause(page, 1500);
  await still(page, 'home');

  await openSession(page, HERO);
  if (!(await page.evaluate(() => !!document.querySelector('[data-changes-panel]')))) await page.locator('[data-toggle-changes]').first().click();
  await need(page, '[data-changed-file]');
  if (!(await page.evaluate(() => !!document.querySelector('[data-changed-file="src/lib/theme.ts"] [data-file-diff] div')))) {
    await page.locator('[data-changed-file="src/lib/theme.ts"] [data-file-toggle]').first().click();
  }
  await need(page, '[data-file-diff] div');
  await still(page, 'session');
  await page.locator('[data-toggle-changes]').first().click();

  const working = await sessionId(page, 'Fix rounding');
  await page.locator(`[data-session-id="${working}"]`).first().click({ modifiers: ['Alt'] });
  await until(page, (id) => document.querySelectorAll('[data-pane]').length === 2 && document.querySelector(`[data-current-session="${id}"] [data-transcript-item]`), 10_000, working).catch(() => {});
  await still(page, 'split');
  await page.locator('[data-pane="split"] [data-close-pane]').first().click();

  await page.keyboard.press('Meta+Shift+F');
  await need(page, '[data-search] input');
  await page.locator('[data-search] input').fill('theme');
  await need(page, '[data-search-hit]', 30_000);
  await still(page, 'search');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Meta+K');
  await need(page, '[data-command-palette] [data-palette-input]');
  await still(page, 'palette');
  await page.keyboard.press('Escape');

  // Beat: lines selected in VS Code arrive in the session as a chip.
  if (wants('clips', 'companion') || wants('clips', 'companion-code')) {
    console.log('companion');
    await reset(page);
    await openSession(page, HERO);
    await park(page);
    code = await openCode({ dataDir, folder: ACME, file: join(ACME, 'src', 'lib', 'theme.ts') });
    const editor = code.page;
    await editor.locator('.monaco-editor .view-lines').first().waitFor({ state: 'visible', timeout: 30_000 });
    // Connected to this Seshboard, or nothing is clicked: the companion opens Seshboard itself (`open -b`) when it
    // finds none, and that would be the real app. Its status bar item says "Seshboard isn't running" until then.
    await editor
      .waitForFunction(() => {
        const label = document.getElementById('eliostruyf.switchboard-companion.seshboard.status')?.getAttribute('aria-label');
        return label && !label.includes("isn't running");
      }, null, { timeout: 90_000 })
      .catch(async () => {
        await editor.screenshot({ path: join(PUBLIC, 'failed-code.png') });
        throw new Error('the companion did not connect to the demo Seshboard (see public/failed-code.png)');
      });
    const button = editor.locator('.editor-actions [aria-label^="Add Selection to Seshboard"]').first();
    await button.waitFor({ state: 'visible', timeout: 15_000 });
    await editor.mouse.move(1180, 760);
    await settle(editor, 800);
    const line = async (n) => editor.locator('.margin-view-overlays .line-numbers').filter({ hasText: new RegExp(`^${n}$`) }).first().boundingBox();
    const lines = await editor.locator('.monaco-editor .view-lines').first().boundingBox();
    await record({ 'companion-code': editor, companion: page }, { pointerless: ['companion'] }, async () => {
      await pause(editor, 600);
      const from = await line(13);
      const to = await line(17);
      await editor.mouse.move(lines.x + 2, from.y + from.height / 2, { steps: 24 });
      await pause(editor, 250);
      await editor.mouse.down();
      await editor.mouse.move(lines.x + 640, to.y + to.height / 2, { steps: 30 });
      await editor.mouse.up();
      await pause(editor, 600);
      await clickOn(editor, button, { after: 200 });
      await need(page, '[data-context-chip]', 10_000);
      await pause(editor, 2200);
    });
  }
} catch (error) {
  console.error(error);
  await page.screenshot({ path: join(PUBLIC, 'failed.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await code?.stop();
  await stop();
  rmSync(TMP, { recursive: true, force: true });
}
if (existsSync(SHOTS_DIR)) console.log(`\n${readdirSync(SHOTS_DIR).length} stills in public/shots`);
