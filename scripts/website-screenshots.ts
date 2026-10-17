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
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { _electron, chromium, type ElectronApplication, type Locator, type Page } from 'playwright-core';
import sharp from 'sharp';
import { createDemoWorld, type DemoWorld } from '../apps/desktop/scripts/screenshot-demo.ts';
import { x25519 } from '@noble/curves/ed25519.js';

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
 * The tour's gh (SWITCHBOARD_GH): signed in, unless the file `.fake-gh-signed-out` is in the demo home, and nothing
 * else works, so pull request lists stay empty and nothing ever reaches GitHub. While `.fake-gh-checks` is there (the
 * checks it holds), feat/dark-mode has pull request #42 with those checks.
 */
function fakeGh(home: string): string {
  const path = join(home, '.local', 'bin', 'fake-gh');
  mkdirSync(join(path, '..'), { recursive: true });
  const signedOut = join(home, '.fake-gh-signed-out');
  const checks = join(home, '.fake-gh-checks');
  const pr = JSON.stringify([{ number: 42, state: 'OPEN', headRefName: 'feat/dark-mode', url: 'https://github.com/acme/acme-store/pull/42', isDraft: false }]);
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      'if [ "$1 $2" = "auth status" ]; then',
      `  if [ -f '${signedOut}' ]; then echo 'You are not logged into any GitHub hosts. To log in, run: gh auth login' >&2; exit 1; fi`,
      '  exit 0',
      'fi',
      `if [ -f '${checks}' ]; then`,
      `  if [ "$1 $2" = "pr list" ]; then echo '${pr}'; exit 0; fi`,
      `  if [ "$1 $2" = "pr checks" ]; then cat '${checks}'; exit 1; fi`,
      'fi',
      `echo "the screenshot tour's gh never reaches GitHub" >&2`,
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(path, 0o755);
  return path;
}

/**
 * For the Create pull request pictures: acme-store's origin reads as a GitHub repository (the dialog shows
 * `owner/name`) until the returned function puts the demo remote back. Nothing is pushed or fetched meanwhile.
 */
function githubOrigin(world: DemoWorld): () => void {
  const acme = join(world.home, 'Developer', 'acme-store');
  const remote = git(acme, ['remote', 'get-url', 'origin']).trim();
  git(acme, ['remote', 'set-url', 'origin', 'git@github.com:acme/acme-store.git']);
  return () => void git(acme, ['remote', 'set-url', 'origin', remote]);
}

