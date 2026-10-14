/** Git as the app shows it: the changed-file count, branches, staging and reverting, and older git fixes. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Chaos } from '../lib/harness.ts';
import { sleep } from '../lib/harness.ts';
import { command, gitStatus, openSessionByTitle } from '../lib/ui.ts';
import type { Case } from './types.ts';

const HERO = 'Add dark mode toggle';

function git(c: Chaos, cwd: string, ...args: string[]): string {
  c.assertInSandbox(cwd);
  return execFileSync('/usr/bin/git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', ...args], { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: c.world.home, GIT_CONFIG_GLOBAL: '/dev/null' } });
}

const badge = (c: Chaos) => c.page.evaluate(() => Number((document.querySelector('[data-current-session] [data-toggle-changes]')?.textContent ?? '').replace(/\D/g, '') || '0'));

export const gitCases: Record<string, Case> = {
  changesStale: {
    finding: 'CG1',
    mutates: true,
    expect: 'Files changed while the window keeps focus (a terminal, an action) show in the header count and the Changes panel within a few seconds.',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      await sleep(2_000);
      note('start', { badge: await badge(c), git: gitStatus(c, c.world.acme).length });
      writeFileSync(join(c.world.acme, 'chaos-new-file.txt'), 'new\n');
      writeFileSync(join(c.world.acme, 'src', 'App.tsx'), 'changed outside\n');
      await sleep(5_000);
      const shown = await badge(c);
      if (!(await c.page.locator('[data-changes-panel]').count())) await c.page.keyboard.press('Meta+Shift+D');
      await sleep(1_500);
      const panel = await c.page.evaluate(() => document.querySelectorAll('[data-changed-file]').length);
      const real = gitStatus(c, c.world.acme).length;
      return { ok: shown === real && panel === real, saw: { header: shown, panel, git: real } };
    },
  },

  branchInWorktree: {
    finding: 'CG2',
    expect: 'The branch menu does not offer branches that are checked out in another worktree (git refuses to switch to them).',
    async run(c) {
      await openSessionByTitle(c, HERO);
      const inWorktrees = git(c, c.world.acme, 'worktree', 'list', '--porcelain')
        .split('\n')
        .filter((l) => l.startsWith('branch refs/heads/'))
        .map((l) => l.slice('branch refs/heads/'.length));
      await c.page.locator('[data-current-session] [data-branch-menu]').first().click();
      await sleep(800);
      const offered = await c.page.evaluate(() => [...document.querySelectorAll('[data-branch-option]')].map((e) => e.getAttribute('data-branch-option')!));
      await c.page.keyboard.press('Escape');
      const current = git(c, c.world.acme, 'branch', '--show-current').trim();
      const wrong = offered.filter((b) => b !== current && inWorktrees.includes(b));
      return { ok: wrong.length === 0, saw: { offeredButCheckedOutElsewhere: wrong } };
    },
  },

  missingFolderError: {
    finding: 'CG3',
    expect: 'Git calls in a folder that no longer exists say the folder is gone, not "spawn git ENOENT".',
    async run(c) {
      const gone = join(c.world.home, 'Developer', 'no-such-project');
      const r = await c.rpc('git.changes', { cwd: gone, base: 'uncommitted' });
      const text = JSON.stringify(r.error ?? r.result);
      return { ok: !/spawn git ENOENT/.test(text), saw: r.error ?? 'ok' };
    },
  },

  stageDoubleClick: {
    finding: 'CU8',
    expect: "A double-click on a file's stage checkbox runs one git command at a time: no index.lock error.",
    async run(c) {
      await openSessionByTitle(c, HERO);
      if (!(await c.page.locator('[data-changes-panel]').count())) await c.page.keyboard.press('Meta+Shift+D');
      const box = c.page.locator('[data-stage-file]').first();
      await box.waitFor();
      const signalsBefore = c.signals.length;
      await box.dblclick();
      await sleep(2_500);
      await c.pollPage();
      const errors = c.signals.slice(signalsBefore).filter((s) => /git\.stage|Couldn't (un)?stage/.test(s.detail)).map((s) => s.detail.slice(0, 160));
      return { ok: errors.length === 0, saw: errors };
    },
  },

  revertGlobName: {
    finding: 'E2',
    mutates: true,
    expect: 'Reverting an untracked `a*.txt` removes only that file; a changed `a1.txt` next to it stays changed.',
    async run(c) {
      const acme = c.world.acme;
      writeFileSync(join(acme, 'a1.txt'), 'one\n');
      git(c, acme, 'add', 'a1.txt');
      git(c, acme, 'commit', '-qm', 'a1');
      writeFileSync(join(acme, 'a1.txt'), 'one changed\n');
      writeFileSync(join(acme, 'a*.txt'), 'glob\n');
      const r = await c.rpc('git.revert', { cwd: acme, paths: ['a*.txt'] });
      const kept = readFileSync(join(acme, 'a1.txt'), 'utf8') === 'one changed\n';
      return { ok: r.ok && !existsSync(join(acme, 'a*.txt')) && kept, saw: { revert: r.ok ? 'ok' : r.error, siblingKept: kept } };
    },
  },

  revertStagedDeletion: {
    finding: 'E3',
    mutates: true,
    expect: 'Reverting a staged deletion brings the file back.',
    async run(c) {
      git(c, c.world.acme, 'rm', '-q', 'README.md');
      const r = await c.rpc('git.revert', { cwd: c.world.acme, paths: ['README.md'] });
      const back = existsSync(join(c.world.acme, 'README.md'));
      return { ok: r.ok && back, saw: { revert: r.ok ? 'ok' : r.error, back } };
    },
  },

  unstageWithoutHead: {
    finding: 'E8',
    mutates: true,
    expect: 'Unstaging works in a repository without commits.',
    async run(c) {
      const empty = join(c.world.home, 'Developer', 'empty-repo');
      mkdirSync(empty, { recursive: true });
      git(c, empty, 'init', '-q', '-b', 'main');
      writeFileSync(join(empty, 'x.txt'), 'x\n');
      git(c, empty, 'add', 'x.txt');
      const r = await c.rpc('git.stage', { cwd: empty, paths: ['x.txt'], staged: false });
      const status = git(c, empty, 'status', '--porcelain').trim();
      return { ok: r.ok && status === '?? x.txt', saw: { stage: r.ok ? 'ok' : r.error, status } };
    },
  },

  concurrentSends: {
    finding: 'H2',
    expect: 'Two sends at once to a stopped session start one Claude Code process.',
    async run(c) {
      const log = join(c.world.home, '.chaos', 'claude-calls.log');
      const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
      const before = lines().length;
      const id = c.world.sessions.hero;
      const send = (text: string) => c.rpc('session.send', { sessionId: id, text, attachments: [], fork: false, mode: 'queue' });
      await Promise.all([send('one'), send('two')]);
      await sleep(2_000);
      const processes = lines().slice(before).filter((l) => l.includes(id)).length;
      return { ok: processes === 1, saw: { processes } };
    },
  },

  cleanupKeepsWork: {
    finding: 'check',
    mutates: true,
    expect: 'Clean up worktrees offers only the worktree with nothing of its own and leaves the one with uncommitted work.',
    async run(c) {
      const worktrees = join(c.world.acme, '.claude', 'worktrees');
      await openSessionByTitle(c, HERO);
      if (!(await command(c, 'clean-up-worktrees', 'Clean up worktrees'))) return { ok: false, saw: 'no Clean up worktrees in the palette' };
      await sleep(2_500);
      const dialog = await c.page.evaluate(() => (document.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').slice(0, 300) ?? null);
      await c.page.locator('[data-worktree-cleanup-confirm]').first().click({ timeout: 3_000 }).catch(() => {});
      await sleep(3_000);
      const cleaned = !existsSync(join(worktrees, 'brave-humming-otter'));
      const kept = existsSync(join(worktrees, 'tidy-silver-heron', 'src', 'checkout.ts'));
      return { ok: cleaned && kept, saw: { dialog, cleaned, kept } };
    },
  },

  quitMidRevert: {
    finding: 'check',
    mutates: true,
    expect: 'Quitting right after confirming Revert all leaves the repository whole: every change reverted or none.',
    async run(c) {
      const before = gitStatus(c, c.world.acme).length;
      await openSessionByTitle(c, HERO);
      // ⌘⇧D toggles: open the panel only if an earlier case left it closed.
      if (!(await c.page.locator('[data-changes-panel]').count())) await c.page.keyboard.press('Meta+Shift+D');
      await c.page.locator('[data-changes-panel] button:has-text("Revert all")').first().click();
      await c.page.locator('[role="alertdialog"] [data-confirm]').first().click();
      c.log('restart', 'right after Revert all');
      await c.restart();
      const after = gitStatus(c, c.world.acme).length;
      const trashed = readdirSync(join(c.world.root, 'trash')).length;
      return { ok: after === before || after === 0, saw: { before, after, trashed } };
    },
  },
};
