/**
 * Invariants: cheap ones the monkey runs as a step (Escape closes exactly the top overlay, focus doesn't fall to
 * `body`), and the ones every 25 actions (`expensiveChecks`): header counts, the session order, the changed-file
 * count against git, real data on screen, writes outside the sandbox, memory.
 */
import { execFileSync } from 'node:child_process';
import { type Chaos, sleep, writesOutsideSandbox } from './harness.ts';
import { focusInTerminal, overlays } from './ui.ts';

/** With an overlay open, Escape closes exactly the top one and leaves focus somewhere (not on body). */
export async function escapeCheck(c: Chaos): Promise<void> {
  const before = await overlays(c);
  if (!before.length) return;
  if (await focusInTerminal(c)) return;
  const top = before.at(-1)!;
  c.log('escape-check', `${top.kind} ${top.label}`, before.length);
  await c.page.keyboard.press('Escape');
  await sleep(350);
  const after = await overlays(c);
  const focusOnBody = await c.page.evaluate(() => !document.activeElement || document.activeElement === document.body).catch(() => false);
  const left = new Set(after.map((o) => o.id));
  const removed = before.filter((o) => !left.has(o.id));
  const removedIds = new Set(removed.map((o) => o.id));
  // An overlay that went with the one it sits in (the palette's result list) is part of it.
  const roots = removed.filter((o) => !removedIds.has(o.parent));
  if (!removed.length) c.signal('escape-noop', `Escape did not close the top ${top.kind} (${top.label}); open: ${before.map((o) => o.label).join(' > ')}`);
  else if (roots.length > 1) c.signal('escape-multi', `one Escape closed ${roots.length} overlays: ${before.map((o) => o.label).join(' > ')} → ${after.map((o) => o.label).join(' > ')}`);
  if (removed.length && focusOnBody) c.signal('focus-lost', `focus went to body after Escape closed ${top.kind} (${top.label})`);
}

/** Header counts against the rows under them (only when the list isn't clipped by virtualisation). */
export async function headerCounts(c: Chaos): Promise<void> {
  const bad = await c.page
    .evaluate(() => {
      const list = document.querySelector('[data-session-list]') as HTMLElement | null;
      if (!list) return [];
      const scroller = [list, ...list.querySelectorAll<HTMLElement>('*')].find((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible');
      const clipped = !!scroller;
      // Any section header ends the group above it (Queue and Archived have their own hooks).
      const nodes = [...list.querySelectorAll<HTMLElement>('[data-session-group], [data-session-id], [data-archived-header], [data-archived-dock], [data-queue-header], [data-section-toggle]')].filter((n) => !n.closest('[data-session-group]') || n.hasAttribute('data-session-group'));
      const isHeader = (n: HTMLElement) => !n.hasAttribute('data-session-id');
      const out: string[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (!n.hasAttribute('data-session-group')) continue;
        const open = n.querySelector('[data-section-toggle]')?.getAttribute('data-open') !== 'false';
        const claimed = Number(/,\s*(\d+)/.exec(n.querySelector('.sr-only')?.textContent ?? '')?.[1] ?? NaN);
        let rows = 0;
        for (let j = i + 1; j < nodes.length && !isHeader(nodes[j]!); j++) rows++;
        if (!open || Number.isNaN(claimed)) continue;
        if (rows > claimed || (!clipped && rows !== claimed)) out.push(`${n.getAttribute('data-session-group')}: header says ${claimed}, ${rows} rows`);
      }
      return out;
    })
    .catch(() => []);
  for (const b of bad) c.signal('header-count', b);
}

/** The sidebar's order against ⌘P's (per group, ignoring Recent). */
export async function orderCheck(c: Chaos): Promise<void> {
  if ((await overlays(c)).length) return;
  const sidebar = await c.page.evaluate(() => [...document.querySelectorAll('[data-session-list] [data-session-id]')].filter((e) => e.getAttribute('data-archived') !== 'true').map((e) => e.getAttribute('data-session-id')!)).catch(() => [] as string[]);
  if (sidebar.length < 2) return;
  c.log('order-check', 'Meta+P');
  await c.page.keyboard.press('Meta+P');
  const ok = await c.page.locator('[data-command-palette]').first().waitFor({ timeout: 2_000 }).then(() => true, () => false);
  if (!ok) return c.signal('palette', '⌘P did not open Go to');
  await sleep(200);
  const palette = await c.page.evaluate(() => [...document.querySelectorAll('[data-palette-session]')].filter((e) => e.closest('[data-palette-group]')?.getAttribute('data-palette-group') !== 'recent').map((e) => e.getAttribute('data-palette-session')!)).catch(() => [] as string[]);
  await c.page.keyboard.press('Escape');
  const common = sidebar.filter((id) => palette.includes(id));
  const paletteCommon = palette.filter((id) => common.includes(id));
  if (common.join() !== paletteCommon.join()) c.signal('order-mismatch', `sidebar ${common.map((s) => s.slice(0, 4)).join(',')} vs ⌘P ${paletteCommon.map((s) => s.slice(0, 4)).join(',')}`);
}

/** What the session header says about changed files against git status in its folder. */
export async function gitCheck(c: Chaos): Promise<void> {
  const ui = await c.page
    .evaluate(() => {
      const s = document.querySelector('[data-current-session]');
      const t = s?.querySelector('[data-toggle-changes]');
      return s ? { cwd: s.getAttribute('data-cwd'), badge: t ? (t.textContent ?? '').replace(/\D/g, '') : null } : null;
    })
    .catch(() => null);
  if (!ui?.cwd || ui.badge === null || !ui.cwd.startsWith(c.world.root)) return;
  const count = () => {
    try {
      return execFileSync('/usr/bin/git', ['status', '--porcelain=v1', '-uall'], { cwd: ui.cwd!, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: c.world.home } }).split('\n').filter(Boolean).length;
    } catch {
      return null;
    }
  };
  const real = count();
  if (real === null) return;
  const shown = ui.badge === '' ? 0 : Number(ui.badge);
  if (shown !== real) {
    await sleep(4_000);
    const again = await c.page.evaluate(() => (document.querySelector('[data-current-session] [data-toggle-changes]')?.textContent ?? '').replace(/\D/g, '')).catch(() => null);
    const real2 = count();
    if (again !== null && (again === '' ? 0 : Number(again)) !== real2) c.signal('git-mismatch', `${ui.cwd.replace(c.world.root, '<sandbox>')}: header shows ${again || 0} changed files, git status has ${real2}`);
  }
}

/** The every-25-actions checks. */
export async function expensiveChecks(c: Chaos): Promise<void> {
  await headerCounts(c);
  await gitCheck(c);
  if (c.rng.chance(0.3)) await orderCheck(c);
  await c.safetyCheck();
  const outside = writesOutsideSandbox(c.world.root);
  if (outside.length) c.signal('write-outside-sandbox', outside.join(', '));
  await c.sampleMemory();
}

/** Brings the app back to a known place when the monkey wandered off (a modal that keeps it, Settings). */
export async function unstick(c: Chaos): Promise<void> {
  const o = await overlays(c);
  if (o.length >= 3) {
    c.log('unstick', o.map((x) => x.label).join(' > '));
    for (let i = 0; i < 5; i++) await c.page.keyboard.press('Escape');
  }
}
