/**
 * b. Speed and repetition: every shortcut 20 times fast, dialogs opened and closed 50 times, sessions and Settings
 * pages switched faster than they load (the last click must win), mouse back and forward, double sends, a double
 * Start, a double archive, and the theme, sidebar and panels toggled together.
 */
import { expensiveChecks } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { SHORTCUTS } from '../lib/monkey.ts';
import { closeAll, command, composer, currentSession, goHome, openSessionByTitle, overlays, sessionIds, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const speed: Phase = async (c) => {
  await setUp(c);
  await openSessionByTitle(c, 'Add dark mode toggle');
  // Every shortcut 20 times fast.
  for (const key of SHORTCUTS) {
    if (key === 'Meta+Backspace' || key === 'Backspace') continue;
    c.log('press-x20', key);
    for (let i = 0; i < 20; i++) await c.page.keyboard.press(key);
    await sleep(300);
    await closeAll(c);
    if ((await overlays(c)).length) c.signal('stuck-overlay', `after ${key} ×20, overlays stay open: ${(await overlays(c)).map((o) => o.label).join(' > ')}`);
    await goHome(c);
    await openSessionByTitle(c, 'Add dark mode toggle');
  }
  await c.sampleMemory();
  // Open and close every dialog 50 times.
  const toggles: Array<[string, string, string]> = [
    ['palette', 'Meta+K', 'Escape'],
    ['goto', 'Meta+P', 'Escape'],
    ['search', 'Meta+Shift+F', 'Escape'],
    ['shortcuts', 'Meta+/', 'Escape'],
    ['terminal', 'Meta+J', 'Meta+J'],
    ['changes', 'Meta+Shift+D', 'Meta+Shift+D'],
    ['sidebar', 'Meta+B', 'Meta+B'],
    ['find', 'Meta+F', 'Escape'],
  ];
  for (const [name, open, close] of toggles) {
    c.log('toggle-x50', name);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      await c.page.keyboard.press(open);
      if (i % 7 === 0) await sleep(30);
      await c.page.keyboard.press(close);
    }
    const ms = performance.now() - t0;
    await sleep(500);
    const left = await overlays(c);
    if (left.length) c.signal('stuck-overlay', `${name} opened/closed 50× leaves: ${left.map((o) => o.label).join(' > ')}`);
    c.log('toggle-done', name, Math.round(ms));
    await closeAll(c);
  }
  // Settings opened, every page, closed, 50 times.
  for (let i = 0; i < 50; i++) {
    await c.page.locator('[data-open-settings]').first().click({ timeout: 2_000 }).catch(() => {});
    await c.page.locator('[data-close-settings]').first().click({ timeout: 2_000 }).catch(() => {});
  }
  await c.sampleMemory();

  // Switch sessions faster than they load: the last click must win.
  const ids = await sessionIds(c);
  for (let round = 0; round < 10 && ids.length > 1; round++) {
    let last = '';
    for (let i = 0; i < 15; i++) {
      last = c.rng.pick(ids);
      c.log('fast-switch', last);
      await c.page.locator(`[data-session-list] [data-session-id="${last}"]`).first().click({ timeout: 2_000, noWaitAfter: true }).catch(() => {});
    }
    await sleep(2_500);
    const now = await currentSession(c);
    if (now !== last) c.signal('race-lost', `clicked session ${last.slice(0, 8)} last, but ${now?.slice(0, 8) ?? 'nothing'} is shown`);
  }
  // Settings pages faster than they load.
  await c.page.locator('[data-open-settings]').first().click();
  const sections = ['general', 'theme', 'sidebar', 'sessions', 'conversation', 'notifications', 'focus', 'profiles', 'memory', 'vscode', 'backup', 'diagnostics', 'about'];
  for (let round = 0; round < 5; round++) {
    let last = '';
    for (let i = 0; i < 20; i++) {
      last = c.rng.pick(sections);
      await c.page.locator(`[data-settings-section="${last}"]`).first().click({ timeout: 2_000 }).catch(() => {});
    }
    await sleep(800);
    const shown = await c.page.evaluate(() => document.querySelector('[data-settings-page]')?.getAttribute('data-settings-page')).catch(() => null);
    if (shown !== last) c.signal('race-lost', `clicked Settings › ${last} last, ${shown} is shown`);
  }
  // Back and forward (mouse buttons 3 and 4) while views load.
  for (let i = 0; i < 40; i++) {
    const s = c.rng.pick(sections);
    await c.page.locator(`[data-settings-section="${s}"]`).first().click({ timeout: 1_000 }).catch(() => {});
    const b = c.rng.pick([3, 4]);
    c.log('mouse-history', String(b));
    await c.page.evaluate((button) => {
      for (const type of ['mousedown', 'mouseup']) window.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
    }, b);
  }
  await c.page.locator('[data-close-settings]').first().click({ timeout: 2_000 }).catch(() => {});
  for (let i = 0; i < 30; i++) {
    const id = c.rng.pick(ids);
    await c.page.locator(`[data-session-list] [data-session-id="${id}"]`).first().click({ timeout: 1_000 }).catch(() => {});
    await c.page.evaluate((button) => {
      for (const type of ['mousedown', 'mouseup']) document.body.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
    }, c.rng.pick([3, 4]));
  }
  await sleep(1_000);

  // Double sends: Enter twice, then the button twice.
  await goHome(c);
  const id = await openSessionByTitle(c, 'Investigate flaky checkout');
  if (id) {
    await composer(c).fill('double send test');
    c.log('double-enter', 'composer');
    await c.page.keyboard.press('Enter');
    await c.page.keyboard.press('Enter');
    await sleep(4_000);
    await composer(c).fill('double click send test');
    c.log('double-click', '[data-composer-submit]');
    await c.page.locator('[data-current-session] [data-composer-submit]').first().dblclick({ timeout: 2_000 }).catch(() => {});
    await sleep(4_000);
    const shown = await c.page.evaluate(() => [...document.querySelectorAll('[data-current-session] [data-transcript-item]')].filter((e) => /double (click )?send test/.test((e as HTMLElement).innerText)).length);
    c.log('double-result', '', { shown });
    if (shown > 2) c.signal('double-send', `two double-sends show ${shown} prompts in the transcript`);
  }
  // Double Start in New session: one session, not two.
  await goHome(c);
  const n0 = (await sessionIds(c)).length;
  await c.page.keyboard.press('Meta+N');
  await c.page.locator('[data-new-session-view] [data-composer]').first().waitFor({ timeout: 5_000 }).catch(() => {});
  await composer(c).fill('double start test');
  c.log('double-start', '[data-start-session]');
  const start = c.page.locator('[data-new-session-view] [data-composer-submit], [data-new-session-view] [data-start-session]').first();
  await start.dblclick({ timeout: 3_000 }).catch(() => {});
  await sleep(5_000);
  await goHome(c);
  const n1 = (await sessionIds(c)).length;
  c.log('double-start-result', '', { before: n0, after: n1 });
  if (n1 - n0 > 1) c.signal('double-start', `double-clicking Start made ${n1 - n0} sessions`);
  // Double archive / delete through the palette.
  const victim = await openSessionByTitle(c, 'Write a getting started guide');
  if (victim) {
    await command(c, 'archive', 'Archive');
    await command(c, 'archive', 'Archive');
    await sleep(1_500);
  }
  // Theme and sidebar during animations.
  for (let i = 0; i < 20; i++) {
    await command(c, c.rng.pick(['theme-light', 'theme-dark', 'theme-system']), 'Appearance');
    await c.page.keyboard.press('Meta+B');
    await c.page.keyboard.press(c.rng.pick(['Meta+J', 'Meta+Shift+D']));
  }
  await sleep(1_500);
  await closeAll(c);
  await expensiveChecks(c);
};
