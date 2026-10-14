/**
 * Scale: 3,000 transcripts written while the app runs; how long they take to show, and ⌘P, Search, the sidebar and
 * switching with that many.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expensiveChecks, headerCounts } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { monkeyStep } from '../lib/monkey.ts';
import { closeAll, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const scale: Phase = async (c) => {
  await setUp(c);
  const N = 3000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const cwd = join(c.world.home, 'Developer', `bulk-${i % 30}`);
    if (i < 30) mkdirSync(cwd, { recursive: true });
    const dir = join(c.world.home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    if (i < 30) mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    const at = Date.now() - i * 3_600_000;
    const user = { parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.287', gitBranch: 'main', entrypoint: 'cli', type: 'user', uuid: randomUUID(), timestamp: new Date(at).toISOString(), message: { role: 'user', content: `Bulk session ${i} about ${['payments', 'search', 'checkout', 'themes'][i % 4]}` } };
    const answer = { ...user, parentUuid: user.uuid, uuid: randomUUID(), type: 'assistant', timestamp: new Date(at + 5_000).toISOString(), message: { id: `msg_${i}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: `Answer ${i}` }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } } };
    writeFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify(user)}\n${JSON.stringify(answer)}\n`);
  }
  c.log('scale', `wrote ${N} transcripts`, Date.now() - t0);
  // Until the footer counts them (or 60 s).
  const t1 = Date.now();
  let count = 0;
  while (Date.now() - t1 < 60_000) {
    count = await c.page.evaluate(() => Number(/(\d[\d,]*) sessions/.exec(document.querySelector('[data-footer-sessions]')?.textContent ?? document.body.innerText)?.[1]?.replace(/,/g, '') ?? 0)).catch(() => 0);
    if (count >= N) break;
    await sleep(500);
  }
  const indexMs = Date.now() - t1;
  c.log('scale-indexed', '', { count, indexMs });
  console.log(`  indexed ${count} in ${indexMs} ms`);
  if (count < N) c.signal('scale', `after 60 s the footer counts ${count} sessions, ${N} were written`);
  const time = async (what: string, fn: () => Promise<unknown>) => {
    const s = performance.now();
    await fn();
    const ms = Math.round(performance.now() - s);
    c.log('scale-time', what, ms);
    console.log(`  ${what}: ${ms} ms`);
    if (ms > 1_000) c.signal('slow', `${what} took ${ms} ms with ${N} sessions`);
    return ms;
  };
  await time('⌘P opens with sessions listed', async () => {
    await c.page.keyboard.press('Meta+P');
    await c.page.locator('[data-palette-session]').first().waitFor({ timeout: 10_000 });
  });
  await time('⌘P filters "bulk 2999"', async () => {
    await c.page.keyboard.type('Bulk session 2999', { delay: 0 });
    await c.page.waitForFunction(() => [...document.querySelectorAll('[data-palette-session]')].some((e) => (e as HTMLElement).innerText.includes('Bulk session 2999')), null, { timeout: 10_000 }).catch(() => c.signal('scale', '⌘P did not find "Bulk session 2999"'));
  });
  await closeAll(c);
  await time('Search finds "checkout"', async () => {
    await c.page.keyboard.press('Meta+Shift+F');
    await c.page.keyboard.type('checkout', { delay: 0 });
    await c.page.locator('[data-search-hit]').first().waitFor({ timeout: 15_000 }).catch(() => c.signal('scale', 'Search showed no hit for "checkout"'));
  });
  await closeAll(c);
  // Open every Earlier group, scroll the sidebar to the end and back.
  await c.page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-section-toggle][data-open="false"]').forEach((b) => b.click()));
  await sleep(500);
  await time('sidebar scrolls to the end', async () => {
    for (let i = 0; i < 40; i++) {
      await c.page.mouse.move(150, 500);
      await c.page.mouse.wheel(0, 5_000);
    }
    await sleep(200);
  });
  await headerCounts(c);
  const rows = await c.page.evaluate(() => document.querySelectorAll('[data-session-list] [data-session-id]').length);
  c.log('scale-dom-rows', '', rows);
  console.log(`  rows in the DOM: ${rows}`);
  if (rows > 400) c.signal('scale', `${rows} session rows are in the DOM (the list should be virtualised)`);
  await time('switch to a bulk session', async () => {
    await c.page.locator('[data-session-list] [data-session-id]').last().click();
    await c.page.locator('[data-current-session] [data-transcript-item]').first().waitFor({ timeout: 10_000 }).catch(() => {});
  });
  for (let i = 0; i < 300; i++) await monkeyStep(c).catch(() => {});
  await closeAll(c);
  await expensiveChecks(c);
};
