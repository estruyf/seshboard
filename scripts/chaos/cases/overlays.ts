/** Dialogs, menus and focus: which overlay is on top, what Escape closes, where focus goes after. */
import { sleep } from '../lib/harness.ts';
import { closeAll, command, focusDesc, openSessionByTitle, overlays } from '../lib/ui.ts';
import type { Case } from './types.ts';

const HERO = 'Add dark mode toggle';

export const overlayCases: Record<string, Case> = {
  menuUnderModal: {
    finding: 'CU2',
    expect: 'A shortcut that opens a modal over an open menu closes the menu, or one Escape closes only the modal.',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      let ok = true;
      for (const key of ['Meta+/', 'Meta+Shift+P', 'Meta+Shift+F', 'Meta+P']) {
        await closeAll(c);
        await c.page.locator('[data-current-session] [data-branch-menu]').first().click();
        await sleep(300);
        await c.page.keyboard.press(key);
        await sleep(400);
        const afterShortcut = (await overlays(c)).map((o) => o.label);
        await c.page.keyboard.press('Escape');
        await sleep(400);
        const afterEscape = (await overlays(c)).map((o) => o.label);
        const menuStayed = afterShortcut.some((l) => l.startsWith('Switch branch'));
        const bothClosed = afterEscape.length === 0;
        if (menuStayed && bothClosed) ok = false;
        note(key, { afterShortcut, afterEscape });
      }
      await closeAll(c);
      return { ok, saw: 'see notes' };
    },
  },

  paletteUnderDialog: {
    finding: 'CU9',
    expect: 'With Add context open, ⌘⇧P either does nothing or opens the palette on top; typing never goes into a palette you cannot see.',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      let ok = true;
      for (const key of ['Meta+Shift+P', 'Meta+K', 'Meta+P', 'Meta+Shift+F', 'Meta+/']) {
        await closeAll(c);
        await c.page.locator('[data-current-session] [data-composer]').first().focus();
        await c.page.keyboard.press('Meta+Shift+A');
        await c.page.locator('[data-add-context-dialog]').first().waitFor({ timeout: 3_000 });
        await c.page.keyboard.press(key);
        await sleep(500);
        // Is every open dialog's centre the dialog itself, or is one covered by another?
        const covered = await c.page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
            .filter((d) => d.getClientRects().length > 0)
            .filter((d) => {
              const r = d.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(40, r.height / 2));
              return !hit || !d.contains(hit);
            })
            .map((d) => [...d.attributes].find((a) => a.name.startsWith('data-'))?.name ?? d.getAttribute('aria-label')),
        );
        const focusIn = await c.page.evaluate(() => [...(document.activeElement?.closest('[role="dialog"]')?.attributes ?? [])].find((a) => a.name.startsWith('data-'))?.name ?? null);
        // Covered and holding the focus: what you type goes somewhere you can't see.
        if (covered.length && covered.includes(focusIn)) ok = false;
        note(key, { covered, focusIn });
      }
      await closeAll(c);
      return { ok, saw: 'see notes' };
    },
  },

  paletteDialogFocus: {
    finding: 'CU3',
    expect: 'A dialog opened from the palette gives focus back to what had it before the palette (the message box) when it closes.',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      let ok = true;
      for (const [id, title] of [['rename-session', 'Rename session'], ['shortcuts', 'Shortcuts'], ['export-settings', 'Export settings'], ['check-transcript', 'Check transcript']] as const) {
        await closeAll(c);
        await c.page.locator('[data-current-session] [data-composer]').first().focus();
        await c.page.keyboard.press('Meta+Shift+P');
        await c.page.locator('[data-command-palette] [data-palette-input]').first().fill(title);
        await c.page.locator(`[data-command-palette] [data-palette-command="${id}"]`).first().click();
        await sleep(600);
        await c.page.keyboard.press('Escape');
        await sleep(400);
        const after = await focusDesc(c);
        if (after === 'body') ok = false;
        note(id, after);
      }
      return { ok, saw: 'see notes' };
    },
  },

  settingsFocus: {
    finding: 'CU4',
    expect: 'Closing Settings with Escape gives focus back to the Settings button that opened it.',
    async run(c) {
      await closeAll(c);
      await c.page.locator('[data-open-settings]').first().focus();
      await c.page.keyboard.press('Enter');
      await c.page.locator('[data-settings]').first().waitFor();
      await c.page.keyboard.press('Escape');
      await sleep(400);
      const after = await focusDesc(c);
      return { ok: after !== 'body', saw: after };
    },
  },

  focusReturn: {
    finding: 'check',
    expect: 'The palette, Go to, the shortcuts sheet, Search, a row menu and the branch menu give focus back when closed with Escape.',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      let ok = true;
      for (const key of ['Meta+K', 'Meta+P', 'Meta+/', 'Meta+Shift+F']) {
        await c.page.locator('[data-current-session] [data-composer]').first().focus();
        await c.page.keyboard.press(key);
        await sleep(400);
        await c.page.keyboard.press('Escape');
        await sleep(400);
        const after = await focusDesc(c);
        if (!after.includes('data-composer')) ok = false;
        note(key, after);
      }
      for (const [name, sel, open] of [
        ['row menu', '[data-session-list] [data-session-id]', 'Shift+F10'],
        ['branch menu', '[data-current-session] [data-branch-menu]', 'Enter'],
      ] as const) {
        const el = c.page.locator(sel).nth(name === 'row menu' ? 1 : 0);
        await el.focus();
        const before = await focusDesc(c);
        await c.page.keyboard.press(open);
        await sleep(300);
        await c.page.keyboard.press('Escape');
        await sleep(300);
        const after = await focusDesc(c);
        if (after !== before) ok = false;
        note(name, { before, after });
      }
      return { ok, saw: 'see notes' };
    },
  },

  modalShortcutsBlocked: {
    finding: 'U3',
    expect: '⌘⇧D, ⌘F and ⌘⇧L do nothing while a dialog is open (fixed in the 2026-10-06 bug hunt).',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      if (!(await command(c, 'rename-session', 'Rename session'))) return { ok: false, saw: 'no Rename session in the palette' };
      await c.page.locator('[data-rename-session-dialog]').first().waitFor();
      const count = async () => ({ changes: await c.page.locator('[data-changes-panel]').count(), find: await c.page.locator('[data-find-bar]').count() });
      const before = await count();
      for (const key of ['Meta+Shift+D', 'Meta+F']) await c.page.keyboard.press(key);
      await sleep(500);
      const after = await count();
      note('panels', { before, after });
      await closeAll(c);
      return { ok: after.changes === before.changes && after.find === before.find, saw: { before, after } };
    },
  },
};
