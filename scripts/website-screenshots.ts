/**
 * Takes the website's screenshots (npm run website:screenshots, which builds the app first).
 *
 * It builds the made-up home folder the README screenshots use (apps/desktop/scripts/screenshot-demo.ts),
 * adds a remote, branches, worktrees and shared project actions to it, starts the built app on a throwaway
 * profile with HOME pointed at that folder (SWITCHBOARD_DRIVEN), and drives it with Playwright through the
 * app's `data-*` hooks. Every screen is taken in dark and light, at 1440×900 points and 2× scale, and saved
 * as website/src/assets/screenshots/<name>-<dark|light>.png, so a rerun replaces the files in place.
 *
 * Nothing is real: no projects, paths, user names or logins from this Mac. Before each picture the page's
 * text is checked for the real home folder and user name, and the run fails if either shows up.
 *
 * Usage: npm run website:screenshots [-- --only home,palette]   (--only takes the setup, then just those)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright-core';
import sharp from 'sharp';
import { createDemoWorld, type DemoWorld } from '../apps/desktop/scripts/screenshot-demo.ts';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'apps', 'desktop');
const outDir = join(root, 'website', 'src', 'assets', 'screenshots');
const SIZE = { width: 1440, height: 900 };
const SCALE = 2;

const onlyArg = process.argv.find((arg, i) => process.argv[i - 1] === '--only' || arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.replace(/^--only=/, '').split(',')) : null;

const realHome = homedir();
const realUser = userInfo().username;

// ---------------------------------------------------------------------------------------------------------
// The world: the README's demo home, plus what the project pages need.

const DAY = 24 * 60 * 60 * 1000;

function git(cwd: string, args: string[], date?: Date): string {
  const env = { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date.toISOString(), GIT_COMMITTER_DATE: date.toISOString() } : {}) };
  return execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function commitFile(cwd: string, path: string, content: string, message: string, date?: Date): void {
  mkdirSync(join(cwd, path, '..'), { recursive: true });
  writeFileSync(join(cwd, path), content);
  git(cwd, ['add', path], date);
  git(cwd, ['commit', '-q', '-m', message], date);
}

/**
 * acme-store gets an `origin` (a bare repository in the demo home), branches in every group of the Branches
 * tab, three worktrees under .claude/worktrees, and a .switchboard.json with shared actions.
 */
