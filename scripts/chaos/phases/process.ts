/**
 * e. Processes and timing: the engine SIGKILLed and paused (SIGSTOP), a shell and an action killed, slow git, gh
 * failing in four ways, Claude Code hanging and printing garbage, and four sessions started at once.
 */
import { join } from 'node:path';
import { expensiveChecks } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { monkeyStep } from '../lib/monkey.ts';
import { childrenOf, closeAll, composer, engineAnswers, goHome, openSessionByTitle, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const processChaos: Phase = async (c) => {
  await setUp(c);
  const engine = () => c.findEnginePid();
  // SIGKILL in the middle of actions, five times.
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 15; k++) await monkeyStep(c).catch(() => {});
    const pid = engine();
    if (!pid) {
      c.signal('engine', 'no engine process found');
      break;
    }
    c.log('kill-engine', 'SIGKILL', pid);
    c.expectEngineRestart = true;
    process.kill(pid, 'SIGKILL');
    for (let k = 0; k < 8; k++) await monkeyStep(c).catch(() => {});
    const text = await c.page.evaluate(() => document.body.innerText.match(/reconnect|restart|engine|lost/i)?.[0] ?? null).catch(() => null);
    c.log('after-kill-text', '', text);
    const ms = await engineAnswers(c);
    if (ms === null) c.signal('engine-recovery', `after SIGKILL #${i + 1} the UI did not answer within 20 s`);
    else c.log('recovered', '', ms);
    await closeAll(c);
  }
  // Several kills back to back (backoff).
  for (let i = 0; i < 4; i++) {
    const pid = engine();
    if (pid) {
      c.expectEngineRestart = true;
      c.log('kill-engine', 'SIGKILL rapid', pid);
      process.kill(pid, 'SIGKILL');
    }
    await sleep(700);
  }
  const rapid = await engineAnswers(c, 40_000);
  if (rapid === null) c.signal('engine-recovery', 'after four quick SIGKILLs the UI did not answer within 40 s');
  // SIGSTOP for 20 s, then SIGCONT.
  await closeAll(c);
  await openSessionByTitle(c, 'Add dark mode');
  const pid = engine();
  if (pid) {
    c.log('stop-engine', 'SIGSTOP', pid);
    process.kill(pid, 'SIGSTOP');
    for (let k = 0; k < 25; k++) await monkeyStep(c).catch(() => {});
    await sleep(Math.max(0, 20_000));
    await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-sigstop.png`) });
    const said = await c.page.evaluate(() => document.body.innerText.match(/not responding|reconnect|waiting for|engine/i)?.[0] ?? null).catch(() => null);
    c.log('sigstop-text', '', said);
    if (!said) c.signal('engine-paused-silent', 'the engine was paused (SIGSTOP) for 20 s and the UI said nothing about it');
    process.kill(pid, 'SIGCONT');
    c.log('cont-engine', 'SIGCONT', pid);
    const ms = await engineAnswers(c, 30_000);
    if (ms === null) c.signal('engine-recovery', 'after SIGSTOP/SIGCONT the UI did not answer within 30 s');
  }
  // Kill a terminal's shell and a project action's process while they run.
  await closeAll(c);
  await openSessionByTitle(c, 'Add dark mode');
  await c.page.keyboard.press('Meta+J');
  await sleep(2_500);
  const ep = engine();
  const shells = ep ? childrenOf(ep).filter((x) => /zsh|bash/.test(x.cmd)) : [];
  c.log('terminal-shells', '', shells.length);
  for (const s of shells) {
    c.log('kill-shell', s.cmd.slice(0, 60), s.pid);
    process.kill(s.pid, 'SIGKILL');
  }
  await sleep(2_000);
  await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-shell-killed.png`) });
  await c.page.keyboard.press('Meta+J');
  // The Test action (sleep 30).
  await c.page.locator('[data-current-session] [data-action-pill]').first().click({ timeout: 3_000 }).catch(() => c.log('no-action-pill'));
  await sleep(2_500);
  const actionProcs = ep ? childrenOf(ep).filter((x) => /sleep 30|sleep/.test(x.cmd)) : [];
  for (const a of actionProcs) {
    c.log('kill-action', a.cmd.slice(0, 60), a.pid);
    process.kill(a.pid, 'SIGKILL');
  }
  await sleep(2_500);
  await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-action-killed.png`) });
  await closeAll(c);
  // Slow git, and gh failing in different ways.
  c.world.gitDelay(4);
  c.log('git-delay', '4s');
  for (const title of ['Add dark mode', 'Investigate flaky', 'Refactor auth']) {
    await openSessionByTitle(c, title);
    for (let k = 0; k < 10; k++) await monkeyStep(c).catch(() => {});
  }
  await sleep(16_000);
  await c.pollPage();
  c.world.gitDelay(0);
  await closeAll(c);
  for (const mode of ['signed-out', 'garbage', 'exit-2', 'hang'] as const) {
    c.world.ghMode(mode);
    c.log('gh-mode', mode);
    await openSessionByTitle(c, 'Add dark mode');
    await c.page.locator('[data-current-session] [data-git-menu]').first().click({ timeout: 2_000 }).catch(() => {});
    await c.page.locator('[role="menu"] [data-git-step="pr"]').first().click({ timeout: 2_000 }).catch(() => c.log('no-pr-step'));
    await sleep(mode === 'hang' ? 20_000 : 4_000);
    await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-gh-${mode}.png`) });
    await closeAll(c);
  }
  c.world.ghMode('signed-in');
  // Claude Code that hangs, then several sessions in one folder at once.
  c.world.claudeMode('hang');
  await openSessionByTitle(c, 'Investigate flaky');
  await composer(c).fill('this send hangs');
  await c.page.keyboard.press('Enter');
  await sleep(20_000);
  await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-claude-hang.png`) });
  c.log('press', 'Escape (stop a hanging start)');
  await composer(c).focus().catch(() => {});
  await c.page.keyboard.press('Escape');
  await sleep(3_000);
  c.world.claudeMode('garbage');
  await composer(c).fill('garbage reply');
  await c.page.keyboard.press('Enter');
  await sleep(5_000);
  c.world.claudeMode('fail');
  for (let i = 0; i < 4; i++) {
    await goHome(c);
    await c.page.keyboard.press('Meta+N');
    await c.page.locator('[data-new-session-view] [data-composer]').first().waitFor({ timeout: 4_000 }).catch(() => {});
    await composer(c).fill(`parallel start ${i}`);
    await c.page.keyboard.press('Meta+Enter');
    await sleep(150);
  }
  await sleep(6_000);
  await closeAll(c);
  await expensiveChecks(c);
};
