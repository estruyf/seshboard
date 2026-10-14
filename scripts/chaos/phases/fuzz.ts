/**
 * c. Input fuzzing: the fuzz strings in every text field (message box, New session, palette, Go to, Search, the
 * sidebar's search, Rename, Settings search, Find, /btw), long text around MAX_PROMPT_LENGTH typed and pasted, and
 * `@` and `/` typed fast and deleted.
 */
import { expensiveChecks } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { fuzzStrings, longInputs } from '../lib/monkey.ts';
import { closeAll, command, composer, goHome, openSessionByTitle, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const fuzz: Phase = async (c) => {
  await setUp(c);
  const strings = fuzzStrings(c);
  const fields: Array<{ name: string; open: () => Promise<boolean>; selector: string; submit?: string }> = [
    { name: 'composer', open: async () => !!(await openSessionByTitle(c, 'Investigate flaky checkout')), selector: '[data-current-session] [data-composer]', submit: 'Enter' },
    {
      name: 'new-session',
      open: async () => {
        await goHome(c);
        await c.page.keyboard.press('Meta+N');
        return c.page.locator('[data-new-session-view] [data-composer]').first().waitFor({ timeout: 4_000 }).then(() => true, () => false);
      },
      selector: '[data-new-session-view] [data-composer]',
    },
    {
      name: 'palette',
      open: async () => {
        await c.page.keyboard.press('Meta+Shift+P');
        return true;
      },
      selector: '[data-command-palette] [data-palette-input]',
      submit: 'Enter',
    },
    {
      name: 'goto',
      open: async () => {
        await c.page.keyboard.press('Meta+P');
        return true;
      },
      selector: '[data-command-palette] [data-palette-input]',
    },
    {
      name: 'search',
      open: async () => {
        await c.page.keyboard.press('Meta+Shift+F');
        return true;
      },
      selector: '[data-search] input',
      submit: 'Enter',
    },
    {
      name: 'sidebar-search',
      open: async () => {
        await closeAll(c);
        return true;
      },
      selector: '[data-sidebar] input[type="search"], [data-sidebar] input',
    },
    {
      name: 'rename-session',
      open: async () => {
        await closeAll(c);
        await openSessionByTitle(c, 'Refactor auth');
        return command(c, 'rename-session', 'Rename session');
      },
      selector: '[data-rename-session-input]',
      submit: 'Enter',
    },
    {
      name: 'settings-search',
      open: async () => {
        await closeAll(c);
        await c.page.locator('[data-open-settings]').first().click();
        return true;
      },
      selector: '[data-settings-search] input, input[data-settings-search]',
    },
    {
      name: 'find',
      open: async () => {
        await closeAll(c);
        await c.page.locator('[data-close-settings]').first().click({ timeout: 1_000 }).catch(() => {});
        await openSessionByTitle(c, 'Add dark mode');
        await c.page.keyboard.press('Meta+F');
        return true;
      },
      selector: '[data-find-input]',
      submit: 'Enter',
    },
    {
      name: 'btw',
      open: async () => {
        await closeAll(c);
        return !!(await openSessionByTitle(c, 'Add dark mode'));
      },
      selector: '[data-current-session] [data-composer]',
      submit: 'Enter',
    },
  ];
  for (const f of fields) {
    console.log(`  field ${f.name}`);
    for (const text of strings) {
      if (!(await f.open().catch(() => false))) {
        c.log('field-missing', f.name);
        break;
      }
      const el = c.page.locator(f.selector).first();
      if (!(await el.waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
        c.signal('field-missing', `${f.name}: ${f.selector} not found`);
        break;
      }
      const value = f.name === 'btw' ? `/btw ${text}` : text;
      c.log('fuzz', f.name, value);
      const t0 = performance.now();
      await el.fill(value, { timeout: 5_000 }).catch((e) => c.log('fill-error', f.name, String(e).slice(0, 100)));
      if (text.length < 60 && c.rng.chance(0.4)) await el.type(text.slice(0, 20), { delay: 3 }).catch(() => {});
      if (f.submit && c.rng.chance(0.6)) await c.page.keyboard.press(f.submit);
      const ms = performance.now() - t0;
      if (ms > 2_000) c.signal('slow-input', `${f.name}: typing ${JSON.stringify(text.slice(0, 30))} took ${Math.round(ms)} ms`);
      await sleep(150);
      if (['palette', 'goto', 'search', 'find'].includes(f.name)) await closeAll(c);
    }
    await closeAll(c);
  }
  // Long inputs into the composer: under, at and over 2 MB, a 5,000-line fence.
  for (const [name, text] of longInputs()) {
    await closeAll(c);
    await openSessionByTitle(c, 'Investigate flaky checkout');
    const el = composer(c);
    c.log('long-fill', name, text.length);
    const t0 = performance.now();
    await el.fill(text, { timeout: 30_000 }).catch((e) => c.signal('long-input', `${name}: fill failed ${String(e).slice(0, 200)}`));
    const fillMs = performance.now() - t0;
    if (fillMs > 3_000) c.signal('slow-input', `${name}: filling ${text.length} characters took ${Math.round(fillMs)} ms`);
    await sleep(500);
    const reason = await c.page.evaluate(() => (document.querySelector('[data-current-session] [data-composer]')?.closest('[data-current-session]')?.textContent ?? '').match(/too long[^.]*\./i)?.[0] ?? null).catch(() => null);
    c.log('long-reason', name, reason);
    await c.page.keyboard.press('Enter');
    await sleep(2_500);
    await el.fill('').catch(() => {});
    // The same text as a paste (a paste becomes a card above the box).
    c.log('long-paste', name, text.length);
    await el.focus().catch(() => {});
    const t1 = performance.now();
    await c.page
      .evaluate((t) => {
        const box = document.querySelector('[data-current-session] [data-composer]') as HTMLTextAreaElement | null;
        const dt = new DataTransfer();
        dt.setData('text/plain', t);
        box?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, text)
      .catch((e) => c.signal('long-input', `${name}: paste failed ${String(e).slice(0, 200)}`));
    const pasteMs = performance.now() - t1;
    if (pasteMs > 3_000) c.signal('slow-input', `${name}: pasting ${text.length} characters took ${Math.round(pasteMs)} ms`);
    await sleep(800);
    await c.page.keyboard.press('Enter');
    await sleep(2_500);
    await c.sampleMemory();
  }
  // @ mentions and / commands, typed fast and deleted.
  await closeAll(c);
  await openSessionByTitle(c, 'Add dark mode');
  const el = composer(c);
  await el.fill('');
  await el.focus();
  for (const seq of ['@', '@src/', '@nonexistent', '@../../', '/', '/comp', '/nonexistent', '/btw', '@' + 'a'.repeat(300)]) {
    for (let i = 0; i < 5; i++) {
      c.log('mention', seq);
      await c.page.keyboard.type(seq, { delay: 1 });
      for (let k = 0; k < seq.length; k++) await c.page.keyboard.press('Backspace');
    }
    await c.page.keyboard.type(seq, { delay: 1 });
    await sleep(400);
    await c.page.keyboard.press('Enter');
    await sleep(300);
    await el.fill('').catch(() => {});
  }
  await expensiveChecks(c);
};
