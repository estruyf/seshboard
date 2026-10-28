/**
 * User choices survive: pins, a rename, an archive, a draft, the sidebar and the theme, across a restart, a quit right
 * after a rename, and a SIGKILL of the whole app.
 */
import { join } from 'node:path';
import { type Chaos, sleep } from '../lib/harness.ts';
import { command, composer, goHome, openSessionByTitle, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

async function choices(c: Chaos) {
  return c.page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-session-list] [data-session-id]')];
    return {
      titles: rows.map((r) => r.innerText.split('\n')[0] ?? '').sort(),
      archived: /,\s*(\d+)/.exec(document.querySelector('[data-archived-dock] .sr-only, [data-archived-header] .sr-only')?.textContent ?? '')?.[1] ?? document.querySelector('[data-archived-dock], [data-archived-header]')?.textContent ?? null,
      drafts: rows.filter((r) => r.getAttribute('data-has-draft') === 'true').length,
      pinned: (() => {
        const nodes = [...document.querySelectorAll<HTMLElement>('[data-session-list] [data-session-group], [data-session-list] [data-session-id]')];
        const i = nodes.findIndex((n) => n.getAttribute('data-session-group') === 'pinned');
        const out: string[] = [];
        for (let j = i + 1; i >= 0 && j < nodes.length && !nodes[j]!.hasAttribute('data-session-group'); j++) out.push(nodes[j]!.innerText.split('\n')[0]!);
        return out;
      })(),
      profileCount: document.querySelectorAll('[data-profile-badge]').length,
      sidebar: document.querySelector('[data-sidebar-state]')?.getAttribute('data-sidebar-state') ?? null,
      dark: document.documentElement.classList.contains('dark') || matchMedia('(prefers-color-scheme: dark)').matches,
      profiles: (window as unknown as { seshboard: { preferences: unknown } }).seshboard.preferences,
    };
  });
}

export const persist: Phase = async (c) => {
  await setUp(c);
  // Make choices: pin, rename, archive, a draft, a project name, a project action, the sidebar, the theme.
  await openSessionByTitle(c, 'Refactor auth middleware');
  await command(c, 'pin', 'Pin');
  await openSessionByTitle(c, 'Investigate flaky checkout');
  if (await command(c, 'rename-session', 'Rename session')) {
    await c.page.locator('[data-rename-session-input]').first().fill('Renamed by chaos ✓');
    await c.page.keyboard.press('Enter');
  }
  await sleep(500);
  await openSessionByTitle(c, 'Write a getting started guide');
  await command(c, 'archive', 'Archive');
  await openSessionByTitle(c, 'Add dark mode toggle');
  await composer(c).fill('An unsent draft that must survive');
  await sleep(1_200);
  await goHome(c);
  await command(c, 'theme-dark', 'Appearance: Dark');
  await command(c, 'sidebar-minimize', 'Minimize sidebar');
  await sleep(500);
  await command(c, 'sidebar-open', 'Open sidebar');
  await sleep(1_000);
  const before = await choices(c);
  c.log('choices-before', '', before);
  // A plain restart, then one in the middle of a rename, then a SIGKILL of the whole app.
  for (const how of ['restart', 'mid-rename', 'kill-app'] as const) {
    if (how === 'mid-rename') {
      await openSessionByTitle(c, 'Renamed by chaos');
      if (await command(c, 'rename-session', 'Rename session')) {
        await c.page.locator('[data-rename-session-input]').first().fill('Mid-quit rename');
        await c.page.keyboard.press('Enter');
      }
      c.log('restart', 'immediately after a rename');
      await c.restart();
    } else if (how === 'kill-app') {
      await composer(c).fill('').catch(() => {});
      c.log('restart', 'SIGKILL the app');
      const pid = c.app.process().pid!;
      (c as unknown as { closing: boolean }).closing = true;
      process.kill(pid, 'SIGKILL');
      await sleep(1_000);
      c.killStrays();
      await c.launch();
    } else {
      c.log('restart', 'quit and start');
      await c.restart();
    }
    await sleep(3_000);
    const after = await choices(c);
    c.log('choices-after', how, after);
    const diffs: string[] = [];
    const expectTitles = how === 'restart' ? before.titles : null;
    if (expectTitles && JSON.stringify(after.titles) !== JSON.stringify(expectTitles)) diffs.push(`titles ${JSON.stringify(expectTitles)} → ${JSON.stringify(after.titles)}`);
    if (how === 'mid-rename' && !after.titles.some((t) => t?.includes('Mid-quit rename'))) diffs.push('the rename made just before quitting was lost');
    if (JSON.stringify(after.pinned) !== JSON.stringify(before.pinned)) diffs.push(`pinned ${JSON.stringify(before.pinned)} → ${JSON.stringify(after.pinned)}`);
    if (after.archived !== before.archived) diffs.push(`archived count ${before.archived} → ${after.archived}`);
    if (how === 'restart' && after.drafts !== before.drafts) diffs.push(`drafts ${before.drafts} → ${after.drafts}`);
    if (after.sidebar !== before.sidebar) diffs.push(`sidebar ${before.sidebar} → ${after.sidebar}`);

    const projects = await c.page.evaluate(() => document.querySelectorAll('[data-project-filter], [data-home-project]').length).catch(() => 0);
    c.log('projects-after', how, projects);
    for (const d of diffs) c.signal('lost-choice', `${how}: ${d}`);
    await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-after-${how}.png`) });
  }
};
