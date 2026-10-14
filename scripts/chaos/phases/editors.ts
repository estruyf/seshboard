/**
 * c. Input fuzzing in the editors: a project action per fuzz string (name, an echo command, a shortcut), the saved
 * actions run, and new memories (Settings › Memory).
 */
import { expensiveChecks } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { fuzzStrings, monkeyStep } from '../lib/monkey.ts';
import { closeAll, command, openSessionByTitle, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const editors: Phase = async (c) => {
  await setUp(c);
  const strings = fuzzStrings(c).filter((s) => !/;|\||&|`|\$\(/.test(s)); // never a shell sequence as an action command
  // Project actions: a new action per input, with the input as its name and as its command (echo of it).
  for (const text of strings) {
    await closeAll(c);
    await openSessionByTitle(c, 'Investigate flaky checkout');
    const opened = await command(c, 'new-action', 'New action');
    if (!opened) break;
    const name = c.page.locator('[data-action-name]').first();
    if (!(await name.waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
      c.signal('field-missing', 'the action editor has no [data-action-name]');
      break;
    }
    c.log('fuzz', 'action', text);
    await name.fill(text).catch(() => {});
    await c.page.locator('[data-action-command]').first().fill(`echo ${JSON.stringify(text.slice(0, 200))}`).catch(() => {});
    const shortcut = c.page.locator('[data-action-shortcut]').first();
    if (c.rng.chance(0.5) && (await shortcut.count())) {
      await shortcut.click().catch(() => {});
      await c.page.keyboard.press(c.rng.pick(['Meta+K', 'Meta+Shift+T', 'Meta+Q', 'Meta+Alt+1', 'Escape', 'Backspace']));
    }
    await c.page.locator('[data-save-action]').first().click({ timeout: 2_000 }).catch(() => {});
    await sleep(500);
    const error = await c.page.locator('[data-action-save-error]').first().innerText({ timeout: 300 }).catch(() => null);
    c.log('action-saved', '', error);
    await closeAll(c);
  }
  // Run the saved actions (echo only).
  await openSessionByTitle(c, 'Investigate flaky checkout');
  const pills = await c.page.locator('[data-current-session] [data-action-pill]').count();
  c.log('pills', '', pills);
  for (let i = 0; i < Math.min(pills, 6); i++) {
    await c.page.locator('[data-current-session] [data-action-pill]').nth(i).click({ timeout: 2_000 }).catch(() => {});
    await sleep(700);
    await c.page.locator('[role="alertdialog"] [data-confirm]').first().click({ timeout: 500 }).catch(() => {});
  }
  await sleep(2_000);
  await closeAll(c);
  // Memory: a new memory per input (name, description, body), then the editor.
  await c.page.locator('[data-open-settings]').first().click();
  await c.page.locator('[data-settings-section="memory"]').first().click();
  for (const text of strings.slice(0, 20)) {
    const add = c.page.locator('[data-memory-new]').first();
    if (!(await add.count())) {
      c.signal('field-missing', 'no [data-memory-new] in Settings › Memory');
      break;
    }
    await add.click().catch(() => {});
    if (!(await c.page.locator('[data-memory-new-name]').first().waitFor({ timeout: 2_000 }).then(() => true, () => false))) break;
    c.log('fuzz', 'memory', text);
    await c.page.locator('[data-memory-new-name]').first().fill(text.slice(0, 300)).catch(() => {});
    await c.page.locator('[data-memory-new-description]').first().fill(text).catch(() => {});
    await c.page.locator('[data-memory-new-body]').first().fill(`${text}\n\n${text}`).catch(() => {});
    await c.page.locator('[data-memory-new-save]').first().click({ timeout: 2_000 }).catch(() => {});
    await sleep(600);
    await closeAll(c);
  }
  await c.page.locator('[data-memory-row]').first().click({ timeout: 2_000 }).catch(() => {});
  for (let i = 0; i < 40; i++) await monkeyStep(c).catch(() => {});
  await closeAll(c);
  await expensiveChecks(c);
};
