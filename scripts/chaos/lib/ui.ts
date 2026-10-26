/**
 * Page helpers the phases and repro cases share: setting the demo up, finding what is on screen, opening sessions and
 * palette commands, and waiting for the engine. They find elements by the app's `data-*` hooks, like the smoke test.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Locator } from 'playwright-core';
import { type Chaos, sleep } from './harness.ts';

/**
 * What a person does after installing: adds the demo's second Claude profile (Work) and its projects, so project
 * pages, actions and the Work sessions are reachable. Ends on Home.
 */
export async function setUp(c: Chaos): Promise<void> {
  const p = c.page;
  c.log('setup', 'profiles');
  await p.locator('[data-open-settings]').first().click();
  await p.locator('[data-settings-section="profiles"]').first().click();
  await p.locator('[data-add-profile]').first().click();
  await p.locator('[data-new-profile-name]').first().fill('Work');
  await p.locator('[data-new-profile-folder]').first().fill(join(c.world.home, '.claude-work'));
  await p.locator('[data-add-profile-submit]').first().click();
  await p.waitForFunction(() => document.querySelectorAll('[data-profiles] [data-profile]').length === 2, null, { timeout: 10_000 }).catch(() => c.signal('setup', 'the Work profile was not added'));
  await p.locator('[data-close-settings]').first().click();
  c.log('setup', 'projects');
  await p.locator('[data-open-projects]').first().click();
  await p.locator('[data-manager-add]').first().click();
  await p.locator('[data-add-project-dialog] [data-known-project]').first().waitFor({ timeout: 10_000 });
  for (let i = 0; i < 8; i++) {
    const next = p.locator('[data-known-project][data-added="false"]').first();
    if (!(await next.count())) break;
    await next.click();
    await sleep(250);
  }
  await p.keyboard.press('Escape');
  await sleep(300);
  await goHome(c);
}

/** Closes what is open (overlays, Settings) and goes to Home. */
export async function goHome(c: Chaos): Promise<void> {
  await closeAll(c);
  const settings = c.page.locator('[data-close-settings]');
  if (await settings.count()) await settings.first().click().catch(() => {});
  await c.page.locator('[data-go-home]').first().click({ timeout: 3_000 }).catch(() => {});
}

/** Presses Escape until no overlay is open (at most five times). */
export async function closeAll(c: Chaos): Promise<void> {
  for (let i = 0; i < 5 && (await overlays(c)).length; i++) {
    await c.page.keyboard.press('Escape');
    await sleep(100);
  }
}

// ---------------------------------------------------------------------------------------------------------
// What is on screen.

export interface Target {
  x: number;
  y: number;
  desc: string;
  /** Inside the topmost overlay (the monkey prefers those while one is open). */
  inOverlay: boolean;
  editable: boolean;
}

