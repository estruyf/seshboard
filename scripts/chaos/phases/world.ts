/**
 * d. The world changes underneath: odd git states (detached HEAD, a merge conflict, a rebase, index.lock, glob-looking
 * names, thousands of untracked files, a huge binary, a submodule, no commits, no .git), project folders moved or
 * replaced by a file, transcripts cut, invalid, huge, deleted or for a missing folder, profile folders removed.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expensiveChecks, gitCheck } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { monkeyStep } from '../lib/monkey.ts';
import { closeAll, currentSession, openSessionByTitle, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const world: Phase = async (c) => {
  await setUp(c);
  const home = c.world.home;
  const dev = join(home, 'Developer');
  const acme = c.world.acme;
  const sh = (cwd: string, cmd: string) => {
    c.assertInSandbox(cwd);
    c.log('world', cmd.slice(0, 120), cwd.replace(c.world.root, '<sandbox>'));
    try {
      execFileSync('/bin/sh', ['-c', cmd], { cwd, env: { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'D', GIT_AUTHOR_EMAIL: 'd@e', GIT_COMMITTER_NAME: 'D', GIT_COMMITTER_EMAIL: 'd@e' }, stdio: 'pipe', timeout: 60_000 });
    } catch (e) {
      c.log('world-cmd-failed', String((e as Error).message).slice(0, 200));
    }
  };
  const look = async (title: string, extra?: () => Promise<void>) => {
    await closeAll(c);
    await openSessionByTitle(c, title);
    await sleep(2_500);
    await gitCheck(c);
    // Peek at the changes panel and the branch menu, where git state shows.
    await c.page.keyboard.press('Meta+Shift+D');
    await sleep(1_500);
    await c.page.keyboard.press('Meta+Shift+D');
    await c.page.locator('[data-current-session] [data-git-menu]').first().click({ timeout: 2_000 }).catch(() => {});
    await sleep(800);
    await closeAll(c);
    if (extra) await extra();
    for (let i = 0; i < 30; i++) await monkeyStep(c).catch(() => {});
    await closeAll(c);
  };
  const projectPage = async (tab: string) => {
    await closeAll(c);
    await c.page.locator('[data-open-projects]').first().click({ timeout: 2_000 }).catch(() => {});
    await c.page.locator('[data-project-row]').first().click({ timeout: 2_000 }).catch(() => {});
    await c.page.locator(`[data-project-tab="${tab}"]`).first().click({ timeout: 2_000 }).catch(() => {});
    await sleep(2_000);
  };

  // Odd git states in acme-store (the hero session's folder).
  sh(acme, 'git switch -q --detach HEAD');
  await look('Add dark mode toggle', () => projectPage('branches'));
  sh(acme, 'git switch -q feat/dark-mode');
  // A merge conflict.
  sh(acme, 'git stash -q -u && git switch -q -c conflict-a main && echo a > README.md && git commit -qam a && git switch -q -c conflict-b main && echo b > README.md && git commit -qam b && git merge conflict-a; true');
  await look('Add dark mode toggle', () => projectPage('worktrees'));
  sh(acme, 'git merge --abort; git switch -q feat/dark-mode; git stash pop -q; true');
  // A rebase in progress.
  sh(acme, 'git stash -q -u; git switch -q conflict-b && git rebase conflict-a; true');
  await look('Add dark mode toggle');
  sh(acme, 'git rebase --abort; git switch -q feat/dark-mode; git stash pop -q; true');
  // A locked index.
  sh(acme, 'touch .git/index.lock');
  await look('Add dark mode toggle', async () => {
    // Stage and revert with the index locked.
    await c.page.keyboard.press('Meta+Shift+D');
    await sleep(800);
    await c.page.locator('[data-stage-file]').first().click({ timeout: 2_000 }).catch(() => {});
    await sleep(1_500);
    await c.page.keyboard.press('Meta+Shift+D');
  });
  sh(acme, 'rm -f .git/index.lock');
  // Glob-looking names and thousands of untracked files.
  sh(acme, 'mkdir -p "app/[id]" && echo x > "a*.txt" && echo y > "app/[id]/page.tsx" && echo z > "a1.txt"');
  sh(acme, 'mkdir -p many && i=0; while [ $i -lt 3000 ]; do echo $i > many/f$i.txt; i=$((i+1)); done');
  await look('Add dark mode toggle');
  // A huge binary diff.
  sh(acme, 'head -c 30000000 /dev/urandom > big.bin');
  await look('Add dark mode toggle', async () => {
    await c.page.keyboard.press('Meta+Shift+D');
    await sleep(3_000);
    await c.page.locator('[data-changed-file*="big.bin"], [data-file-toggle]').first().click({ timeout: 2_000 }).catch(() => {});
    await sleep(3_000);
    await c.page.keyboard.press('Meta+Shift+D');
  });
  sh(acme, 'rm -rf many big.bin');
  // A submodule.
  sh(dev, `git init -q -b main sub-lib && cd sub-lib && echo s > s.txt && git add . && git commit -qm s`);
  sh(acme, `git -c protocol.file.allow=always submodule add -q ${join(dev, 'sub-lib')} vendor/sub-lib; true`);
  await look('Add dark mode toggle', () => projectPage('overview'));
  // A repo with no commits.
  const docs = join(dev, 'docs-site');
  sh(docs, 'rm -rf .git && git init -q -b main');
  await look('Write a getting started guide');
  // Remove .git altogether.
  sh(docs, 'rm -rf .git');
  await look('Write a getting started guide', () => projectPage('branches'));
  // Replace a project folder with a file.
  sh(dev, 'mv mobile-app mobile-app.moved && echo "not a folder" > mobile-app');
  await look('Investigate flaky checkout');
  await projectPage('overview');
  for (let i = 0; i < 60; i++) await monkeyStep(c).catch(() => {});
  sh(dev, 'rm -f mobile-app && mv mobile-app.moved mobile-app');
  // Delete a project folder while it is shown (payments-api, the Work profile's).
  await projectPage('sessions');
  sh(dev, 'mv payments-api payments-api.gone');
  await sleep(3_000);
  for (let i = 0; i < 60; i++) await monkeyStep(c).catch(() => {});
  sh(dev, 'mv payments-api.gone payments-api');

  // Transcripts: cut mid-line, invalid JSON, an unknown message type, a huge one, one whose folder is gone.
  const projects = join(home, '.claude', 'projects');
  const files = readdirSync(projects, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.jsonl') && !f.includes('subagents')).map((f) => join(projects, f));
  c.log('world', `transcripts: ${files.length}`);
  const [t1, t2, t3] = files;
  if (t1) {
    c.assertInSandbox(t1);
    const size = statSync(t1).size;
    truncateSync(t1, Math.floor(size * 0.6));
    c.log('world', 'cut a transcript mid-line', t1.replace(c.world.root, '<sandbox>'));
  }
  if (t2) {
    c.assertInSandbox(t2);
    appendFileSync(t2, '{"type":"user","message":{"role":"user","content":"unterminated\n{not json at all}\n\u0000\u0001garbage\n{"type":"hyperdrive","uuid":"x","weird":[1,2,3]}\n');
    c.log('world', 'invalid JSON and an unknown type appended');
  }
  if (t3) {
    c.assertInSandbox(t3);
    const line = readFileSync(t3, 'utf8').split('\n').filter(Boolean).find((l) => l.includes('"assistant"')) ?? readFileSync(t3, 'utf8').split('\n')[0]!;
    const big = `${line}\n`.repeat(Math.ceil((50 * 1024 * 1024) / (line.length + 1)));
    appendFileSync(t3, big);
    c.log('world', 'a 50 MB transcript');
  }
  // A transcript for a folder that doesn't exist.
  const ghostDir = join(projects, '-private-tmp-nowhere-at-all');
  mkdirSync(ghostDir, { recursive: true });
  const id = '0f0f0f0f-1111-4222-8333-444455556666';
  writeFileSync(
    join(ghostDir, `${id}.jsonl`),
    `${JSON.stringify({ type: 'user', uuid: 'a1', parentUuid: null, sessionId: id, cwd: '/private/tmp/nowhere-at-all', timestamp: new Date().toISOString(), message: { role: 'user', content: 'A session whose folder is gone' } })}\n`,
  );
  await sleep(4_000);
  for (const title of ['A session whose folder is gone', 'Add dark mode', 'Refactor auth', 'Investigate flaky']) {
    await closeAll(c);
    await openSessionByTitle(c, title);
    await sleep(2_000);
    for (let i = 0; i < 15; i++) await monkeyStep(c).catch(() => {});
  }
  await c.page.keyboard.press('Meta+Shift+F');
  await c.page.keyboard.type('dark', { delay: 10 });
  await sleep(2_000);
  await closeAll(c);
  // Delete a transcript that is open.
  const open = await currentSession(c);
  if (open) {
    const f = readdirSync(projects, { recursive: true, encoding: 'utf8' }).find((x) => x.includes(open));
    if (f) {
      c.assertInSandbox(join(projects, f));
      rmSync(join(projects, f));
      c.log('world', 'deleted the open transcript');
      await sleep(4_000);
      for (let i = 0; i < 20; i++) await monkeyStep(c).catch(() => {});
    }
  }
  // A Claude profile folder added and removed while the app runs.
  const extra = join(home, '.claude-extra');
  mkdirSync(join(extra, 'projects'), { recursive: true });
  await closeAll(c);
  await c.page.locator('[data-open-settings]').first().click();
  await c.page.locator('[data-settings-section="profiles"]').first().click();
  await c.page.locator('[data-add-profile]').first().click();
  await c.page.locator('[data-new-profile-name]').first().fill('Extra');
  await c.page.locator('[data-new-profile-folder]').first().fill(extra);
  await c.page.locator('[data-add-profile-submit]').first().click();
  await sleep(1_500);
  c.assertInSandbox(extra);
  rmSync(extra, { recursive: true, force: true });
  c.log('world', 'removed the Extra profile folder');
  await sleep(3_000);
  rmSync(join(home, '.claude-work'), { recursive: true, force: true });
  c.log('world', 'removed the Work profile folder');
  await sleep(4_000);
  await c.page.locator('[data-close-settings]').first().click({ timeout: 2_000 }).catch(() => {});
  for (let i = 0; i < 80; i++) await monkeyStep(c).catch(() => {});
  await expensiveChecks(c);
};
