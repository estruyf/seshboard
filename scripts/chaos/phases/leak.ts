/**
 * Memory: 200 cycles of switching sessions, the terminal, Changes, the palette and Settings, measuring the heap after
 * a forced GC, DOM nodes, listeners and the engine's RSS every 50.
 */
import { sleep } from '../lib/harness.ts';
import { sessionIds, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const leak: Phase = async (c) => {
  await setUp(c);
  const cdp = await c.page.context().newCDPSession(c.page);
  await cdp.send('Performance.enable');
  const measure = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(300);
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
    const get = (n: string) => Math.round(metrics.find((m) => m.name === n)?.value ?? 0);
    return { heapMB: +(get('JSHeapUsedSize') / 1048576).toFixed(1), nodes: get('Nodes'), listeners: get('JSEventListeners'), engineMB: Math.round(c.rss(c.findEnginePid()) / 1048576) };
  };
  const ids = (await sessionIds(c)).slice(0, 4);
  const samples: Array<{ cycle: number; heapMB: number; nodes: number; listeners: number; engineMB: number }> = [];
  samples.push({ cycle: 0, ...(await measure()) });
  console.log('  ', JSON.stringify(samples.at(-1)));
  for (let cycle = 1; cycle <= 200; cycle++) {
    for (const id of ids) await c.page.locator(`[data-session-list] [data-session-id="${id}"]`).first().click({ timeout: 2_000 }).catch(() => {});
    await c.page.keyboard.press('Meta+J');
    await sleep(60);
    await c.page.keyboard.press('Meta+J');
    await c.page.keyboard.press('Meta+Shift+D');
    await sleep(60);
    await c.page.keyboard.press('Meta+Shift+D');
    await c.page.keyboard.press('Meta+K');
    await c.page.keyboard.type('se', { delay: 5 });
    await c.page.keyboard.press('Escape');
    await c.page.locator('[data-open-settings]').first().click({ timeout: 1_000 }).catch(() => {});
    await c.page.locator('[data-close-settings]').first().click({ timeout: 1_000 }).catch(() => {});
    c.actionCount++;
    if (cycle % 50 === 0) {
      samples.push({ cycle, ...(await measure()) });
      console.log('  ', JSON.stringify(samples.at(-1)));
    }
  }
  c.log('leak-samples', '', samples);
  const first = samples[0]!;
  const last = samples.at(-1)!;
  if (last.heapMB > first.heapMB * 1.5 + 5) c.signal('leak', `renderer heap after GC grew ${first.heapMB} → ${last.heapMB} MB over 200 cycles (nodes ${first.nodes} → ${last.nodes}, listeners ${first.listeners} → ${last.listeners})`);
  if (last.listeners > first.listeners * 1.5 + 200) c.signal('leak', `JS event listeners grew ${first.listeners} → ${last.listeners} over 200 cycles`);
  if (last.engineMB > first.engineMB * 1.5 + 30) c.signal('leak', `engine RSS grew ${first.engineMB} → ${last.engineMB} MB over 200 cycles`);
};