/** Visible, hit-testable controls, with the topmost overlay's own marked. Never the app's Quit. */
export async function targets(c: Chaos): Promise<Target[]> {
  return c.page
    .evaluate(() => {
      const sel =
        'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], a[href], [data-session-id], input, textarea, [data-section-toggle], [contenteditable="true"], [data-sidebar-rail-row], [data-changed-file], [data-terminal-tab]';
      const overlaySel = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-popover]';
      const tops = [...document.querySelectorAll(overlaySel)].filter((el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed');
      const top = tops.at(-1) ?? null;
      const out: Array<{ x: number; y: number; desc: string; inOverlay: boolean; editable: boolean }> = [];
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
        const x = Math.min(innerWidth - 2, Math.max(1, r.left + r.width / 2));
        const y = Math.min(innerHeight - 2, Math.max(1, r.top + r.height / 2));
        const hit = document.elementFromPoint(x, y);
        if (!hit || (hit !== el && !el.contains(hit))) continue;
        const text = (el.getAttribute('aria-label') ?? el.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (/^quit|quit switchboard/i.test(text) || el.closest('[data-quit-unsent]')) continue;
        const hooks = [...el.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-tooltip')).map((a) => (a.value && a.value.length < 30 ? `${a.name}=${a.value}` : a.name)).slice(0, 3);
        const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
        out.push({ x, y, desc: `${role}[${hooks.join(' ')}] "${text}"`, inOverlay: !!top && top.contains(el), editable: el.matches('input, textarea, [contenteditable="true"]') });
      }
      return out;
    })
    .catch(() => []);
}

export interface Overlay {
  /** Stable for the element's life, so a check can tell which overlays went. */
  id: number;
  /** The overlay this one sits inside (a listbox in the palette), or 0. */
  parent: number;
  kind: string;
  /** `aria-label|first data- hooks`. */
  label: string;
}

/** Open dialogs, menus, popovers and floating listboxes, in DOM order (the last is usually on top). */
export async function overlays(c: Chaos): Promise<Overlay[]> {
  return c.page
    .evaluate(() => {
      const w = window as unknown as { __chaosOverlayId?: number };
      const sel = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-popover]';
      // A listbox that sits in the page (New session's project list) is not an overlay; one that floats or sits in one is.
      const floats = (el: HTMLElement) => ['fixed', 'absolute'].includes(getComputedStyle(el).position) || !!el.parentElement?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [data-popover]');
      const els = [...document.querySelectorAll<HTMLElement & { __chaosId?: number }>(sel)].filter((el) => el.getClientRects().length > 0 && (el.getAttribute('role') !== 'listbox' || floats(el)));
      for (const el of els) el.__chaosId ??= w.__chaosOverlayId = (w.__chaosOverlayId ?? 0) + 1;
      return els.map((el) => ({
        id: el.__chaosId!,
        parent: (el.parentElement?.closest(sel) as (HTMLElement & { __chaosId?: number }) | null)?.__chaosId ?? 0,
        kind: el.getAttribute('role') ?? 'popover',
        label: `${el.getAttribute('aria-label') ?? ''}|${[...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).slice(0, 2).join(',')}`,
      }));
    })
    .catch(() => []);
}

/** True while a terminal has focus: the monkey never types into a shell. */
export const focusInTerminal = (c: Chaos) => c.page.evaluate(() => !!document.activeElement?.closest('.xterm, [data-terminal]')).catch(() => false);

/** The focused element in short (`textarea[data-composer …]`), or `body`. */
export const focusDesc = (c: Chaos) =>
  c.page
    .evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return 'body';
      return `${a.tagName.toLowerCase()}[${[...a.attributes].filter((x) => x.name.startsWith('data-') || x.name === 'aria-label').map((x) => x.name + (x.value && x.value.length < 30 ? '=' + x.value : '')).slice(0, 3).join(' ')}]`;
    })
    .catch(() => 'unknown');

// ---------------------------------------------------------------------------------------------------------
// Sessions and commands.

/** Session ids in the sidebar, top to bottom (only the rendered rows: the list is virtualised). */
export async function sessionIds(c: Chaos): Promise<string[]> {
  return c.page.evaluate(() => [...document.querySelectorAll('[data-session-list] [data-session-id]')].map((e) => e.getAttribute('data-session-id')!)).catch(() => []);
}

/** The session shown in the (active) pane, or null. */
export async function currentSession(c: Chaos): Promise<string | null> {
  return c.page.evaluate(() => document.querySelector('[data-current-session]')?.getAttribute('data-current-session') ?? null).catch(() => null);
}

/** Opens the sidebar's session whose row shows `title` (closing overlays and Settings first); null when it isn't listed. */
export async function openSessionByTitle(c: Chaos, title: string): Promise<string | null> {
  await closeAll(c);
  if (await c.page.locator('[data-settings]').count()) await c.page.locator('[data-close-settings]').first().click({ timeout: 1_000 }).catch(() => {});
  const id = await c.page.evaluate((t) => [...document.querySelectorAll<HTMLElement>('[data-session-list] [data-session-id]')].find((el) => el.innerText.includes(t))?.dataset.sessionId ?? null, title);
  if (!id) return null;
  c.log('open-session', title);
  await c.page.locator(`[data-session-list] [data-session-id="${id}"]`).first().click();
  await c.page.locator(`[data-current-session="${id}"]`).first().waitFor({ timeout: 8_000 }).catch(() => c.signal('open-session', `"${title}" did not open`));
  return id;
}

