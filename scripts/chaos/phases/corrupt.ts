/**
 * A corrupted profile: each variant (preferences, window state, themes, the cache) starts from the same good
 * profile, is corrupted while the app is closed, and the app must start with the user's choices.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../lib/harness.ts';
import { command, openSessionByTitle, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const corrupt: Phase = async (c) => {
  await setUp(c);
  await openSessionByTitle(c, 'Refactor auth middleware');
  await command(c, 'pin', 'Pin');
  await command(c, 'theme-dark', 'Appearance: Dark');
  await sleep(1_500);
  const profile = c.profileDir;
  const variants: Array<[string, () => void]> = [
    ['preferences invalid JSON', () => writeFileSync(join(profile, 'preferences.json'), '{"colorScheme": "dark", ')],
    ['preferences wrong types', () => writeFileSync(join(profile, 'preferences.json'), JSON.stringify({ colorScheme: 42, themeId: ['x'], sidebarStyle: null, sessionScope: { a: 1 }, autoModel: 'yes', archiveAfterDays: -5, unknownKey: true }))],
    ['preferences unknown keys only', () => writeFileSync(join(profile, 'preferences.json'), JSON.stringify({ zzz: 1, __proto__: { polluted: true } }))],
    ['window-state off-screen', () => writeFileSync(join(profile, 'window-state.json'), JSON.stringify({ x: -99999, y: 99999, width: 1200, height: 800 }))],
    ['window-state zero size', () => writeFileSync(join(profile, 'window-state.json'), JSON.stringify({ x: 0, y: 0, width: 0, height: 0, maximized: 'yes' }))],
    ['theme JSON corrupt', () => {
      mkdirSync(join(profile, 'themes'), { recursive: true });
      writeFileSync(join(profile, 'themes', 'broken.json'), '{"name":"Broken","colors":{');
      writeFileSync(join(profile, 'themes', 'nul.json'), Buffer.from([0, 0, 0, 0xff]));
    }],
    ['cache truncated', () => {
      const f = join(profile, 'cache.sqlite');
      if (existsSync(f)) truncateSync(f, Math.floor(statSync(f).size / 3));
    }],
    ['cache newer schema', () => {
      const f = join(profile, 'cache.sqlite');
      if (existsSync(f)) execFileSync('/usr/bin/sqlite3', [f, 'PRAGMA user_version = 999;']);
    }],
    ['cache older schema', () => {
      const f = join(profile, 'cache.sqlite');
      if (existsSync(f)) execFileSync('/usr/bin/sqlite3', [f, 'PRAGMA user_version = 3;']);
    }],
    ['cache replaced by garbage', () => {
      const f = join(profile, 'cache.sqlite');
      writeFileSync(f, 'SQLite format 3\u0000' + 'garbage'.repeat(1000));
      for (const s of ['-wal', '-shm']) rmSync(f + s, { force: true });
    }],
  ];
  const listing = () => readdirSync(profile).join(', ');
  const backup = `${profile}.bak`;
  // Each variant starts from the same good profile (pinned session, projects, the Work profile).
  await c.quit();
  c.assertInSandbox(backup);
  execFileSync('/bin/cp', ['-R', profile, backup]);
  c.log('profile-files', listing());
  const looks = () =>
    c.page.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-session-list] [data-session-group], [data-session-list] [data-session-id]')];
      const i = nodes.findIndex((n) => n.getAttribute('data-session-group') === 'pinned');
      return {
        rows: document.querySelectorAll('[data-session-id]').length,
        pinned: i >= 0 && !!nodes[i + 1] && nodes[i + 1]!.hasAttribute('data-session-id'),
        addProjectCard: /Choose the folders you work in/.test(document.body.innerText),
        workSessions: /Fix rounding in invoice totals/.test(document.body.innerText),
      };
    });
  for (const [name, corrupt] of variants) {
    c.assertInSandbox(profile);
    rmSync(profile, { recursive: true, force: true });
    execFileSync('/bin/cp', ['-R', backup, profile]);
    c.log('corrupt', name);
    corrupt();
    const t0 = Date.now();
    try {
      await c.launch();
    } catch (e) {
      c.signal('corrupt-start', `${name}: the app did not start: ${String((e as Error).message).slice(0, 300)}`);
      continue;
    }
    c.log('started', name, Date.now() - t0);
    await sleep(2_500);
    const state = await looks().catch(() => null);
    const size = await c.app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return w ? { bounds: w.getBounds(), visible: w.isVisible(), onScreen: screen.getAllDisplays().some((d) => { const b = w.getBounds(); const a = d.workArea; return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y; }) } : null;
    });
    c.log('state', name, { state, size, files: listing() });
    if (!state || state.rows === 0) c.signal('corrupt-start', `${name}: the app started without sessions`);
    if (size && (!size.onScreen || size.bounds.width < 100)) c.signal('corrupt-start', `${name}: the window is off screen or tiny: ${JSON.stringify(size)}`);
    if (state && (!state.pinned || state.addProjectCard || !state.workSessions)) c.signal('lost-choice', `${name}: after starting, pinned=${state.pinned}, projects ${state.addProjectCard ? 'gone' : 'kept'}, Work profile ${state.workSessions ? 'kept' : 'gone'}`);
    await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-corrupt-${name.replace(/\W+/g, '-')}.png`) });
    await c.quit();
  }
  await c.launch();
};