/** Opens Create PR… from the hero session's git menu and waits for the dialog to have read the branch. */
async function openPullRequestDialog(t: Tour): Promise<void> {
  await t.openSession(HERO);
  await t.click('[data-git-button] [data-git-menu]');
  await t.click('[role="menu"] [data-git-step="pr"]', 'no Create PR… in the git menu');
  await t.need('[data-pr-dialog] [data-pr-title]', 'the Create pull request dialog did not read the branch', 15_000);
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
  // Keep Claude Code's worktree folder (and the pull request template below) out of the demo project's own changes.
  writeFileSync(join(acme, '.git', 'info', 'exclude'), '.claude/worktrees/\n.switchboard.json\n.github/\n');
  // What Create pull request fills the description in with.
  mkdirSync(join(acme, '.github'), { recursive: true });
  writeFileSync(join(acme, '.github', 'pull_request_template.md'), '## What changed\n\n\n## How to test\n\n- [ ] npm test\n- [ ] Switch the theme in Settings and reload\n\n## Screenshots\n\n<!-- drag images here -->\n');

  // Instructions the team shares, committed with the project: CLAUDE.md and a rule for test files.
  commitFile(acme, 'src/lib/payments.ts', 'export const providers = { cards: "stripe", local: "adyen" } as const;\n', 'Add payment providers');
  commitFile(acme, 'CLAUDE.md', '# Acme Store\n\nA React web shop built with Vite.\n\n## Commands\n\n- `npm run dev` starts the dev server.\n- `npm test` runs Vitest.\n\n## Conventions\n\n- Components live in `src/components`, one per file.\n- Prices are integers in cents, never floats.\n', 'Add CLAUDE.md');
  commitFile(acme, '.claude/rules/testing.md', '---\npaths:\n  - "src/**/*.test.ts"\n---\n\n# Tests\n\n- Use Vitest and Testing Library.\n- Never mock the database; use the test container.\n', 'Add a rule for tests');
  writeMemories(join(world.home, '.claude', 'projects', acme.replace(/[^a-zA-Z0-9]/g, '-'), 'memory'), world.sessions.hero);

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
        // Saved prompts the team shares.
        prompts: [
          { id: 'fix-failing-test', name: 'Fix failing test', text: 'Fix {{test:file}}. It fails on {{branch:branch}} since the last merge.' },
          { id: 'review-pull-request', name: 'Review pull request', text: 'Review {{pr:pr}}. Focus on {{focus:choice=security|performance|tests}}.' },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Every transcript and memory file in the demo's Claude config folders, with its length. The tour must never send
 * anything to Claude or save a memory; a file that changed means it did, and the run fails.
 */
function transcripts(home: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const config of ['.claude', '.claude-work']) {
    const projects = join(home, config, 'projects');
    for (const entry of readdirSync(projects, { recursive: true, encoding: 'utf8' })) {
      if (entry.endsWith('.jsonl') || entry.endsWith('.md')) sizes.set(join(projects, entry), readFileSync(join(projects, entry), 'utf8').length);
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

/** A memory file as Claude Code writes it: frontmatter with the type under `metadata`, then the text. */
function memory(name: string, description: string, type: string, body: string, modified: Date, origin?: string): string {
  const meta = [`  type: ${type}`, ...(origin ? [`  originSessionId: ${origin}`] : []), `  modified: ${modified.toISOString()}`];
  return `---\nname: ${name}\ndescription: ${description}\nmetadata:\n${meta.join('\n')}\n---\n\n${body}\n`;
}

/**
 * What Claude Code remembers about acme-store: a few linked memories, one that names a file the project no
 * longer has and one missing from MEMORY.md (so the health check has something to say), and one old one.
 */
function writeMemories(dir: string, heroSession: string): void {
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const files: Array<[string, string]> = [
    ['checkout-flow.md', memory('checkout-flow', 'Checkout is three steps: cart, shipping, payment', 'project', 'Checkout runs in three steps: cart, shipping, then payment. Payment hands off to the provider in [[payment-providers]] and comes back to `/checkout/done`.\n\nThe shipping step waits for the rates request before **Pay** is enabled; the flaky test was about that.', new Date(now - 2 * DAY))],
    ['payment-providers.md', memory('payment-providers', 'Stripe for cards, Adyen for iDEAL and Bancontact', 'reference', 'Cards go through Stripe. iDEAL and Bancontact go through Adyen. Both are wrapped in `src/lib/payments.ts`.', new Date(now - 6 * DAY))],
    ['testing-conventions.md', memory('testing-conventions', 'Run one test file at a time while working', 'feedback', 'Run `npm test -- <file>` for the file you change, not the whole suite. The full suite runs in CI, see [[ci-pipeline]].\n\n**Why:** the full run takes four minutes.\n**How to apply:** only run everything before you push.', new Date(now - 3 * DAY))],
    ['theme-tokens.md', memory('theme-tokens', 'Colours come from the theme tokens, never hex values', 'project', 'Every colour comes from a token in `src/styles/legacy-theme.css`. Dark mode swaps the token values, so components never check the theme themselves.', new Date(now - 26 * 60 * 1000), heroSession)],
    ['release-process.md', memory('release-process', 'Releases go out on Tuesdays after the smoke test', 'project', 'Releases are tagged on Tuesday mornings, after the smoke test passes on staging.', new Date(now - 210 * DAY))],
  ];
  for (const [file, content] of files) {
    writeFileSync(join(dir, file), content);
    // Switchboard dates a memory by its file, as Claude Code does: match the frontmatter.
    const modified = new Date(/modified: (\S+)/.exec(content)![1]!);
    utimesSync(join(dir, file), modified, modified);
  }
  // The index, as Claude Code keeps it; release-process.md has no line yet.
  writeFileSync(
    join(dir, 'MEMORY.md'),
    [
      '- [Checkout flow](checkout-flow.md) — three steps, payment hands off to the provider',
      '- [Payment providers](payment-providers.md) — Stripe for cards, Adyen for local methods',
      '- [Testing conventions](testing-conventions.md) — one test file at a time while working',
      '- [Theme tokens](theme-tokens.md) — colours only through tokens',
      '',
    ].join('\n'),
  );
}

/** Personal memory, in the throwaway profile's own folder (where Switchboard keeps it until you choose another). */
function writePersonalMemory(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const write = (file: string, content: string) => {
    writeFileSync(join(dir, file), content);
    const modified = new Date(/modified: (\S+)/.exec(content)![1]!);
    utimesSync(join(dir, file), modified, modified);
  };
  write('about-me.md', memory('about-me', 'Front-end developer, works in TypeScript and React', 'user', 'I work mostly on front ends in TypeScript and React, and on a Mac.', new Date(now - 20 * DAY)));
  write('writing-style.md', memory('writing-style', 'Short commit messages in the imperative', 'feedback', 'Commit messages: one short line in the imperative, no emoji.\n\n**Why:** they read well in `git log --oneline`.', new Date(now - 9 * DAY)));
  writeFileSync(join(dir, 'MEMORY.md'), `- [About me](${join(dir, 'about-me.md')}) — front-end developer\n- [Writing style](${join(dir, 'writing-style.md')}) — short imperative commits\n`);
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

/**
 * Another computer named "mystic" for the Other computers pictures: the real Remote hub over the made-up sessions of
 * scripts/remote-demo.ts, in a throwaway folder on a free port. It pairs through Settings › Remote as a person would,
 * `take` runs, then the computer is removed and the hub stopped, so no other picture shows it.
 */
async function withComputer(t: Tour, take: (computerId: string) => Promise<void>): Promise<void> {
  const port = await new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-shots-computer-'));
  const linkFile = join(dir, 'link.txt');
  const hub = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', join(root, 'scripts', 'remote-demo.ts')], {
    env: { ...process.env, SWITCHBOARD_DEMO_DIR: dir, SWITCHBOARD_DEMO_NAME: 'mystic', SWITCHBOARD_DEMO_LINK_FILE: linkFile, PORT: String(port) },
    stdio: 'ignore',
  });
  try {
    const started = Date.now();
    while (!existsSync(linkFile)) {
      if (Date.now() - started > 20_000) throw new Error('the demo computer wrote no pairing link');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await t.click('[data-open-settings]');
    await t.click('[data-settings-section="remote"]');
    await t.page.fill('[data-computers-link]', readFileSync(linkFile, 'utf8').trim());
    await t.click('[data-computers-add]');
    await t.need('[data-computer][data-computer-state="connected"]', 'the demo computer did not connect', 20_000);
    const computerId = (await t.page.getAttribute('[data-computer]', 'data-computer'))!;
    await t.click('[data-close-settings]');
    await t.need('[data-session-list] [data-remote-row]', 'no remote session in the sidebar');
    await take(computerId);
  } finally {
    await t.home().catch(() => {});
    await t.click('[data-open-settings]').catch(() => {});
    await t.click('[data-settings-section="remote"]').catch(() => {});
    if (await t.page.locator('[data-computer-forget]').count()) {
      await t.click('[data-computer-forget]');
      await t.click('[data-confirm-strip] [data-confirm]');
      await t.gone('[data-computer]', 'the demo computer was not removed').catch(() => {});
    }
    await t.click('[data-close-settings]').catch(() => {});
    hub.kill();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** A port nothing listens on, on this computer. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** Waits until `check` holds, or fails with `message`. */
async function waitFor(check: () => boolean | Promise<boolean>, message: string, timeout = 20_000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeout) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A phone's size for the remote app's pictures: an iPhone, at 2x so the files stay small. */
const PHONE = { width: 390, height: 844 };

/**
 * The remote app on a phone (Remote's page): the real app from apps/remote, served by Vite, against the made-up
 * computer of scripts/remote-demo.ts ("Studio Mac", two profiles), in Chrome at a phone's size with touch. It pairs as a
 * phone would, then takes the first screen, the computer's menu (from its name, the large title) and the sessions
 * drawer in both colour schemes.
 */
async function phoneShots(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-shots-phone-'));
  const [vitePort, hubPort] = [await freePort(), await freePort()];
  const appUrl = `http://localhost:${vitePort}/remote/`;
  const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(vitePort)], { cwd: join(root, 'apps', 'remote'), stdio: 'ignore' });
  const linkFile = join(dir, 'link.txt');
  const hub = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', join(root, 'scripts', 'remote-demo.ts')], {
    env: { ...process.env, SWITCHBOARD_DEMO_DIR: dir, SWITCHBOARD_DEMO_NAME: 'Studio Mac', SWITCHBOARD_DEMO_LINK_FILE: linkFile, SWITCHBOARD_REMOTE_APP_URL: appUrl, PORT: String(hubPort) },
    stdio: 'ignore',
  });
  // Google Chrome when it is there, else Playwright's own Chromium.
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  try {
    await waitFor(() => existsSync(linkFile), 'the demo computer wrote no pairing link');
    await waitFor(() => fetch(appUrl).then((r) => r.ok, () => false), 'Vite did not serve the remote app');
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(readFileSync(linkFile, 'utf8').trim());
    await page.getByRole('button', { name: 'Pair' }).click();
    await page.waitForSelector('[data-remote-computer-title="large"][data-remote-connection="connected"]');
    await page.waitForSelector('[data-remote-usage-card]');
    // The offer to turn on notifications isn't what these pictures are about.
    const notNow = page.getByRole('button', { name: 'Not now' });
    if (await notNow.count()) await notNow.click();
    const shot = async (name: string, scheme: 'dark' | 'light') => {
      // The spinners and the slide of the drawer settle first.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const path = join(outDir, `${name}-${scheme}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      writeFileSync(path, await sharp(path).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toBuffer());
      console.log(`  ${name}-${scheme}.png`);
    };
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate(() => document.querySelector('[data-remote-list]')?.scrollTo(0, 0));
      await shot('remote-phone-first-screen', scheme);

      await page.click('[data-remote-computer-title="large"]');
      await page.waitForSelector('[role=menu]');
      await shot('remote-phone-computer-menu', scheme);
      await page.keyboard.press('Escape');

      // The drawer over a session, the way it opens from the session's header.
      await page.click('[data-remote-list] [data-remote-session]:not([data-remote-session=""])');
      await page.click('[data-remote-drawer-button]');
      await page.waitForSelector('[data-remote-drawer="open"]');
      await shot('remote-phone-drawer', scheme);
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-remote-drawer]', { state: 'detached' });
      await page.goBack();
      await page.waitForSelector('[data-remote-usage-card]');
    }
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    hub.kill();
    vite.kill();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

// ---------------------------------------------------------------------------------------------------------
// The screens, in order. Each starts from Home with nothing open, and leaves it that way.

type Screen = { name: string; take(t: Tour): Promise<void> };

const HERO = 'Add dark mode toggle';
/** The finished session the catch-up pictures open (its catch-up comes with the demo, `demoCatchUps`). */
const CATCH_UP = 'Refactor auth middleware';
const WORKING = 'Fix rounding';
const NEEDS_YOU = 'Upgrade Stripe';

/** The questions for the Ask panel's picture have been asked (in the first colour scheme). */
let sideAsked = false;

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
      // The hero has four prompts: the prompt outline shows its marks beside the conversation.
      await t.need('[data-current-session] [data-prompt-outline] [data-prompt-mark][data-current]', 'the prompt outline beside the conversation');
      await t.shot('conversation');
    },
  },
  {
    name: 'prompt-outline',
    async take(t) {
      await t.openSession(HERO);
      await t.need('[data-current-session] [data-prompt-mark="2"]', 'the prompt outline beside the conversation');
      // From the keyboard, as Tab would get there: the focused mark shows its tooltip and its ring.
      await t.page.evaluate(() => document.querySelector<HTMLElement>('[data-current-session] [data-prompt-mark="1"]')?.focus());
      await t.press('ArrowDown');
      await t.need('[data-current-session] [data-prompt-tooltip]', 'the tooltip of a focused mark');
      await t.shot('prompt-outline', { clip: '[data-current-session] [data-transcript-area]', keepFocus: true });
      await t.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    },
  },
  {
    name: 'turn-details',
    async take(t) {
      // Time, duration and tokens under each reply, with the tokens' tooltip open (from the keyboard, as Tab gets there).
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="conversation"]');
      await t.click('[data-turn-details="tokens"]');
      await t.click('[data-close-settings]');
      await t.openSession(HERO);
      const tokens = t.page.locator('[data-current-session] [data-turn-meta] [data-turn-tokens]').last();
      await tokens.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
        throw new Error('no finished turn with tokens in the hero session');
      });
      await tokens.scrollIntoViewIfNeeded();
      await t.settle();
      await tokens.focus();
      await t.need('[data-turn-tokens-tooltip]', 'the tokens did not open their tooltip on focus');
      await t.shot('turn-details', { clip: '[data-current-session] [data-transcript-area]', keepFocus: true });
      await t.escape();
      await t.gone('[data-turn-tokens-tooltip]', 'Esc did not close the tokens tooltip');
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="conversation"]');
      await t.click('[data-turn-details="duration"]');
      await t.click('[data-close-settings]');
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
      await t.click(`[data-pane="${working}"] [data-close-pane]`);
      await t.gone('[data-split]', 'the second pane did not close');
    },
  },
  {
    // Ask about this session, next to the session Claude is working in, answered by the engine's stub (never a
    // model). The first picture asks a question from the message box and a follow-up in the panel; the second opens
    // the panel again on the same thread.
    name: 'ask-panel',
    async take(t) {
      await t.openSession(WORKING);
      const pane = '[data-current-session]';
      if (!sideAsked) {
        await t.q(`${pane} [data-composer]`).fill('Why were the totals off by a cent?');
        await t.click(`${pane} [data-ask-button]`, 'no Ask button next to Send');
        await t.need(`${pane} [data-ask-panel] [data-ask-item="done"]`, 'the answer did not come in', 15_000);
        await t.q(`${pane} [data-ask-field]`).fill('Which test covers it?');
        await t.q(`${pane} [data-ask-field]`).press('Enter');
        await t.until(`document.querySelectorAll('${pane} [data-ask-item="done"]').length === 2`, 'the follow-up did not get its answer', 15_000);
        sideAsked = true;
      } else {
        await t.click(`${pane} [data-ask-button]`, 'no Ask button next to Send');
        await t.until(`document.querySelectorAll('${pane} [data-ask-item="done"]').length === 2`, 'the panel did not open on the thread');
      }
      await t.shot('ask-panel');
      await t.click(`${pane} [data-ask-close]`);
      await t.gone(`${pane} [data-ask-panel]`, 'the Ask panel did not close');
    },
  },
  {
    name: 'catch-up-banner',
    async take(t) {
      await t.openSession(CATCH_UP);
      // Read sessions show the strip; Show catch-up opens the banner.
      await t.need('[data-current-session] [data-catchup-strip]', 'the catch-up strip did not show');
      await t.shot('catch-up-strip', { clip: '[data-current-session] [data-catchup-strip]', pad: 12 });
      await t.click('[data-current-session] [data-catchup-show]');
      await t.need('[data-current-session] [data-catchup-banner]', 'the catch-up banner did not open');
      await t.shot('catch-up-banner');
      await t.click('[data-current-session] [data-catchup-details-toggle]');
      await t.need('[data-current-session] [data-catchup-details]', 'Details did not open');
      await t.shot('catch-up-banner-details', { clip: '[data-current-session] [data-catchup-banner]', pad: 12 });
      // Folded again, so the session opens on its strip in the other screens.
      await t.click('[data-current-session] [data-catchup-collapse]');
      await t.need('[data-current-session] [data-catchup-strip]', 'the banner did not fold into the strip');
    },
  },
  {
    name: 'sidebar-quickest',
    async take(t) {
      await t.home();
      await t.click('[data-sort-quick]');
      await t.need('[data-session-group="review"]', 'Quickest to unblock did not group the sessions');
      await t.shot('sidebar-quickest', { clip: '[data-sidebar-state]' });
      await t.click('[data-sort-recent]');
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
    name: 'pr-dialog',
    async take(t) {
      const restore = githubOrigin(t.world);
      try {
        await openPullRequestDialog(t);
        await t.shot('pr-dialog');
        await t.escape();
        await t.gone('[data-pr-dialog]', 'Escape did not close Create pull request');
      } finally {
        restore();
      }
    },
  },
  {
    name: 'pr-dialog-error',
    async take(t) {
      const restore = githubOrigin(t.world);
      const signedOut = join(t.world.home, '.fake-gh-signed-out');
      writeFileSync(signedOut, '');
      try {
        await openPullRequestDialog(t);
        await t.need('[data-pr-dialog] [data-pr-notice="GH_AUTH"]', 'the dialog did not say gh is signed out');
        await t.shot('pr-dialog-error');
        await t.escape();
        await t.gone('[data-pr-dialog]', 'Escape did not close Create pull request');
      } finally {
        rmSync(signedOut, { force: true });
        restore();
      }
    },
  },
  {
    name: 'git-checks',
    async take(t) {
      // The checks of a pull request for feat/dark-mode, with times around now. The Branches tab's refresh reads the
      // pull requests again (they are kept for a few minutes); it runs again at the end, so later pictures have none.
      const minutes = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
      const run = (job: number) => `https://github.com/acme/acme-store/actions/runs/1001/job/${job}`;
      const checks = [
        { name: 'test (ubuntu-latest)', state: 'FAILURE', bucket: 'fail', link: run(2001), workflow: 'CI', description: '', startedAt: minutes(9), completedAt: minutes(5.3) },
        { name: 'lint', state: 'SUCCESS', bucket: 'pass', link: run(2002), workflow: 'CI', description: '', startedAt: minutes(9), completedAt: minutes(8.2) },
        { name: 'build', state: 'SUCCESS', bucket: 'pass', link: run(2003), workflow: 'CI', description: '', startedAt: minutes(9), completedAt: minutes(7.75) },
        { name: 'deploy-preview', state: 'IN_PROGRESS', bucket: 'pending', link: run(2004), workflow: 'Preview', description: '', startedAt: minutes(1.2), completedAt: '0001-01-01T00:00:00Z' },
      ];
      const marker = join(t.world.home, '.fake-gh-checks');
      const readPullRequests = async () => {
        await openProjectPage(t, 'acme-store');
        await t.click('[data-project-tab="branches"]');
        await t.need('[data-branches-table] [data-branch-row]', 'the branches tab showed nothing', 30_000);
        await t.click('[data-branch-refresh]');
        await t.gone('[data-branches-loading]', 'the branches kept loading');
        await t.until('!document.querySelector("[data-branch-refresh]:disabled")', 'the branches did not refresh', 30_000);
      };
      writeFileSync(marker, JSON.stringify(checks));
      try {
        await readPullRequests();
        await t.openSession(HERO);
        await t.click('[data-git-button] [data-git-menu]');
        await t.need('[role="menu"] [data-check="fail"]', 'the git menu listed no failed check', 15_000);
        await t.shot('git-checks', { keepFocus: true });
        await t.escape();
      } finally {
        rmSync(marker, { force: true });
        await readPullRequests();
        await t.home();
      }
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
    name: 'auto-model-menu',
    async take(t) {
      await openNewSession(t, 'acme-store');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('Make the update check frequency a setting in General, default once a day.');
      await t.click('[data-new-session-view] [data-model-select]');
      await t.click('[data-menu="model"] [data-choice="auto"]');
      await t.need('[data-new-session-view] [data-model-chip="auto"]', 'picking Auto did not change the chip');
      await t.click('[data-new-session-view] [data-model-select]');
      await t.need('[data-menu="model"] [data-choice="auto"]', 'the model menu has no Auto');
      await t.shot('auto-model-menu', { keepFocus: true });
      await t.escape();
      // Back to the default model, so the other pictures show what they did before.
      await t.click('[data-new-session-view] [data-model-select]');
      await t.click('[data-menu="model"] [data-choice=""]');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('');
    },
  },
  {
    name: 'auto-model-session',
    async take(t) {
      await t.openSession(HERO);
      // The pick shows above the first answer, which a long session leaves out of view: jump to the first prompt.
      await t.click('[data-current-session] [data-prompt-mark="0"]', 'the prompt outline has no first prompt');
      await t.need('[data-auto-pick-line="opus"]', 'the session did not show what Auto picked');
      await t.click('[data-auto-why]');
      await t.need('[data-auto-popover]', 'Why did not open the popover');
      await t.shot('auto-model-session', { keepFocus: true });
      await t.escape();
      await t.gone('[data-auto-popover]', 'Esc did not close the popover');
    },
  },
  {
    name: 'auto-model-settings',
    async take(t) {
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="conversation"]');
      // Below Catch-up on the page: bring it into view for its picture.
      await (await t.need('[data-auto-model-settings]', 'Settings › Conversation has no Auto model block')).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await t.shot('auto-model-settings', { clip: '[data-auto-model-settings]', pad: 16 });
      await t.click('[data-close-settings]');
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
    // Clone from GitHub, from a bare repository in the clone source a driven run clones from (never the network):
    // turned on with ~/Developer as its folder, the form filled in and the clone done, with a prompt. Turned off after.
    name: 'clone-from-github',
    async take(t) {
      const userData = await t.app.evaluate(({ app }) => app.getPath('userData'));
      const work = join(t.world.home, '.tmp-clone', 'design-tokens');
      const bare = join(userData, 'clone-source', 'acme', 'design-tokens.git');
      // Taken once per scheme: start from nothing each time.
      rmSync(work, { recursive: true, force: true });
      rmSync(bare, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      git(work, ['init', '-q', '-b', 'main']);
      commitFile(work, 'README.md', '# Design tokens\n\nColours, type and spacing for the Acme apps.\n', 'Add the README');
      mkdirSync(join(userData, 'clone-source', 'acme'), { recursive: true });
      git(work, ['clone', '-q', '--bare', work, bare]);
      const folder = join(t.world.home, 'Developer');
      await t.app.evaluate((_electron, dir) => {
        process.env.SWITCHBOARD_PICK_FOLDER = dir;
      }, folder);
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="projects"]');
      await t.click('[data-clone-enabled]');
      await t.until(`document.querySelector('[data-clone-enabled]')?.getAttribute('aria-checked') === 'true'`, 'Clone from GitHub did not turn on');
      await t.click('[data-close-settings]');

      await openNewSession(t, 'acme-store');
      await t.click('[data-new-session-view] [data-clone-from-github]');
      await t.page.locator('[data-clone-url]').fill('https://github.com/acme/design-tokens');
      await t.until(`document.querySelector('[data-clone-repo]')?.dataset.clonePlan === 'free'`, 'the clone form did not say where it goes');
      await t.press('Enter');
      await t.until(`document.querySelector('[data-clone-repo]')?.dataset.cloneState === 'done'`, 'the clone did not finish');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('Read the tokens and list the colours that fail contrast in dark mode.');
      await t.settle();
      await t.shot('clone-from-github');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('');

      // Back as it was: the form closed, the project removed, the setting off, the clone gone.
      await t.click('[data-clone-close]');
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="projects"]');
      await t.click('[data-clone-enabled]');
      await t.until(`document.querySelector('[data-clone-enabled]')?.getAttribute('aria-checked') === 'false'`, 'Clone from GitHub did not turn off');
      await t.click('[data-close-settings]');
      const clone = JSON.stringify(join(folder, 'design-tokens'));
      await t.click('[data-open-projects]');
      await t.click(`[data-project-row=${clone}] [data-project-more-button]`);
      await t.click('[role=menu] [data-remove-project]');
      await t.click('[data-confirm]');
      await t.gone(`[data-project-row=${clone}]`, 'the clone was not removed from the projects');
      rmSync(join(folder, 'design-tokens'), { recursive: true, force: true });
      rmSync(join(t.world.home, '.tmp-clone'), { recursive: true, force: true });
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
    name: 'saved-prompts-slash',
    async take(t) {
      await openNewSession(t, 'acme-store');
      await t.click('[data-new-session-view] [data-composer]');
      await t.page.keyboard.insertText('/');
      await t.need('[data-palette] [data-saved-prompt-option]', 'the / menu listed no saved prompts');
      await t.shot('saved-prompts-slash', { keepFocus: true });
      await t.escape();
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('');
    },
  },
  {
    name: 'saved-prompt-fill',
    async take(t) {
      await openNewSession(t, 'acme-store');
      await t.click('[data-new-session-view] [data-saved-prompt-chip="implement-issue"]', 'New session has no chip for Implement issue');
      await t.need('[data-saved-prompt-header]', 'the chip did not put the prompt in the message box');
      await t.until(`document.activeElement?.matches('[data-blank="issue"]')`, 'the first blank did not take the focus');
      // Without GitHub here, the issue's number is taken as typed.
      await t.press('1');
      await t.need('[data-blank-popover] [data-blank-field]', 'typing on the issue did not open its field');
      await t.page.keyboard.type('32');
      await t.click('[data-blank-popover] [data-blank-option="#132"]', 'the typed issue was not offered');
      await t.until(`document.activeElement?.matches('[data-blank="branch"]')`, 'the branch blank did not take the focus');
      await t.press('Enter');
      await t.click('[data-blank-popover] [data-blank-option="feat/wishlist"]', 'the branch list has no feat/wishlist');
      await t.click('[data-new-session-view] [data-composer]');
      await t.page.keyboard.insertText('Keep the wishlist button working while you are there.');
      await t.need('[data-blanks-left="1"]', 'the box did not say 1 blank left');
      await t.shot('saved-prompt-fill', { clip: '[data-new-session-view]', pad: 8 });
      // Back to an empty box, so no unsent prompt is left for the other pictures.
      await t.click('[data-saved-prompt-clear]');
      await t.page.locator('[data-new-session-view] [data-composer]').first().fill('');
    },
  },
  {
    name: 'saved-prompt-editor',
    async take(t) {
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="prompts"]');
      await t.click('[data-saved-prompts-new]', 'Settings › Prompts has no New prompt');
      await (await t.need('[data-prompt-editor-name]', 'New prompt did not open')).fill('Ship a fix');
      await t.click('[data-prompt-editor]');
      await t.page.keyboard.insertText('Fix {{issue:issue}} and add a test for it. Deploy to {{env:choice=staging|production}} when it passes.');
      await t.need('[data-prompt-editor-preview]', 'the editor has no preview line');
      await t.shot('saved-prompt-editor', { keepFocus: true });
      // Never saved: the picture is all it is for.
      await t.click('[data-prompt-editor-dialog] button:has-text("Cancel")');
      await t.gone('[data-prompt-editor-dialog]', 'the prompt editor did not close');
      await t.click('[data-close-settings]');
    },
  },
  {
    name: 'settings-prompts',
    async take(t) {
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="prompts"]');
      await t.need('[data-saved-prompt-row="fix-failing-test"]', 'Settings › Prompts did not list the shared prompts');
      await t.click('[data-saved-prompt-row="fix-failing-test"] [data-saved-prompt-menu]');
      await t.need('[role="menu"] [data-prompt-move]', 'the prompt menu has no Use in');
      await t.shot('settings-prompts', { keepFocus: true });
      await t.escape();
      await t.click('[data-close-settings]');
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
  ...(['overview', 'sessions', 'worktrees', 'branches', 'memory', 'actions', 'settings'] as const).map(
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
          memory: '[data-project-memory-tab] [data-memory-row]',
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
    name: 'memory-load-order',
    async take(t) {
      await openMemoryTab(t);
      if ((await t.q('[data-memory-load-order]').getAttribute('data-open')) === 'false') await t.click('[data-memory-load-toggle]');
      await t.need('[data-memory-load-order] [data-memory-load-item]', 'What loads listed nothing');
      await t.shot('memory-load-order', { clip: '[data-memory-load-order]' });
      await t.home();
    },
  },
  {
    name: 'memory-health',
    async take(t) {
      await openMemoryTab(t);
      await t.need('[data-memory-health-line]', 'the Memory tab found nothing to look at', 30_000);
      if (!(await t.page.locator('[data-memory-health-finding]').count())) await t.click('[data-memory-health-show]');
      await t.need('[data-memory-health-finding]', 'the health findings did not open');
      await t.shot('memory-health', { clip: '[data-memory-health]' });
      await t.home();
    },
  },
  {
    name: 'memory-editor',
    async take(t) {
      await openMemoryTab(t);
      await t.click('[data-memory-row$="/checkout-flow.md"]');
      await t.need('[data-memory-editor$="/checkout-flow.md"]', 'the memory did not open');
      await t.shot('memory-editor');
      await t.home();
    },
  },
  {
    name: 'share-memory',
    async take(t) {
      await openMemoryTab(t);
      await t.q('[data-memory-row$="/testing-conventions.md"]').click({ button: 'right' });
      await t.click('[data-memory-menu-share]', 'the memory menu has no Share with the team…');
      await t.need('[data-share-dialog]', 'Share with the team did not open');
      await t.shot('share-memory', { keepFocus: true });
      // Never confirm: sharing writes to CLAUDE.md.
      await t.escape();
      await t.gone('[data-share-dialog]', 'the share dialog did not close');
      await t.home();
    },
  },
  {
    name: 'remember-this',
    async take(t) {
      await t.openSession(HERO);
      await t.command('remember-this', 'Remember this');
      await t.need('[data-remember-dialog]', 'Remember this did not open');
      await t.shot('remember-this', { keepFocus: true });
      // Never save: that writes a memory file.
      await t.escape();
      await t.gone('[data-remember-dialog]', 'Remember this did not close');
    },
  },
  {
    name: 'memory-paste',
    async take(t) {
      await t.home();
      await t.command('memory-paste', 'Paste memory from Claude app');
      await (await t.need('[data-memory-paste-text]', 'Paste from Claude app did not open')).fill(
        ['## Work', '', "I'm a front-end developer at Acme. We ship a React web shop.", '', '## Preferences', '', 'Prefers short answers with code first.', '', '## Coffee', '', 'Flat white, no sugar.'].join('\n'),
      );
      // Preview shows where each memory would go; only Import writes, and the tour never presses it.
      await t.press('Meta+Enter');
      await t.need('[data-memory-import-row]', 'the paste showed no preview');
      await t.shot('memory-paste', { keepFocus: true });
      // Never import: that writes memory files.
      await t.escape(2);
      await t.home();
    },
  },
  {
    name: 'search-memory',
    async take(t) {
      await t.home();
      await t.press('Meta+Shift+F');
      await (await t.need('[data-search] input', '⌘⇧F did not open search')).fill('checkout');
      await t.need('[data-search] [data-memory-row], [data-search] [data-search-memory], [data-search-hit]', 'search found nothing', 30_000);
      await t.shot('search-memory', { keepFocus: true });
      await t.escape();
      await t.gone('[data-search]', 'search did not close');
    },
  },
  {
    name: 'usage-limits',
    async take(t) {
      await openUsageView(t, 'limits', 'week');
      await t.need('[data-usage-limit="session"]', 'the Limits tab showed no limits');
      await t.need('[data-usage-history] [data-usage-line]', 'the % used chart drew no lines');
      await t.need('[data-usage-window] [data-usage-row]', 'What used this window listed no sessions', 30_000);
      await t.shot('usage-limits');
      await t.escape();
      await t.gone('[data-usage-view]', 'Esc did not leave the Usage view');
    },
  },
  {
    name: 'usage-limit-notice',
    async take(t) {
      // A finished session on the Work profile, so the made-up limit shows nowhere else in the pictures.
      const title = 'Add CSV export to the reports endpoint';
      // It is old enough to be under Archived: open it from there, then fold Archived again.
      await t.home();
      if (!(await t.page.locator('[data-archived-header]').count())) await t.click('[data-archived-toggle]');
      await t.openSession(title);
      await t.click('[data-archived-toggle]');
      await t.need('[data-archived-dock]', 'Archived did not close');
      const resetsAt = Math.round((Date.now() + (4 * 60 + 42) * 60_000) / 60_000) * 60_000;
      const held = ['Then add a test for an empty report.', 'Update the API docs for text/csv.'];
      writeFileSync(demoLimitFile(t.world), JSON.stringify({ sessionId: t.world.history[title]!.id, kind: 'five_hour', resetsAt, held }));
      await t.need('[data-current-session] [data-limit-notice="stopped"]', 'the usage limit notice did not show', 10_000);
      await t.need('[data-current-session] [data-queue-hold="limit"]', 'Up next did not say the usage limit holds it');
      await t.shot('usage-limit-notice');
      writeFileSync(demoLimitFile(t.world), 'null');
      await t.gone('[data-current-session] [data-limit-notice]', 'the usage limit notice did not go away');
    },
  },
  {
    name: 'usage-tokens',
    async take(t) {
      await openUsageView(t, 'tokens', 'week');
      await t.need('[data-usage-breakdown] [data-usage-row]', 'the breakdown listed no sessions', 30_000);
      await t.shot('usage-tokens');
      await t.click('[data-usage-group="model"]');
      await t.click('[data-usage-breakdown="model"] [data-usage-row]');
      await t.need('[data-usage-model-panel]', 'the model panel did not open');
      await t.shot('usage-model', { clip: '[data-usage-breakdown]', pad: 8 });
      await t.need('[data-usage-auto-routing]', 'the Model breakdown has no Auto routing row');
      await t.click('[data-usage-group="session"]');
      await t.escape();
      await t.gone('[data-usage-view]', 'Esc did not leave the Usage view');
    },
  },
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
  {
    // Sounds turned on for the picture, so the moments and their sounds read at full strength; put back after.
    name: 'settings-notifications',
    async take(t) {
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="notifications"]');
      await t.need('[data-sound-event="finished"]', 'Settings › Notifications has no sound per moment');
      await t.click('[data-sounds-toggle]');
      await t.until(`!document.querySelector('[data-sound-picker="finished"]')?.disabled`, 'turning sounds on did not enable the rows');
      await t.settle();
      await t.shot('settings-notifications');
      await t.click('[data-sounds-toggle]');
      await t.click('[data-close-settings]');
    },
  },
  {
    // Remote on with your own address (no tunnel tool needed) and two made-up devices written into the throwaway
    // profile's cache: the status card, Paired devices, the folded Connection and Other computers. Turned off after.
    name: 'settings-remote',
    async take(t) {
      const userData = await t.app.evaluate(({ app }) => app.getPath('userData'));
      const db = new DatabaseSync(join(userData, 'cache.sqlite'));
      try {
        const insert = db.prepare('INSERT OR REPLACE INTO remote_devices (id, name, kind, public_key, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)');
        insert.run('demo-phone', "Sam's iPhone", 'phone', 'demo-phone-key', Date.now() - 12 * DAY, Date.now() - 6 * 60 * 60 * 1000);
        insert.run('demo-laptop', 'Studio laptop', 'browser', 'demo-laptop-key', Date.now() - 3 * DAY, Date.now() - 2 * DAY);
      } finally {
        db.close();
      }
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="remote"]');
      await t.need('[data-remote-off-card]', 'Settings › Remote did not say Remote is off');
      await t.click('[data-remote-tunnel-option="custom"]');
      await t.page.fill('[data-remote-custom-url] input', 'https://remote.example.com');
      await t.click('[data-remote-save-connection]');
      await t.click('[data-remote-turn-on]');
      await t.need('[data-remote-status]', 'Turn on showed no status card');
      // Switchboard itself may have Remote's port on this Mac: the card's own fix moves to a free one.
      await t.settle();
      if (await t.page.locator('[data-remote-action="use-port"]').count()) await t.click('[data-remote-action="use-port"]');
      await t.until(`document.querySelector('[data-remote-status]')?.dataset.remoteStatusTitle === 'Running'`, 'Remote did not say Running');
      await t.settle();
      await t.shot('settings-remote');
      await t.click('[data-remote-enabled]');
      await t.click('[data-close-settings]');
    },
  },
  {
    // Connected to this Mac: two made-up devices, paired days ago in the throwaway profile's cache, connect for real
    // (the engine's test phone, with the engine's key from a pairing link that is cancelled at once). The sidebar's
    // section with the details popover open. Revoked and turned off after.
    name: 'connected-devices',
    async take(t) {
      const userData = await t.app.evaluate(({ app }) => app.getPath('userData'));
      const devices = [
        { id: 'demo-connected-phone', name: "Sam's iPhone", kind: 'phone', secret: randomBytes(32), paired: Date.now() - 3 * DAY },
        { id: 'demo-connected-browser', name: 'Safari on Studio laptop', kind: 'browser', secret: randomBytes(32), paired: Date.now() - 9 * DAY },
      ];
      const db = new DatabaseSync(join(userData, 'cache.sqlite'));
      try {
        const insert = db.prepare('INSERT OR REPLACE INTO remote_devices (id, name, kind, public_key, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)');
        for (const d of devices) insert.run(d.id, d.name, d.kind, Buffer.from(x25519.getPublicKey(d.secret)).toString('base64url'), d.paired, d.paired);
      } finally {
        db.close();
      }
      await t.click('[data-open-settings]');
      await t.click('[data-settings-section="remote"]');
      // My own address, as in settings-remote: no tunnel starts, and the address is a made-up one.
      await t.need('[data-remote-off-card]', 'Settings › Remote did not say Remote is off');
      await t.click('[data-remote-tunnel-option="custom"]');
      await t.page.fill('[data-remote-custom-url] input', 'https://remote.example.com');
      await t.click('[data-remote-save-connection]');
      await t.click('[data-remote-turn-on]');
      await t.need('[data-remote-status]', 'Turn on showed no status card');
      await t.settle();
      if (await t.page.locator('[data-remote-action="use-port"]').count()) await t.click('[data-remote-action="use-port"]');
      await t.until(`document.querySelector('[data-remote-status]')?.dataset.remoteStatusTitle === 'Running'`, 'Remote did not say Running');
      // The engine's key, from a pairing link; closing the dialog makes the link useless. Copy link is caught in the
      // page, so the system's clipboard is never touched.
      await t.page.evaluate(() => {
        navigator.clipboard.writeText = async (text: string) => void ((window as unknown as { demoLink: string }).demoLink = text);
      });
      await t.click('[data-remote-action="pair"]');
      await t.click('[data-remote-copy-link]');
      await t.until('Boolean(window.demoLink)', 'Copy link gave no pairing link');
      const link = await t.page.evaluate(() => (window as unknown as { demoLink: string }).demoLink);
      await t.page.keyboard.press('Escape');
      const settings = new DatabaseSync(join(userData, 'cache.sqlite'));
      const port = (JSON.parse((settings.prepare("SELECT value FROM app_state WHERE key = 'remote.settings'").get() as { value: string }).value) as { port: number }).port;
      settings.close();
      const phones = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', join(root, 'scripts', 'demo-phones.ts')], {
        env: { ...process.env, SWITCHBOARD_DEMO_LINK: link, PORT: String(port), SWITCHBOARD_DEMO_SECRETS: devices.map((d) => d.secret.toString('base64')).join(',') },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      try {
        await new Promise<void>((resolve, reject) => {
          phones.stdout.on('data', (data: Buffer) => data.toString().includes('connected') && resolve());
          phones.on('exit', (code) => reject(new Error(`the demo devices did not connect (exit ${code})`)));
        });
        await t.click('[data-close-settings]');
        await t.need('[data-connected-devices="devices"] [data-connected-device="demo-connected-browser"]', 'the connected devices did not show in the sidebar');
        // The toasts for the new connections are not part of this picture.
        const toasts = t.page.locator('[data-device-toast] [data-toast-close]');
        for (let i = 0; i < 5 && (await toasts.count()); i++) await toasts.first().click({ force: true }).catch(() => {});
        await t.gone('[data-device-toast]', 'the connected toasts did not go');
        await t.click('[data-connected-device="demo-connected-phone"] [data-device-row]');
        await t.need('[data-device-details]', 'the details popover did not open');
        await t.settle();
        await t.shot('connected-devices');
        await t.page.keyboard.press('Escape');
      } finally {
        phones.kill();
        await t.click('[data-open-settings]').catch(() => {});
        await t.click('[data-settings-section="remote"]').catch(() => {});
        for (const d of devices) {
          if (!(await t.page.locator(`[data-remote-device="${d.id}"] [data-remote-revoke]`).count())) continue;
          await t.click(`[data-remote-device="${d.id}"] [data-remote-revoke]`);
          await t.click('[data-confirm-strip] [data-confirm]');
        }
        await t.click('[data-remote-enabled]').catch(() => {});
        await t.click('[data-close-settings]').catch(() => {});
      }
    },
  },
  {
    // Other computers: a paired computer's sessions in the sidebar with its chips and the Computers strip, one of them
    // open with the violet line, New session with Run on set to it, and Usage counting its tokens. Nothing is started there.
    name: 'computers',
    async take(t) {
      await withComputer(t, async (computerId) => {
        await t.shot('computers-sidebar', { clip: '[data-sidebar-state]' });
        await t.click(`[data-session-list] [data-remote-row="${computerId}"]`);
        await t.need('[data-remote-header]', 'the remote session did not open');
        await t.need('[data-transcript] [data-prompt-bubble]', 'the remote conversation did not load');
        await t.shot('computers-session');
        await t.click('[data-new-session]');
        await t.click(`[data-run-on-option="${computerId}"]`);
        await t.need('[data-remote-new-session] [data-remote-project]', 'Run on mystic showed no projects');
        await t.click('[data-remote-new-session] [data-remote-project]');
        await t.page.fill('[data-remote-new-session] textarea', 'Add rate limits to the webhook endpoints, as in the spec');
        // An image and a file to send with it: a screenshot of the docs' own, and a made-up spec.
        await t.page.setInputFiles('[data-remote-new-session] [data-remote-attach-input]', [
          { name: 'rate-limits.png', mimeType: 'image/png', buffer: readFileSync(join(outDir, 'code-block-dark.png')) },
          { name: 'webhook-limits.md', mimeType: 'text/markdown', buffer: Buffer.from('# Webhook limits\n\n100 requests a minute per key.\n') },
        ]);
        await t.need('[data-remote-new-session] [data-remote-file]', 'the attached file did not show');
        await t.need('[data-remote-new-session] [data-attachments] img', 'the attached image did not show');
        await t.shot('computers-new-session');
        for (let i = 0; i < 2; i++) await t.click('[data-remote-new-session] [data-remote-attachments] button[aria-label^="Remove"]');
        await t.page.fill('[data-remote-new-session] textarea', '');
        await t.click('[data-run-on-option="local"]');
        // Usage with All computers: mystic's tokens for the same account next to this computer's, then per computer.
        await openUsageView(t, 'tokens', 'week');
        await t.click('[data-usage-computers-choice="all"]');
        await t.click('[data-usage-group="session"]');
        await t.need(`[data-usage-breakdown] [data-usage-row-from="${computerId}"]`, 'the breakdown listed no session from mystic', 20_000);
        await t.need('[data-usage-headline] [data-usage-computers="2"]', 'the totals did not count two computers');
        await t.shot('usage-computers');
        await t.click('[data-usage-group="computer"]');
        await t.need(`[data-usage-breakdown="computer"] [data-usage-row="${computerId}"]`, 'the breakdown had no row for mystic');
        await t.shot('usage-by-computer', { clip: '[data-usage-breakdown]', pad: 8 });
        await t.click('[data-usage-group="session"]');
        await t.escape();
        await t.gone('[data-usage-view]', 'Esc did not leave the Usage view');
      });
    },
  },
  {
    name: 'mods',
    async take(t) {
      for (const end = Date.now() + 45_000; !existsSync(modsStarted) && Date.now() < end; ) await new Promise((resolve) => setTimeout(resolve, 200));
      if (!existsSync(modsStarted)) throw new Error('the mods session did not start');
      const started = JSON.parse(readFileSync(modsStarted, 'utf8')) as { sessionId?: string; supported?: boolean };
      if (!started.sessionId || !started.supported) throw new Error("the mods session didn't start, or this Claude Code doesn't draw mods");
      await t.click(`[data-session-id="${started.sessionId}"]`);
      // Claude Code doesn't say which mod drew a band, so with two mods in the profile its frame says "mod".
      await t.need('[data-current-session] [data-mod-bands] [data-mod-band]', 'the agent-watch band did not show');
      await t.need('[data-current-session] [data-mod-pane="agents"]', 'the Agents pane did not open');
      await t.settle();
      await t.shot('mods');
      await t.click('[data-current-session] [data-mods-chip]');
      await t.need('[data-mods-popover]', 'the mods popover did not open');
      await t.shot('mods-popover', { clip: '[data-mods-popover]', pad: 12, keepFocus: true });
      await t.page.keyboard.press('Escape');
    },
  },
  ...(['general', 'theme', 'sidebar', 'projects', 'conversation', 'mods', 'focus', 'profiles', 'usage', 'memory', 'vscode', 'backup', 'diagnostics', 'about'] as const).map(
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

/** Makes a saved prompt in Settings › Prompts, the text pasted in (its blanks become chips). */
async function makePrompt(t: Tour, name: string, text: string, useIn: 'global' | 'personal'): Promise<void> {
  await t.click('[data-open-settings]');
  await t.click('[data-settings-section="prompts"]');
  await t.click('[data-saved-prompts-new]', 'Settings › Prompts has no New prompt');
  await (await t.need('[data-prompt-editor-name]', 'New prompt did not open')).fill(name);
  await t.click(`[data-prompt-use-in="${useIn}"]`);
  await t.click('[data-prompt-editor]');
  await t.page.keyboard.insertText(text);
  await t.need('[data-prompt-editor] [data-editor-blank]', 'the pasted prompt has no blanks');
  await t.click('[data-prompt-editor-save]');
  await t.gone('[data-prompt-editor-dialog]', `“${name}” was not saved`);
  // The toast that says it was saved would be in the pictures.
  await t.page.locator('[data-toast] button[aria-label="Dismiss"]').first().click().catch(() => {});
  await t.click('[data-close-settings]');
}

async function openMemoryTab(t: Tour): Promise<void> {
  await openProjectPage(t, 'acme-store');
  await t.click('[data-project-tab="memory"]');
  await t.need('[data-project-memory-tab] [data-memory-row]', 'the Memory tab listed nothing', 30_000);
}

async function openProjectPage(t: Tour, project: string): Promise<void> {
  await t.command(`project:${t.world.home}/Developer/${project}`, `Project: ${project}`);
  await t.need('[data-project-page]', `the ${project} page did not open`);
}

async function openUsageView(t: Tour, tab: 'limits' | 'tokens', period: string): Promise<void> {
  await t.home();
  // The way people get there: the usage bar on Home's profile card.
  await t.click('[data-home-profile] [data-usage-band]');
  await t.need('[data-usage-view]', 'the Usage view did not open');
  await t.click(`[data-usage-tab="${tab}"]`);
  await t.click(`[data-usage-period="${period}"]`);
}

/**
 * Plan numbers for the demo logins, which have none (no credentials): the engine reports these instead of asking
 * Claude Code (SWITCHBOARD_DEMO_USAGE), with a week of % history so the chart has something to draw.
 */
function demoUsage(world: DemoWorld): string {
  const home = world.home;
  const now = Date.now();
  const HOUR = 3_600_000;
  const at = (ms: number) => Math.round(ms / 60_000) * 60_000;
  const sessionReset = at(now + 2 * HOUR + 14 * 60_000);
  const weeklyReset = at(now + 2 * DAY + 15 * HOUR);
  const lastWeeklyReset = weeklyReset - 7 * DAY;
  const limit = (kind: string, percent: number, resetsAt: number, scope: string | null = null) => ({ kind, group: kind.startsWith('weekly') ? 'weekly' : kind, percent, resetsAt, scope, severity: 'normal', isActive: true });
  // Work happens in the day: the % climbs between 08:00 and 19:00 and stays flat at night.
  const busy = (t: number) => {
    const h = new Date(t).getHours();
    return h >= 8 && h < 19;
  };
  const history: Array<{ at: number; kind: string; scope: string | null; percent: number; resetsAt: number | null }> = [];
  const week = (kind: string, scope: string | null, before: number, after: number, end: number) => {
    // From 7 days ago to the last reset, then from 0 to where it is now.
    let percent = before;
    const steps = (from: number, to: number) => {
      let n = 0;
      for (let t = from; t < to; t += HOUR) if (busy(t)) n++;
      return Math.max(1, n);
    };
    const climb1 = (end - before) / steps(now - 7 * DAY, lastWeeklyReset);
    for (let t = now - 7 * DAY; t < lastWeeklyReset; t += HOUR) {
      if (busy(t)) percent += climb1;
      history.push({ at: at(t), kind, scope, percent: Math.round(percent * 10) / 10, resetsAt: lastWeeklyReset });
    }
    percent = 0;
    const climb2 = after / steps(lastWeeklyReset, now);
    for (let t = lastWeeklyReset; t <= now; t += HOUR) {
      history.push({ at: at(t), kind, scope, percent: Math.round(percent * 10) / 10, resetsAt: weeklyReset });
      if (busy(t)) percent = Math.min(after, percent + climb2);
    }
  };
  week('weekly_all', null, 58, 52, 71);
  week('weekly_scoped', 'Opus', 80, 82, 97);
  // The 5-hour session over the last day: it fills while you work and comes back every five hours.
  for (let reset = sessionReset - 5 * 5 * HOUR; reset <= sessionReset; reset += 5 * HOUR) {
    const start = reset - 5 * HOUR;
    const peak = reset === sessionReset ? 38 : busy(start) ? 45 + ((reset / HOUR) % 4) * 10 : 6;
    for (let t = Math.max(start, now - 26 * HOUR); t <= Math.min(reset, now); t += 30 * 60_000) {
      history.push({ at: at(t), kind: 'session', scope: null, percent: Math.round(((t - start) / (Math.min(reset, now) - start || 1)) * peak), resetsAt: reset });
    }
  }
  const file = join(home, '.switchboard-demo-usage.json');
  writeFileSync(
    file,
    JSON.stringify({
      profiles: [
        {
          configDir: join(home, '.claude'),
          snapshot: { fetchedAt: now - 60_000, limits: [limit('session', 38, sessionReset), limit('weekly_all', 52, weeklyReset), limit('weekly_scoped', 82, weeklyReset, 'Opus')], extraUsage: null },
          history,
        },
        {
          configDir: join(home, '.claude-work'),
          snapshot: { fetchedAt: now - 60_000, limits: [limit('session', 12, sessionReset), limit('weekly_all', 31, weeklyReset)], extraUsage: null },
        },
      ],
      autoPicks: demoAutoPicks(world, now),
      catchUps: demoCatchUps(world, now),
      limitFile: demoLimitFile(world),
    }),
  );
  return file;
}

/** Where the tour writes the made-up usage limit for its picture; the demo engine watches it (see `DemoUsage.limitFile`). */
const demoLimitFile = (world: DemoWorld) => join(world.home, '.switchboard-demo-limit.json');

/**
 * What Auto model picked for some of the demo sessions, and a few more routing calls, so a session shows its pick
 * and Usage has an Auto routing row and "by Auto" counts. The engine stores them (SWITCHBOARD_DEMO_USAGE).
 */
function demoAutoPicks(world: DemoWorld, now: number) {
  const personal = join(world.home, '.claude');
  const tokens = (input: number) => ({ input, output: 38, cacheRead: 0, cacheWrite: 0 });
  const allowed = ['haiku', 'sonnet', 'opus'];
  const pick = (model: string, reason: string, ago: number, input = 1_060) => ({ model, reason, at: now - ago, tokens: input + 38, allowed });
  const of = (title: string) => world.history[title]!;
  const picks = [
    { configDir: personal, sessionId: world.sessions.hero, pick: pick('opus', 'A feature across the theme, the settings page and saved preferences.', 27 * 60_000) },
    { ...of('Refactor auth middleware'), pick: pick('opus', 'Splitting tangled middleware across several routes.', 2 * 3_600_000 + 60_000) },
    { ...of('Write a getting started guide'), pick: pick('sonnet', 'Writing one docs page from known steps.', 5 * 3_600_000 + 60_000) },
    { ...of('Add pull to refresh on the orders list'), pick: pick('sonnet', 'A small, local change to one list.', 3 * DAY + 60_000) },
  ].map(({ configDir, id, sessionId, pick: p }: { configDir: string; id?: string; sessionId?: string; pick: ReturnType<typeof pick> }) => ({
    configDir,
    sessionId: sessionId ?? id ?? null,
    pick: p,
    routingModel: 'claude-haiku-5-5',
    tokens: tokens(p.tokens - 38),
  }));
  // Quick questions and sessions from before the demo's history: picks without a session to show.
  for (let i = 0; i < 9; i++) {
    const model = i % 3 === 0 ? 'haiku' : 'sonnet';
    const p = pick(model, 'A quick question with a short answer.', (i + 1) * 13 * 3_600_000, 900 + i * 40);
    picks.push({ configDir: personal, sessionId: null, pick: p, routingModel: 'claude-haiku-5-5', tokens: tokens(p.tokens - 38) });
  }
  return picks;
}

/**
 * Catch-up cards for some of the finished demo sessions, as if their turns had just ended (the engine stores them,
 * SWITCHBOARD_DEMO_USAGE): one ready to commit, one with a file outside what was asked, one with failing tests.
 */
function demoCatchUps(world: DemoWorld, now: number) {
  const of = (title: string) => world.history[title]!.id;
  const card = (title: string, ask: string, ago: number, patch: Record<string, unknown>) => ({
    sessionId: of(title),
    turnId: `demo-${of(title)}`,
    generatedAt: now - ago,
    source: 'model',
    state: 'finished',
    ask,
    skipped: [],
    ...patch,
  });
  return [
    card(CATCH_UP, 'Split the auth middleware into session and API-key checks, they are tangled together right now.', 4 * 60_000, {
      did: ['Split the auth middleware into a session check and an API-key check', 'Each route now picks the check it needs', 'Removed the old combined middleware', 'Added 6 tests for the two checks'],
      skipped: ['Left the admin routes on the old check for now'],
      need: { kind: 'commit', title: 'Commit the changes', text: 'Tests pass and every change stays in src/middleware. Ready to commit.' },
      signals: { tests: { state: 'passed', passed: 14, failed: 0, command: 'npm test' }, diff: { files: 6, add: 120, del: 40 }, outOfScope: [], scope: 'src/middleware', plan: 'followed' },
      reviewMinutes: 3,
    }),
    card('Write a getting started guide', 'Write a getting started guide for the docs site: install, first request, and where to go next.', 30 * 60_000, {
      did: ['Wrote the getting started guide', 'Linked it from the sidebar under Start here'],
      need: { kind: 'review', title: 'Review the changes', text: '1 file outside src/content/docs. Look at it before you commit.' },
      signals: { tests: { state: 'notRun' }, diff: { files: 2, add: 64, del: 3 }, outOfScope: ['astro.config.mjs'], scope: 'src/content/docs', plan: null },
      reviewMinutes: 2,
    }),
    card('Add CSV export to the reports endpoint', 'Let /reports return CSV when the client asks for text/csv.', 2 * 3_600_000, {
      did: ['Let GET /reports answer with CSV for Accept: text/csv', 'Streamed the rows instead of building the whole file'],
      skipped: ['2 of 9 tests fail'],
      need: { kind: 'reply', title: 'Decide about the failing tests', text: '2 of 9 tests fail. Tell Claude how to go on.' },
      signals: { tests: { state: 'failed', passed: 7, failed: 2, command: 'npm test' }, diff: { files: 3, add: 80, del: 10 }, outOfScope: [], scope: null, plan: null },
      reviewMinutes: 4,
    }),
  ];
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

  // Saved prompts of your own, for every project and for acme-store (the open session's project) just for you.
  await makePrompt(t, 'Implement issue', 'Start implementing {{issue:issue}} on {{branch:branch}}. Deploy to {{env:choice=staging|production}} when the tests pass.', 'global');
  await makePrompt(t, 'Write release notes', 'Write the release notes for {{version}} from the changes since {{base:branch}}.', 'personal');

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
    // Toasts, and the usage lines that could only say "unavailable" (the demo logins have no credentials).
    style.textContent = '[data-toasts], [data-toast], [data-update-toast], [data-claude-update-toast], [data-usage-status] { display: none !important; }';
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

// Claude Code mods: two made-up mods (scripts/demo-mods) in a throwaway profile of their own. The app starts a session
// with them as it opens, with agent-watch's `/agent-watch`, which the mod answers without the model.
// They live in the demo home, so Settings › Mods shows them as ~/.claude/plugins/<name>.
const modsDir = mkdtempSync(join(tmpdir(), 'switchboard-shots-mods-'));
const demoMods = ['agent-watch', 'pr-status'].map((name) => {
  const folder = join(world.home, '.claude', 'plugins', name);
  cpSync(join(root, 'scripts', 'demo-mods', name), folder, { recursive: true });
  return folder;
});
mkdirSync(join(world.home, '.claude-mods'));
mkdirSync(join(modsDir, 'switchboard'));
const modsStarted = join(modsDir, 'started.json');
const modsSpec = { pluginDir: demoMods.join(':'), configDir: join(world.home, '.claude-mods'), cwd: join(modsDir, 'switchboard'), out: modsStarted, prompt: '/agent-watch', profileName: 'Mods' };

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
    SWITCHBOARD_SMOKE_MODS: JSON.stringify(modsSpec),
    SWITCHBOARD_GH: fakeGh(world.home),
    SWITCHBOARD_DEMO_USAGE: demoUsage(world),
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
  writePersonalMemory(join(await app.evaluate(({ app }) => app.getPath('userData')), 'memory'));
  const tour = new Tour(app, page, world);
  await setUp(tour);
  for (const scheme of ['dark', 'light'] as const) {
    await tour.setScheme(scheme);
    for (const screen of screens) {
      if (only && !only.has(screen.name)) continue;
      await screen.take(tour);
    }
  }
  if (!only || only.has('remote-phone')) await phoneShots();
} catch (error) {
  failed = true;
  console.error(`✗ ${(error as Error).message}`);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  const grew = [...transcripts(world.home)].filter(([path, size]) => size !== transcriptsBefore.get(path));
  if (grew.length) {
    failed = true;
    console.error(`✗ the tour sent something to Claude or saved a memory: ${grew.length} file(s) changed. Check the clicks and key presses in this script.`);
  }
  world.stop();
  rmSync(world.home, { recursive: true, force: true });
  rmSync(modsDir, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log(`✓ screenshots written to ${outDir}`);