/** Runs a palette command by id, typing its title as a person would. False when the palette doesn't offer it. */
export async function command(c: Chaos, id: string, title: string): Promise<boolean> {
  c.log('palette-command', id, title);
  await closeAll(c);
  await c.page.keyboard.press('Meta+Shift+P');
  const input = c.page.locator('[data-command-palette] [data-palette-input]').first();
  if (!(await input.waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
    c.signal('palette', 'the palette did not open');
    return false;
  }
  await input.fill(title);
  const row = c.page.locator(`[data-command-palette] [data-palette-command="${id}"]`).first();
  if (!(await row.waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
    c.log('palette-missing', id);
    await c.page.keyboard.press('Escape');
    return false;
  }
  await row.click();
  return true;
}

/** The message box of the session shown, or of New session. */
export const composer = (c: Chaos): Locator => c.page.locator('[data-current-session] [data-composer], [data-new-session-view] [data-composer]').first();

/** Opens New session (⌘N) and picks the project tile showing `project`. */
export async function newSessionIn(c: Chaos, project: string): Promise<void> {
  await goHome(c);
  await c.page.keyboard.press('Meta+N');
  await c.page.locator('[data-new-session-view] [data-composer]').first().waitFor();
  await c.page.locator('[data-folder-option], [data-route-project]').filter({ hasText: project }).first().click().catch(() => c.log('no-project-tile', project));
  await sleep(300);
}

/** Sends a `seshboard://` link to this instance, the way macOS delivers one (never through Launch Services). */
export async function openLink(c: Chaos, url: string): Promise<void> {
  c.log('deep-link', url.length > 200 ? `${url.slice(0, 200)}…(${url.length})` : url);
  await c.app.evaluate(({ app }, url) => void app.emit('open-url', { preventDefault() {} }, url), url);
}

// ---------------------------------------------------------------------------------------------------------
// The engine and its processes.

/** Until the engine answers a cheap call on the window's own port again; ms it took, or null after `timeout`. */
export async function engineAnswers(c: Chaos, timeout = 20_000): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await c.rpc('appState.get', { key: 'chaos.ping' }, 2_000).catch(() => null);
    if (r?.ok) return Date.now() - t0;
    await sleep(300);
  }
  return null;
}

/** Every process below `pid` (shells, project actions, Claude Code). */
export function childrenOf(pid: number): Array<{ pid: number; cmd: string }> {
  const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  const rows = out
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3]! }));
  const result: Array<{ pid: number; cmd: string }> = [];
  const walk = (parent: number) => {
    for (const r of rows) {
      if (r.ppid !== parent) continue;
      result.push({ pid: r.pid, cmd: r.cmd });
      walk(r.pid);
    }
  };
  walk(pid);
  return result;
}

/** `git status` in a sandbox folder, one line per changed file. */
export function gitStatus(c: Chaos, cwd: string): string[] {
  c.assertInSandbox(cwd);
  return execFileSync('/usr/bin/git', ['status', '--porcelain=v1', '-uall'], { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: c.world.home, GIT_CONFIG_GLOBAL: '/dev/null' } })
    .split('\n')
    .filter(Boolean);
}

/** Runs a shell command in a sandbox folder (to change the world under the app); its failures are logged, not thrown. */
export function shellIn(c: Chaos, cwd: string, cmd: string): void {
  c.assertInSandbox(cwd);
  c.log('world', cmd.slice(0, 120), cwd.replace(c.world.root, '<sandbox>'));
  try {
    execFileSync('/bin/sh', ['-c', cmd], {
      cwd,
      env: { PATH: '/usr/bin:/bin', HOME: c.world.home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo', GIT_COMMITTER_EMAIL: 'demo@example.com' },
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (e) {
    c.log('world-cmd-failed', String((e as Error).message).slice(0, 200));
  }
}
