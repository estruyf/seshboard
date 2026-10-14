/**
 * f. Window and environment: sizes down to the minimum and back, maximise, full screen, zoom, blur and focus with
 * overlays open, the built-in themes in both modes, and theme files imported.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeCheck, expensiveChecks } from '../lib/checks.ts';
import { type Chaos, sleep } from '../lib/harness.ts';
import { monkeyStep } from '../lib/monkey.ts';
import { closeAll, command, openSessionByTitle, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

/** Nothing important pushed off screen: the composer and the header stay inside the window. */
async function layoutCheck(c: Chaos, where: string): Promise<void> {
  const bad = await c.page
    .evaluate(() => {
      const out: string[] = [];
      const sx = document.documentElement.scrollWidth > innerWidth + 2;
      if (sx) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
      for (const sel of ['[data-current-session] [data-composer]', '[data-current-session] [data-session-status]', '[data-sidebar-toggle]']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.width < 1) out.push(`${sel} outside the window (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} in ${innerWidth}×${innerHeight})`);
      }
      return out;
    })
    .catch(() => []);
  for (const b of bad) c.signal('layout', `${where}: ${b}`);
}

export const windowChaos: Phase = async (c) => {
  await setUp(c);
  await openSessionByTitle(c, 'Add dark mode');
  const win = (fn: string) => c.app.evaluate(({ BrowserWindow }, fn) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    // eslint-disable-next-line no-new-func
    return new Function('w', fn)(w);
  }, fn);
  const sizes: Array<[number, number]> = [[200, 200], [1, 1], [3000, 400], [500, 2000], [700, 300], [1440, 900]];
  for (const [w, h] of sizes) {
    c.log('resize', '', [w, h]);
    await win(`w.setContentSize(${w}, ${h})`).catch((e) => c.log('resize-failed', String(e)));
    await sleep(700);
    const got = await win('return w.getContentSize()');
    c.log('size-now', '', got);
    for (let i = 0; i < 25; i++) await monkeyStep(c).catch(() => {});
    await layoutCheck(c, `${w}x${h}`);
  }
  for (const op of ['w.maximize()', 'w.unmaximize()', 'w.setFullScreen(true)', 'w.setFullScreen(false)']) {
    c.log('window', op);
    await win(op).catch(() => {});
    await sleep(1_500);
    for (let i = 0; i < 20; i++) await monkeyStep(c).catch(() => {});
  }
  await win('w.setContentSize(1440, 900)');
  // Zoom to the limits and back.
  for (const key of ['Meta+Equal', 'Meta+Minus']) {
    for (let i = 0; i < 15; i++) {
      c.log('press', key);
      await c.page.keyboard.press(key);
    }
    await sleep(500);
    const zoom = await win('return w.webContents.getZoomLevel()');
    c.log('zoom', key, zoom);
    for (let i = 0; i < 25; i++) await monkeyStep(c).catch(() => {});
    await layoutCheck(c, `zoom ${zoom}`);
  }
  await c.page.keyboard.press('Meta+0');
  // Blur and focus while dialogs, menus and drags are open.
  for (let i = 0; i < 20; i++) {
    await monkeyStep(c).catch(() => {});
    const what = c.rng.pick(['Meta+K', 'Meta+P', 'Meta+/', 'Shift+F10']);
    await c.page.keyboard.press(what);
    c.log('blur-focus', what);
    await win('w.blur()');
    await sleep(300);
    await win('w.focus()');
    await escapeCheck(c);
  }
  // Built-in themes, light and dark, and an imported theme that leaves most tokens out.
  const ids = await c.page.evaluate(() => (window as unknown as { switchboard: { themes: { themes?: Array<{ id: string }> } } }).switchboard.themes.themes?.map((t) => t.id) ?? []).catch(() => [] as string[]);
  c.log('themes', '', ids);
  for (const id of ids.slice(0, 6)) {
    for (const scheme of ['theme-dark', 'theme-light']) {
      await command(c, `theme:${id}`, id);
      await command(c, scheme, 'Appearance');
      await sleep(300);
      for (let i = 0; i < 6; i++) await monkeyStep(c).catch(() => {});
    }
  }
  const themeFiles: Array<[string, string]> = [
    ['partial.json', JSON.stringify({ name: 'Partial', colors: { dark: { bg: '#101010' } } })],
    ['minimal.json', JSON.stringify({ name: 'Minimal' })],
    ['wrong.json', JSON.stringify({ name: 123, colors: 'nope', tokens: [1, 2] })],
    ['empty.json', ''],
    ['garbage.json', '\u0000\u0001{{{{'],
    ['huge.json', JSON.stringify({ name: 'Huge', colors: { dark: Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`t${i}`, '#ffffff'])) } })],
    ['evil.json', JSON.stringify({ name: '<img src=x onerror=alert(1)>', colors: { dark: { bg: 'red; } body { display:none' , text: 'url(javascript:alert(1))' }, light: { bg: 'expression(alert(1))' } } })],
  ];
  const dir = join(c.world.root, 'imports');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of themeFiles) {
    writeFileSync(join(dir, name), content);
    await c.queueOpenDialog([join(dir, name)]);
    c.log('import-theme', name, content.length);
    await command(c, 'import-theme', 'Import theme');
    await sleep(1_500);
    await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-theme-${name}.png`) });
    await c.page.locator('[data-theme-import-dialog] button:has-text("Import"), [data-theme-import-dialog] [data-confirm]').first().click({ timeout: 1_500 }).catch(() => {});
    await sleep(800);
    await closeAll(c);
  }
  await expensiveChecks(c);
};
