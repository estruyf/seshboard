/**
 * Mixed: the monkey, with the world (files, commits, branches, index.lock, transcripts), the engine (SIGKILL, a short
 * SIGSTOP), slow git, failing gh and claude, links, window sizes and focus changing at random moments.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expensiveChecks } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { monkeyStep } from '../lib/monkey.ts';
import { closeAll, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const mix: Phase = async (c, { actions }) => {
  await setUp(c);
  const r = c.rng;
  const acme = c.world.acme;
  const outside = (cmd: string) => {
    c.assertInSandbox(acme);
    c.log('world', cmd);
    try {
      execFileSync('/bin/sh', ['-c', cmd], { cwd: acme, env: { PATH: '/usr/bin:/bin', HOME: c.world.home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'D', GIT_AUTHOR_EMAIL: 'd@e', GIT_COMMITTER_NAME: 'D', GIT_COMMITTER_EMAIL: 'd@e' }, stdio: 'pipe', timeout: 30_000 });
    } catch {}
  };
  const events: Array<[number, () => Promise<void> | void]> = [
    [3, () => outside(`echo ${r.int(0, 1e6)} > note-${r.int(0, 20)}.txt`)],
    [2, () => outside('git add -A >/dev/null 2>&1; git commit -qm wip >/dev/null 2>&1; true')],
    [2, () => outside(`git switch -q ${r.pick(['main', 'feat/dark-mode', 'feat/wishlist'])} 2>/dev/null; true`)],
    [1, () => outside('touch .git/index.lock; sleep 2; rm -f .git/index.lock')],
    [2, () => c.world.gitDelay(r.pick([0, 0, 1, 3]))],
    [1, () => c.world.ghMode(r.pick(['signed-in', 'signed-out', 'garbage', 'exit-2']))],
    [1, () => c.world.claudeMode(r.pick(['fail', 'fail', 'slow-fail', 'garbage']))],
    [1, async () => {
      const pid = c.findEnginePid();
      if (!pid) return;
      c.log('kill-engine', 'SIGKILL', pid);
      c.expectEngineRestart = true;
      process.kill(pid, 'SIGKILL');
    }],
    [1, async () => {
      const pid = c.findEnginePid();
      if (!pid) return;
      c.log('pause-engine', 'SIGSTOP 3s', pid);
      process.kill(pid, 'SIGSTOP');
      await sleep(3_000);
      process.kill(pid, 'SIGCONT');
    }],
    [2, async () => {
      const url = r.pick([
        `switchboard://new-session?prompt=mixed&cwd=${encodeURIComponent(acme)}`,
        `switchboard://session/${c.world.sessions.hero}`,
        `switchboard://new-session?question=1&prompt=q`,
        'switchboard://nonsense',
      ]);
      c.log('deep-link', url);
      await c.app.evaluate(({ app }, url) => void app.emit('open-url', { preventDefault() {} }, url), url);
    }],
    [2, async () => {
      const [w, h] = r.pick([[900, 600], [1440, 900], [700, 500], [2000, 700]] as const);
      c.log('resize', '', [w, h]);
      await c.app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]?.setContentSize(s.w, s.h), { w, h });
    }],
    [1, async () => {
      c.log('blur-focus');
      await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur());
      await sleep(200);
      await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    }],
    [1, () => {
      const projects = join(c.world.home, '.claude', 'projects');
      const files = readdirSync(projects, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.jsonl') && !f.includes('subagents'));
      if (!files.length) return;
      const f = join(projects, r.pick(files));
      c.assertInSandbox(f);
      c.log('world', 'append a line to a transcript', f.replace(c.world.root, '<sb>'));
      appendFileSync(f, r.chance(0.5) ? '{"type":"weird","x":1}\n' : '{"broken json\n');
    }],
  ];
  for (let i = 0; i < actions; i++) {
    if (r.chance(0.04)) await r.weighted(events)();
    else await monkeyStep(c).catch((e) => c.log('step-error', String((e as Error).message).slice(0, 200)));
    await sleep(r.int(20, 160));
    if (i % 25 === 24) {
      await closeAll(c);
      await expensiveChecks(c);
    }
    if (i % 200 === 199) console.log(`  ${i + 1} actions, ${c.signals.length} signals`);
  }
  c.world.gitDelay(0);
  c.world.ghMode('signed-in');
  c.world.claudeMode('fail');
};