function extendWorld(world: DemoWorld): void {
  const acme = join(world.home, 'Developer', 'acme-store');
  const remote = join(world.home, 'remotes', 'acme-store.git');
  mkdirSync(remote, { recursive: true });
  git(remote, ['init', '-q', '--bare', '-b', 'main']);
  git(acme, ['remote', 'add', 'origin', remote]);
  git(acme, ['push', '-q', '-u', 'origin', 'main']);

  // Branch off main without touching the checked-out feat/dark-mode and its uncommitted changes.
  const branch = (name: string, commits: Array<[string, string, string]>, date?: Date) => {
    const tree = join(world.home, '.tmp-branches', name.replace(/\//g, '-'));
    git(acme, ['worktree', 'add', '-q', '-b', name, tree, 'main']);
    for (const [path, content, message] of commits) commitFile(tree, path, content, message, date);
    git(acme, ['worktree', 'remove', '--force', tree]);
  };
  // Merged into main: safe to delete.
  branch('feat/product-reviews', [['src/reviews.ts', 'export const reviews = [];\n', 'Add product reviews']]);
  git(acme, ['push', '-q', 'origin', 'feat/product-reviews']);
  const reviewsTip = git(acme, ['rev-parse', 'feat/product-reviews']).trim();
  git(acme, ['push', '-q', 'origin', `${reviewsTip}:refs/heads/main`]);
  git(acme, ['fetch', '-q', 'origin']);
  git(acme, ['branch', '-q', '-f', 'main', 'origin/main']);
  // Pushed, then deleted on the remote (squash-merged there, say).
  branch('fix/cart-total', [['src/cart.ts', 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0);\n', 'Fix cart total']]);
  git(acme, ['push', '-q', '-u', 'origin', 'fix/cart-total']);
  git(acme, ['push', '-q', 'origin', '--delete', 'fix/cart-total']);
  // No commits for months: inactive.
  branch('chore/upgrade-eslint', [['eslint.config.js', 'export default [];\n', 'Upgrade ESLint']], new Date(Date.now() - 140 * DAY));
  git(acme, ['push', '-q', 'origin', 'chore/upgrade-eslint']);
  // Work in progress, not pushed: active.
  branch('feat/wishlist', [['src/wishlist.ts', 'export const wishlist = new Set<string>();\n', 'Start the wishlist']]);
  // Only on the remote.
  branch('feat/gift-cards', [['src/gift-cards.ts', 'export const giftCards = [];\n', 'Gift cards']]);
  git(acme, ['push', '-q', 'origin', 'feat/gift-cards']);
  git(acme, ['branch', '-q', '-D', 'feat/gift-cards']);
  git(acme, ['fetch', '-q', 'origin']);

  // Worktrees like Claude Code makes them: one with nothing of its own, one with unpushed work, one with changes.
  const worktrees = join(acme, '.claude', 'worktrees');
  const tree = (name: string, branchName: string) => {
    git(acme, ['worktree', 'add', '-q', '-b', branchName, join(worktrees, name), 'main']);
    return join(worktrees, name);
  };
  tree('brave-humming-otter', 'worktree-brave-humming-otter');
  const quiet = tree('quiet-amber-fox', 'worktree-quiet-amber-fox');
  commitFile(quiet, 'src/search/filters.ts', 'export const filters = ["price", "brand"];\n', 'Add search filters');
  const tidy = tree('tidy-silver-heron', 'worktree-tidy-silver-heron');
  writeFileSync(join(tidy, 'src', 'checkout.ts'), 'export const checkout = () => "todo";\n');
  // An old one, last touched weeks ago.
  const old = new Date(Date.now() - 30 * DAY);
  for (const dir of [join(worktrees, 'brave-humming-otter')]) utimesSync(dir, old, old);
  // Keep Claude Code's worktree folder out of the demo project's own changes.
  writeFileSync(join(acme, '.git', 'info', 'exclude'), '.claude/\n.switchboard.json\n');

  // Actions the team shares, as a repository would commit them.
  writeFileSync(
    join(acme, '.switchboard.json'),
    `${JSON.stringify(
      {
        actions: [
          { name: 'Test', icon: 'flask', command: 'npm test', shortcut: 'cmd+shift+t' },
          { name: 'Dev server', icon: 'play', command: 'npm run dev' },
          { name: 'Install', icon: 'package', command: 'npm install', runOnWorktreeCreate: true },
          { name: 'Review', icon: 'sparkles', type: 'prompt', command: 'Review the changes on ${branch} and list anything risky.' },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Every transcript in the demo's Claude config folders, with its length. The tour must never send anything to
 * Claude; a transcript that grew means it did, and the run fails.
 */
function transcripts(home: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const config of ['.claude', '.claude-work']) {
    const projects = join(home, config, 'projects');
    for (const entry of readdirSync(projects, { recursive: true, encoding: 'utf8' })) {
      if (entry.endsWith('.jsonl')) sizes.set(join(projects, entry), readFileSync(join(projects, entry), 'utf8').length);
    }
  }
  return sizes;
}

/**
 * The terminal is drawn on a canvas, so the text check can't see into it: the demo home gets its own shell
 * start-up files with a prompt that shows only the folder, never the user or the Mac's name.
 */
function neutralShell(home: string): void {
  writeFileSync(join(home, '.zshrc'), "PROMPT='%1~ %# '\nunsetopt PROMPT_SP\n");
  writeFileSync(join(home, '.bashrc'), "PS1='\\W $ '\n");
  writeFileSync(join(home, '.bash_profile'), 'source ~/.bashrc\n');
}

/** The user's `claude`, so the demo home can offer it (its helpers find no login there and send nothing). */
function realClaude(): string | null {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    try {
      return realpathSync(join(dir, 'claude'));
    } catch {
      // not here
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Driving the app.

class Tour {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly world: DemoWorld;

  constructor(app: ElectronApplication, page: Page, world: DemoWorld) {
    this.app = app;
    this.page = page;
    this.world = world;
  }

  scheme: 'dark' | 'light' = 'dark';

  q(selector: string): Locator {
    return this.page.locator(selector).first();
  }

  async need(selector: string, what: string, timeout = 10_000): Promise<Locator> {
    const locator = this.q(selector);
    try {
      await locator.waitFor({ state: 'visible', timeout });
    } catch {
      await this.page.screenshot({ path: join(outDir, '..', 'failed.png') });
      throw new Error(`${what} (waited for ${selector}; see website/src/assets/failed.png)`);
    }
    return locator;
  }

  async gone(selector: string, what: string): Promise<void> {
    try {
      await this.page.locator(selector).first().waitFor({ state: 'detached', timeout: 8_000 });
    } catch {
      throw new Error(what);
    }
  }

  /** Polls a condition in the page (the app's CSP stops Playwright's own string waits). */
  async until(expression: string, what: string, timeout = 10_000): Promise<void> {
    const end = Date.now() + timeout;
    let last: unknown;
    while (Date.now() < end) {
      last = await this.page.evaluate(`Boolean(${expression})`).catch((e: Error) => `threw ${e.message}`);
      if (last === true) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.page.screenshot({ path: join(outDir, '..', 'failed.png') });
    throw new Error(`${what} (waited for ${expression}, last ${JSON.stringify(last)}; see website/src/assets/failed.png)`);
  }

  async click(selector: string, what = `no ${selector}`): Promise<void> {
    await (await this.need(selector, what)).click();
  }

  async press(keys: string): Promise<void> {
    await this.page.keyboard.press(keys);
  }

  async escape(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.press('Escape');
  }

  /** Until no finite animation runs (a panel sliding open), then one painted frame. */
  async settle(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const end = performance.now() + 2_000;
          const moving = () => document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
          const tick = () => (moving() && performance.now() < end ? requestAnimationFrame(tick) : requestAnimationFrame(() => resolve()));
          requestAnimationFrame(tick);
        }),
    );
  }

  async sessionId(title: string): Promise<string> {
    const id = await this.page.evaluate((t) => [...document.querySelectorAll<HTMLElement>('[data-session-id]')].find((el) => el.innerText.includes(t))?.dataset.sessionId ?? null, title);
    if (!id) throw new Error(`no session "${title}" in the sidebar`);
    return id;
  }

  async openSession(title: string): Promise<string> {
    const id = await this.sessionId(title);
    await this.click(`[data-session-list] [data-session-id="${id}"], [data-sidebar-state] [data-session-id="${id}"]`);
    await this.need(`[data-current-session="${id}"] [data-transcript-item]`, `"${title}" did not open`);
    return id;
  }

  async home(): Promise<void> {
    await this.click('[data-go-home]');
    await this.need('[data-home]', 'Home did not open');
  }

  /** Runs a palette command by its id, typing its title like a person would. */
  async command(id: string, title: string): Promise<void> {
    await this.press('Meta+K');
    const input = await this.need('[data-command-palette] [data-palette-input]', '⌘K did not open the palette');
    await input.fill(title);
    await this.click(`[data-command-palette] [data-palette-command="${id}"]`, `the palette did not offer ${id}`);
  }

  async closePalette(): Promise<void> {
    if (await this.page.locator('[data-command-palette]').count()) await this.escape(3);
    await this.gone('[data-command-palette]', 'the palette did not close');
  }

  async setScheme(scheme: 'dark' | 'light'): Promise<void> {
    this.scheme = scheme;
    await this.command(`theme-${scheme}`, `Appearance: ${scheme === 'dark' ? 'Dark' : 'Light'}`);
    // Playwright emulates the page's colour scheme itself (light by default); follow the app's choice.
    await this.page.emulateMedia({ colorScheme: scheme });
    await this.until(`matchMedia('(prefers-color-scheme: ${scheme})').matches`, `the ${scheme} scheme did not apply`);
    await this.settle();
  }

  /** Paths as they would read on a real Mac: the demo home (and this Mac's own) as `~`. */
  async scrub(): Promise<void> {
    const homes = [this.world.home, realHome, `/private${this.world.home}`].sort((a, b) => b.length - a.length);
    await this.page.evaluate((homes) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      // The throwaway app profile lives in a temporary folder; show where a real install keeps its data.
      const appData = /(\/private)?\/var\/folders\/\S*?\/T\/switchboard-smoke-[A-Za-z0-9]+/g;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let text = (node.nodeValue ?? '').replace(appData, '~/Library/Application Support/Switchboard');
        for (const home of homes) text = text.split(home).join('~');
        if (text !== node.nodeValue) node.nodeValue = text;
      }
      for (const el of document.querySelectorAll<HTMLElement>('[data-tooltip], [title]')) {
        for (const attr of ['data-tooltip', 'title']) {
          const value = el.getAttribute(attr);
          if (!value) continue;
          let text = value;
          for (const home of homes) text = text.split(home).join('~');
          if (text !== value) el.setAttribute(attr, text);
        }
      }
    }, homes);
    const leaks = await this.page.evaluate(
      ({ realHome, realUser }) => {
        const text = document.body.innerText;
        return [realHome, realUser.length >= 3 ? realUser : null].filter((s): s is string => !!s && text.includes(s));
      },
      { realHome, realUser },
    );
    if (leaks.length) throw new Error(`personal data on screen: ${leaks.join(', ')}`);
  }

  /** Saves the window (or one element of it) as <name>-<scheme>.png. */
  async shot(name: string, options: { clip?: string; keepFocus?: boolean; pad?: number } = {}): Promise<void> {
    if (!options.keepFocus) await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    // No tooltips or hover states left over from the clicks that got here.
    await this.page.mouse.move(SIZE.width - 2, SIZE.height - 2);
    await this.settle();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await dismissToasts(this);
    await this.scrub();
    const path = join(outDir, `${name}-${this.scheme}.png`);
    if (options.clip) {
      const box = await (await this.need(options.clip, `nothing to take for ${name}`)).boundingBox();
      if (!box) throw new Error(`${options.clip} has no size`);
      const pad = options.pad ?? 0;
      await this.page.screenshot({
        path,
        clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(SIZE.width, box.width + pad * 2), height: Math.min(SIZE.height, box.height + pad * 2) },
      });
    } else {
      await this.page.screenshot({ path });
    }
    // 256 colours: a fraction of the size, and the UI's flat colours survive it (Astro makes WebP from these anyway).
    const buffer = await sharp(path).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toBuffer();
    writeFileSync(path, buffer);
    console.log(`  ${name}-${this.scheme}.png`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The screens, in order. Each starts from Home with nothing open, and leaves it that way.

type Screen = { name: string; take(t: Tour): Promise<void> };

const HERO = 'Add dark mode toggle';
const WORKING = 'Fix rounding';
const NEEDS_YOU = 'Upgrade Stripe';

const screens: Screen[] = [
  {
    name: 'home',
    async take(t) {
      await t.home();
      await hideUsageStatus(t);
      await t.shot('home');
    },
  },
  {
    name: 'sidebar',
    async take(t) {
      await t.home();
      await t.shot('sidebar', { clip: '[data-sidebar-state]' });
    },
  },
  {
    name: 'main-window',
    async take(t) {
      await t.openSession(HERO);
      await openChanges(t);
      await t.shot('main-window');
      await t.click('[data-toggle-changes]');
      await t.gone('[data-changes-panel]', 'the Changes panel did not close');
    },
  },
  {
    name: 'conversation',
    async take(t) {
      await t.openSession(HERO);
      await t.shot('conversation');
    },
  },
  {
    name: 'code-block',
    async take(t) {
      await t.openSession(HERO);
      const block = t.page.locator('[data-current-session] [data-transcript-item] pre').last();
      await block.scrollIntoViewIfNeeded();
      await t.settle();
      const box = await block.boundingBox();
      if (!box) throw new Error('no code block');
      await t.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await t.scrub();
      const pad = 16;
      const path = join(outDir, `code-block-${t.scheme}.png`);
      await t.page.screenshot({ path, clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 } });
      console.log(`  code-block-${t.scheme}.png`);
    },
  },
  {
    name: 'tools',
    async take(t) {
      await t.openSession(HERO);
      await t.command('tools', 'Tools: MCP');
      await t.need('[data-capabilities]', 'Tools did not open');
      await t.shot('tools');
      await t.escape();
      await t.gone('[data-capabilities]', 'Tools did not close');
    },
  },
  {
    name: 'search',
    async take(t) {
      await t.home();
      await t.press('Meta+Shift+F');
      await (await t.need('[data-search] input', '⌘⇧F did not open search')).fill('theme');
      await t.need('[data-search-hit]', 'search found nothing', 30_000);
      await t.shot('search', { keepFocus: true });
      await t.escape();
      await t.gone('[data-search]', 'search did not close');
    },
  },
  {
    name: 'find',
    async take(t) {
      await t.openSession(HERO);
      await t.press('Meta+F');
      await (await t.need('[data-find-input]', '⌘F did not open Find')).fill('theme');
      await t.until(`/[1-9]/.test(document.querySelector('[data-find-count]')?.textContent ?? '')`, 'Find counted no matches');
      await t.shot('find', { keepFocus: true });
      await t.escape();
    },
  },
  {
    name: 'split',
    async take(t) {
      await t.openSession(HERO);
      const working = await t.sessionId(WORKING);
      await t.q(`[data-sidebar-state] [data-session-id="${working}"]`).click({ modifiers: ['Alt'] });
      await t.until(`document.querySelectorAll('[data-pane]').length === 2 && document.querySelector('[data-current-session="${working}"] [data-transcript-item]')`, 'the second pane did not open');
      await t.shot('split');
      await t.click('[data-pane="split"] [data-close-pane]');
      await t.gone('[data-split]', 'the second pane did not close');
    },
  },
  {
    name: 'permissions',
    async take(t) {
      await t.openSession(NEEDS_YOU);
      await t.shot('permissions');
    },
  },
  {
    name: 'terminal',
    async take(t) {
      await t.openSession(HERO);
      await t.press('Meta+J');
      await t.need('[data-terminal-panel] [data-terminal]', '⌘J did not open the terminal');
      // The shell's first prompt (drawn on a canvas, so there is nothing to wait for in the page).
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      // Type into the shell itself, never the message box (Enter there would send to Claude).
      await t.q('[data-terminal-panel] [data-terminal]').click();
      await t.until(`!!document.activeElement?.closest('[data-terminal-panel]')`, 'the terminal did not take focus');
      await t.press('Meta+K');
      await t.page.keyboard.type('git status --short');
      await t.press('Enter');
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await t.shot('terminal', { keepFocus: true });
      await t.page.locator('[data-current-session]').first().click({ position: { x: 400, y: 120 } });
      await t.press('Meta+J');
      await t.gone('[data-terminal-panel]', 'the terminal did not close');
    },
  },
  {
    name: 'git-menu',
    async take(t) {
      await t.openSession(HERO);
      // The ▾ next to the git button. The button itself runs its step (Commit asks Claude), so never click that.
      await t.click('[data-git-button] [data-git-menu]');
      await t.need('[role="menu"][aria-label="Git"], [role="menu"]', 'the git menu did not open');
      await t.shot('git-menu', { keepFocus: true });
      await t.escape();
    },
  },
  {
    name: 'shortcuts',
    async take(t) {
      await t.openSession(HERO);
      await t.press('Meta+/');
      await t.need('[data-shortcuts-sheet] [data-shortcut-row]', '⌘/ did not open the shortcuts sheet');
      await t.shot('shortcuts', { keepFocus: true });
      await t.escape();
      await t.gone('[data-shortcuts-sheet]', 'the shortcuts sheet did not close');
    },
  },
  {
    name: 'palette',
    async take(t) {
      await t.openSession(HERO);
      await t.press('Meta+K');
      await t.need('[data-command-palette] [data-palette-command]', '⌘K did not open the palette');
      await t.shot('palette', { keepFocus: true });
      await t.closePalette();
    },
  },
  {
    name: 'palette-new-session',
    async take(t) {
      await t.home();
      await t.press('Meta+K');
      await (await t.need('[data-command-palette] [data-palette-input]', 'no palette')).fill('new session');
      await t.until(`document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand === 'new-session'`, '"new session" did not find New session…');
      await t.press('Enter');
      await t.until(`document.querySelectorAll('[data-command-palette] [data-palette-project]').length >= 3`, 'New session… did not list the projects');
      await t.shot('palette-new-session', { keepFocus: true });
      await t.closePalette();
    },
  },
  {
    name: 'palette-goto',
    async take(t) {
      await t.home();
      await t.press('Meta+P');
      await t.need('[data-command-palette] [data-palette-session], [data-command-palette] [data-palette-project]', '⌘P listed nothing');
      await t.shot('palette-goto', { keepFocus: true });
      await t.closePalette();
    },
  },
  {
    name: 'new-session',
    async take(t) {
      await openNewSession(t, 'acme-store');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('Add a keyboard shortcut that switches between light and dark mode, and show it next to the toggle in Settings.');
      await t.shot('new-session');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('');
    },
  },
  {
    name: 'new-session-options',
    async take(t) {
      await openNewSession(t, 'acme-store');
      await t.click('[data-new-session-view] [data-model-select]');
      await t.need('[data-menu="model"], [role="menu"], [role="listbox"]', 'the model menu did not open');
      await t.shot('new-session-options', { keepFocus: true });
      await t.escape();
    },
  },
  {
    name: 'new-session-worktree',
    async take(t) {
      await openNewSession(t, 'acme-store');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('Add product search with filters for price and brand.');
      await t.click('[data-new-session-view] [data-start-menu]');
      await t.need('[data-start-worktree]', 'Start’s menu has no worktree option');
      await t.shot('new-session-worktree', { keepFocus: true });
      await t.escape();
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('');
    },
  },
  {
    name: 'quick-question',
    async take(t) {
      await t.home();
      await t.press('Meta+Shift+N');
      await t.need('[data-new-session-view]', '⌘⇧N did not open New session');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('What is the difference between git rebase and git merge?');
      await t.shot('quick-question');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('');
    },
  },
  {
    name: 'queue',
    async take(t) {
      await t.home();
      await t.need('[data-home-queue] [data-queue-item]', 'Home shows no queue');
      await hideUsageStatus(t);
      await t.shot('queue');
    },
  },
  {
    name: 'drafts',
    async take(t) {
      await t.home();
      await t.click('[data-drafts-count]', 'the sidebar footer has no unsent count');
      await t.need('[data-unsent-list] [data-unsent-item]', 'the unsent list did not open');
      await t.shot('drafts', { keepFocus: true });
      await t.escape();
    },
  },
  {
    name: 'archived',
    async take(t) {
      await t.home();
      if (!(await t.page.locator('[data-archived-header]').count())) await t.click('[data-archived-toggle]');
      await t.until(`document.querySelectorAll('[data-sidebar-state] [data-archived] [data-session-id], [data-sidebar-state] [data-session-group="archived"] [data-session-id]').length > 0 || !!document.querySelector('[data-archived-header]')`, 'Archived did not open');
      await t.shot('archived', { clip: '[data-sidebar-state]' });
      await t.click('[data-archived-toggle]');
      await t.need('[data-archived-dock]', 'Archived did not close');
    },
  },
  {
    name: 'sidebar-rail',
    async take(t) {
      await t.home();
      await t.command('sidebar-minimize', 'Minimize sidebar');
      await t.need('[data-sidebar-rail]', 'the rail did not show');
      await t.settle();
      await hideUsageStatus(t);
      await t.shot('sidebar-rail');
      await t.command('sidebar-open', 'Open sidebar');
      await t.gone('[data-sidebar-rail]', 'the sidebar did not open again');
    },
  },
  {
    name: 'focus',
    async take(t) {
      await t.home();
      await t.click('[data-focus-counter]', 'no focus counter (is the focus limit on?)');
      await t.need('[data-focus-popover]', 'the focus popover did not open');
      await t.shot('focus', { keepFocus: true });
      await t.escape();
    },
  },
  {
    name: 'projects-view',
    async take(t) {
      await t.click('[data-open-projects]');
      await t.need('[data-project-manager] [data-project-row]', 'Projects listed nothing');
      await t.need('[data-worktree-pill]', 'no worktree pill', 30_000);
      await t.shot('projects-view');
      await t.home();
    },
  },
  ...(['overview', 'sessions', 'worktrees', 'branches', 'actions', 'settings'] as const).map(
    (tab): Screen => ({
      name: `project-${tab}`,
      async take(t) {
        await openProjectPage(t, 'acme-store');
        await t.click(`[data-project-tab="${tab}"]`);
        const ready: Record<typeof tab, string> = {
          overview: '[data-project-overview] [data-overview-card]',
          sessions: '[data-project-sessions] [data-session-id]',
          worktrees: '[data-worktrees-table] [data-worktree-row]',
          branches: '[data-branches-table] [data-branch-row]',
          actions: '[data-project-actions-tab] [data-project-action]',
          settings: '[data-project-defaults-tab]',
        };
        await t.need(ready[tab], `the ${tab} tab showed nothing`, 30_000);
        if (tab === 'worktrees' || tab === 'branches' || tab === 'overview') await t.gone('[data-worktrees-loading], [data-branches-loading]', `${tab} kept loading`);
        await t.shot(`project-${tab}`);
        await t.home();
      },
    }),
  ),
  {
    name: 'theme-catppuccin',
    async take(t) {
      await t.command('theme:catppuccin', 'Theme: Catppuccin');
      await t.openSession(HERO);
      await openChanges(t);
      await t.shot('theme-catppuccin');
      await t.click('[data-toggle-changes]');
      await t.command('theme:demo-time', 'Theme: Demo Time');
      await t.home();
    },
  },
  ...(['general', 'theme', 'sidebar', 'conversation', 'focus', 'profiles', 'vscode', 'backup', 'diagnostics', 'about'] as const).map(
    (section): Screen => ({
      name: `settings-${section}`,
      async take(t) {
        await t.click('[data-open-settings]');
        await t.click(`[data-settings-section="${section}"]`);
        await t.until(`document.querySelector('[data-settings-section="${section}"]')?.getAttribute('aria-current') === 'page' || document.querySelector('[data-settings-section="${section}"]')?.hasAttribute('data-active') || true`, 'no section');
        await t.settle();
        await t.shot(`settings-${section}`);
        await t.click('[data-close-settings]');
      },
    }),
  ),
];

async function hideUsageStatus(t: Tour): Promise<void> {
  // The demo logins have no credentials, so usage could only say it is unavailable.
  await t.page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-home-profile] [data-usage-status], [data-usage-band] [data-usage-status]').forEach((el) => el.style.setProperty('display', 'none')));
}

async function openChanges(t: Tour): Promise<void> {
  await t.need('[data-toggle-changes]', 'no Changes button');
  if (!(await t.page.locator('[data-changes-panel]').count())) await t.click('[data-toggle-changes]');
  await t.need('[data-changed-file]', 'the Changes panel listed no files');
  if (!(await t.page.locator('[data-changed-file="src/lib/theme.ts"] [data-file-diff] div').count())) {
    await t.click('[data-changed-file="src/lib/theme.ts"] [data-file-toggle]');
  }
  await t.need('[data-file-diff] div', 'the diff did not open');
}

async function openNewSession(t: Tour, project: string): Promise<void> {
  await t.home();
  await t.press('Meta+N');
  await t.need('[data-new-session-view] [data-folder-select]', 'New session did not open');
  const index = await t.page.evaluate((name) => [...document.querySelectorAll<HTMLElement>('[data-new-session-view] [data-folder-option], [data-new-session-view] [data-home-project], [data-new-session-view] [data-project-root]')].findIndex((el) => (el.dataset.projectRoot ?? el.dataset.value ?? el.innerText).includes(name)), project);
  // ⌘1..9 pick the recent projects in New session; find the one whose root ends in the project.
  for (let n = 1; n <= 9; n++) {
    const value = await t.page.evaluate(() => document.querySelector<HTMLElement>('[data-folder-select]')?.dataset.value ?? '');
    if (value.endsWith(`/${project}`)) return;
    await t.press(`Meta+${n}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  void index;
  throw new Error(`New session could not pick ${project}`);
}

async function openProjectPage(t: Tour, project: string): Promise<void> {
  await t.command(`project:${t.world.home}/Developer/${project}`, `Project: ${project}`);
  await t.need('[data-project-page]', `the ${project} page did not open`);
}

// ---------------------------------------------------------------------------------------------------------
// Setup: what someone would do after installing, then the state the pictures need.

async function setUp(t: Tour): Promise<void> {
  await t.need('[data-session-id]', 'the sidebar listed no sessions', 30_000);

  // A second Claude profile (the demo's ~/.claude-work), added in Settings like a person would.
  await t.click('[data-open-settings]');
  await t.click('[data-settings-section="profiles"]');
  await t.click('[data-add-profile]');
  await (await t.need('[data-new-profile-name]', 'the add profile form did not open')).fill('Work');
  await t.q('[data-new-profile-folder]').fill(join(t.world.home, '.claude-work'));
  await t.click('[data-add-profile-submit]');
  await t.until(`document.querySelectorAll('[data-profiles] [data-profile]').length === 2`, 'the Work profile was not added');
  await t.click('[data-close-settings]');
  await t.until(`[...document.querySelectorAll('[data-session-id]')].some((el) => el.innerText.includes(${JSON.stringify(WORKING)}))`, 'the Work profile’s sessions did not show up', 15_000);

  // The demo projects, added from the folders Claude Code has been used in.
  await t.click('[data-open-projects]');
  await t.click('[data-manager-add]');
  await t.need('[data-add-project-dialog] [data-known-project]', 'no folders offered to add');
  for (let i = 0; i < 8; i++) {
    const next = t.page.locator('[data-known-project][data-added="false"]').first();
    if (!(await next.count())) break;
    await next.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await t.escape();
  await t.gone('[data-add-project-dialog]', 'the add project dialog did not close');

  // Pin the session people come back to.
  await t.openSession('Refactor auth middleware');
  await t.command('pin', 'Pin');

  // An unsent message in a finished session.
  await t.openSession('Investigate flaky checkout');
  await t.page.locator('[data-current-session] [data-composer]').first().fill('Can you also check the same race in the cart test?');
  await t.home();
  await t.need('[data-drafts-count]', 'the unsent message was not kept');

  // Two queued prompts: one for a free project (ready), one that waits for payments-api to be free.
  let queued = 0;
  for (const [project, prompt] of [
    ['acme-store', 'Add product search with filters for price and brand.'],
    ['payments-api', 'Add idempotency keys to the refund endpoint.'],
  ] as const) {
    await openNewSession(t, project);
    await t.page.locator('[data-new-session-view] [data-composer]').first().fill(prompt);
    await t.press('Meta+Shift+Enter');
    queued++;
    await t.until(`new Set([...document.querySelectorAll('[data-queue-item]')].map((el) => el.dataset.queueItem)).size === ${queued}`, `${project}: the prompt was not added to the queue`);
  }
  await t.home();

  // The focus limit, counting terminal sessions too, so the counter has something to show.
  await t.click('[data-open-settings]');
  await t.click('[data-settings-section="focus"]');
  await t.click('[data-focus-limit-switch]');
  await t.need('[data-focus-options]', 'the focus options did not show');
  if (await t.page.locator('[data-focus-count-external]').count()) {
    const external = t.q('[data-focus-count-external]');
    if ((await external.getAttribute('aria-checked')) === 'false') await external.click();
  }
  await t.click('[data-close-settings]');
  await t.home();
  await dismissToasts(t);
}

/** Toasts from the setup ("Added to the queue") would show in the pictures: hide the toast layer. */
async function dismissToasts(t: Tour): Promise<void> {
  await t.page.evaluate(() => {
    if (document.getElementById('website-shots-no-toasts')) return;
    const style = document.createElement('style');
    style.id = 'website-shots-no-toasts';
    style.textContent = '[data-toasts], [data-toast], [data-update-toast], [data-claude-update-toast] { display: none !important; }';
    document.head.append(style);
  });
}

// ---------------------------------------------------------------------------------------------------------

const world = createDemoWorld();
extendWorld(world);
neutralShell(world.home);
const claude = realClaude();
if (claude) {
  mkdirSync(join(world.home, '.local', 'bin'), { recursive: true });
  symlinkSync(claude, join(world.home, '.local', 'bin', 'claude'));
}
mkdirSync(outDir, { recursive: true });
console.log(`demo home: ${world.home}`);
// The registry the app checks offers the version that is installed, so Settings says Claude Code is up to date.
const claudeVersion = claude ? (/\d+\.\d+\.\d+/.exec(execFileSync(claude, ['--version'], { encoding: 'utf8' }))?.[0] ?? '2.0.0') : '2.0.0';

const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const app = await _electron.launch({
  executablePath: electronPath,
  args: [appDir, `--force-device-scale-factor=${SCALE}`],
  env: {
    ...env,
    HOME: world.home,
    CLAUDE_CONFIG_DIR: join(world.home, '.claude'),
    SWITCHBOARD_DRIVEN: '1',
    // No "Claude Code vX is available" in the pictures: the registry offers nothing newer.
    SWITCHBOARD_CLAUDE_REGISTRY: `data:application/json,${encodeURIComponent(JSON.stringify({ latest: claudeVersion, stable: claudeVersion }))}`,
    USER: 'you',
    LOGNAME: 'you',
    ELECTRON_ENABLE_LOGGING: '0',
  } as Record<string, string>,
  timeout: 60_000,
});

const transcriptsBefore = transcripts(world.home);
let failed = false;
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setContentSize(size.width, size.height);
    win.center();
  }, SIZE);
  page.setDefaultTimeout(15_000);
  const tour = new Tour(app, page, world);
  await setUp(tour);
  for (const scheme of ['dark', 'light'] as const) {
    await tour.setScheme(scheme);
    for (const screen of screens) {
      if (only && !only.has(screen.name)) continue;
      await screen.take(tour);
    }
  }
} catch (error) {
  failed = true;
  console.error(`✗ ${(error as Error).message}`);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  const grew = [...transcripts(world.home)].filter(([path, size]) => size !== transcriptsBefore.get(path));
  if (grew.length) {
    failed = true;
    console.error(`✗ the tour sent something to Claude: ${grew.length} transcript(s) changed. Check the clicks and key presses in this script.`);
  }
  world.stop();
  rmSync(world.home, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log(`✓ screenshots written to ${outDir}`);
