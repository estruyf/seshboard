/** The window: search, the message box, zoom, the terminal, a hung engine, imports, themes, memory, the session order. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../lib/harness.ts';
import { closeAll, command, openSessionByTitle } from '../lib/ui.ts';
import type { Case } from './types.ts';

const HERO = 'Add dark mode toggle';

export const uiCases: Record<string, Case> = {
  upNextLayout: {
    finding: 'check',
    mutates: true,
    expect: 'Up next shows whole rows above the message box, never one cut in half under it, and a long message is cut short so every row keeps its actions in view.',
    async run(c, note) {
      const id = await openSessionByTitle(c, HERO);
      if (!id) return { ok: false, saw: 'no hero session' };
      const info = await c.rpc('system.info', {});
      const db = (info.result as { paths: { database: string } } | undefined)?.paths.database;
      if (!db) return { ok: false, saw: info.error ?? 'no database path' };
      c.assertInSandbox(db);
      // Messages kept for a session that isn't running show in its Up next. Written while the app is closed.
      const long = `Once you are done, you can start with the following issue, and read every comment on it first: ${'https://github.com/example/repo/issues/97 '.repeat(4)}`;
      const texts = [long, 'Fix issue 98', 'Fix issue 99', 'Fix issue 101', 'Implement issue 88', 'Also fix the queue'];
      const ids = texts.map(() => randomUUID());
      await c.quit();
      const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
      const rows = texts.map((text, i) => `(${quote(ids[i]!)}, ${quote(id)}, ${i}, ${quote(text)}, ${quote(i === 5 ? '[{"type":"image","mediaType":"image/png","data":"iVBORw0KGgo=","name":"image.png"}]' : '[]')}, ${Date.now() + i})`);
      execFileSync('/usr/bin/sqlite3', [db, `INSERT INTO up_next (id, session_id, position, text, attachments_json, created_at) VALUES ${rows.join(', ')};`]);
      await c.launch();
      try {
        await openSessionByTitle(c, HERO);
        await c.page.locator('[data-current-session] [data-queue-list]').waitFor();
        await sleep(300);
        // Hover the long row: its Edit and Remove show, and must sit inside the list.
        await c.page.locator('[data-current-session] [data-queue-item-row]').first().hover();
        await sleep(200);
        const seen = await c.page.evaluate(() => {
          const list = document.querySelector<HTMLElement>('[data-current-session] [data-queue-list]')!;
          const frame = document.querySelector('[data-current-session] [data-composer]')?.closest('.rounded-xl');
          const box = list.getBoundingClientRect();
          const rows = [...list.querySelectorAll<HTMLElement>('[data-queue-item-row]')].map((row) => row.getBoundingClientRect());
          const visible = rows.filter((r) => r.bottom > box.top + 0.5 && r.top < box.bottom - 0.5);
          const remove = list.querySelector('[data-queue-remove]')!.getBoundingClientRect();
          return {
            rows: rows.length,
            visible: visible.length,
            cutRows: visible.filter((r) => r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5).length,
            wider: list.scrollWidth - list.clientWidth,
            removeInside: remove.right <= box.right + 0.5 && remove.width > 0,
            overlapsBox: frame ? Math.max(0, box.bottom - frame.getBoundingClientRect().top) : null,
            more: list.dataset.queueMore === 'true',
          };
        });
        note('up next', seen);
        const ok = seen.rows === 6 && seen.visible === 5 && seen.cutRows === 0 && seen.wider <= 0 && seen.removeInside && seen.overlapsBox === 0 && seen.more;
        return { ok, saw: seen };
      } finally {
        for (const queued of ids) await c.rpc('session.queue.remove', { sessionId: id, id: queued });
      }
    },
  },

  copyRichText: {
    finding: 'check',
    expect: 'Copy as rich text on a Claude reply puts the rendered reply on the clipboard as HTML, and its Markdown as plain text.',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      const reply = c.page.locator('[data-current-session] [data-item-kind="text"]').filter({ has: c.page.locator('.markdown') }).first();
      await reply.waitFor();
      // The clipboard is the Mac's own: keep what is on it, and put it back.
      await c.app.evaluate(async ({ clipboard }) => {
        // Items read can't be written back as they are: keep their data, to build new ones.
        const saved: Array<Record<string, Blob>> = [];
        for (const item of await clipboard.read()) {
          const data: Record<string, Blob> = {};
          for (const type of item.types) {
            const value = await item.getType(type).catch(() => null);
            if (value instanceof Blob) data[type] = value;
          }
          if (Object.keys(data).length) saved.push(data);
        }
        (globalThis as { __chaosClipboard?: unknown }).__chaosClipboard = saved;
        await clipboard.clear();
      });
      try {
        await reply.hover();
        await reply.locator('[data-message-actions] button[aria-label="Copy as rich text"]').click();
        await c.page.waitForFunction(() => !!document.querySelector('[data-current-session] [data-message-actions] button[aria-label="Copied"]'), null, { timeout: 3_000 }).catch(() => {});
        const copied = await c.app.evaluate(async ({ clipboard }) => {
          const [item] = await clipboard.read();
          const read = async (type: string) => (item?.types.includes(type) ? await ((await item.getType(type)) as Blob).text() : '');
          return { text: await read('text/plain'), html: await read('text/html') };
        });
        note('clipboard', { text: copied.text.slice(0, 120), html: copied.html.slice(0, 200) });
        const html = /<(p|h\d|ul|ol|pre|table)\b/.test(copied.html) && !copied.html.includes('class=');
        const plain = copied.text.trim() !== '' && !/<\/?(p|h\d|ul|ol)\b/.test(copied.text);
        return { ok: html && plain, saw: { html: copied.html.slice(0, 200), text: copied.text.slice(0, 120) } };
      } finally {
        await c.app.evaluate(async ({ clipboard, ClipboardItem }) => {
          const saved = (globalThis as { __chaosClipboard?: Array<Record<string, Blob>> }).__chaosClipboard;
          if (saved?.length) await clipboard.write(saved.map((data) => new ClipboardItem(data)));
          else await clipboard.clear();
        });
      }
    },
  },

  engineHang: {
    finding: 'CU1',
    expect: 'When the engine stops answering for a while (paused 10 s), the window says so.',
    async run(c) {
      await openSessionByTitle(c, HERO);
      const pid = c.findEnginePid();
      if (!pid) return { ok: false, saw: 'no engine process' };
      process.kill(pid, 'SIGSTOP');
      try {
        // Ask for something, as clicking around would.
        await c.page.keyboard.press('Meta+Shift+D');
        await sleep(10_000);
        const said = await c.page.evaluate(() => /not responding|isn.t responding|isn.t answering|is busy|waiting for the engine|reconnect/i.exec(document.body.innerText)?.[0] ?? null);
        return { ok: said !== null, saw: said ?? 'nothing on screen' };
      } finally {
        process.kill(pid, 'SIGCONT');
        await sleep(1_000);
        await c.page.keyboard.press('Meta+Shift+D');
      }
    },
  },

  searchTooLong: {
    finding: 'CU5',
    expect: 'A search over 500 characters says it is too long (or stops at 500), instead of keeping the last results.',
    async run(c) {
      await closeAll(c);
      await c.page.keyboard.press('Meta+Shift+F');
      const input = c.page.locator('[data-search] input').first();
      await input.fill('dark');
      await c.page.locator('[data-search-hit]').first().waitFor({ timeout: 5_000 }).catch(() => {});
      await input.fill('x'.repeat(600));
      await sleep(1_500);
      const state = await c.page.evaluate(() => ({ value: (document.querySelector('[data-search] input') as HTMLInputElement | null)?.value.length ?? 0, hits: document.querySelectorAll('[data-search-hit]').length, said: /too long|500 characters/i.test((document.querySelector('[data-search]') as HTMLElement | null)?.innerText ?? '') }));
      await closeAll(c);
      return { ok: state.said || state.value <= 500 || state.hits === 0, saw: state };
    },
  },

  composerLines: {
    finding: 'CU7',
    expect: 'A key typed at the end of 4,000 lines in the message box takes under 200 ms (today Chromium editing makes it about 400).',
    async run(c, note) {
      await openSessionByTitle(c, 'Investigate flaky checkout');
      const box = c.page.locator('[data-current-session] [data-composer]').first();
      const t0 = performance.now();
      await box.fill('a\n'.repeat(4_000), { timeout: 120_000 });
      const fillMs = Math.round(performance.now() - t0);
      const t1 = performance.now();
      await box.press('End');
      await c.page.keyboard.type('z');
      const keyMs = Math.round(performance.now() - t1);
      await box.fill('');
      note('4000 lines', { fillMs, keyMs });
      return { ok: keyMs < 200, saw: { fillMs, keyMs } };
    },
  },

  zoomedSmallWindow: {
    finding: 'CU10',
    expect: 'At the smallest window and 144% zoom, the session header, the message box and Send stay inside the window.',
    async run(c, note) {
      await openSessionByTitle(c, HERO);
      await c.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]!;
        w.setContentSize(900, 560);
        w.webContents.setZoomLevel(2);
      });
      await sleep(800);
      const measured = await c.page.evaluate(() =>
        ['[data-current-session]', '[data-current-session] [data-composer]', '[data-current-session] [data-composer-submit]', '[data-current-session] [data-close-session]', '[data-git-button]'].map((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return { sel, rect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null, view: [innerWidth, innerHeight] };
        }),
      );
      note('measured', measured);
      const outside = measured.filter((m) => m.rect && (m.rect[2]! > m.view[0]! + 1 || m.rect[3]! > m.view[1]! + 1)).map((m) => m.sel);
      await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-zoom-2.png`) });
      await c.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]!;
        w.webContents.setZoomLevel(0);
        w.setContentSize(1440, 900);
      });
      return { ok: outside.length === 0, saw: { outside } };
    },
  },

  terminalWebgl: {
    finding: 'CT1',
    expect: 'Opening and closing the terminal 50 times in a row never runs out of WebGL contexts.',
    async run(c) {
      await openSessionByTitle(c, HERO);
      const warnings: string[] = [];
      const listen = (m: { text(): string }) => /WebGL contexts/.test(m.text()) && warnings.push(m.text());
      c.page.on('console', listen);
      // As fast as a person mashing ⌘J: each open mounts a new xterm with its own WebGL context.
      for (let i = 0; i < 50; i++) {
        await c.page.keyboard.press('Meta+J');
        if (i % 7 === 0) await sleep(30);
        await c.page.keyboard.press('Meta+J');
      }
      await sleep(1_000);
      c.page.off('console', listen);
      return { ok: warnings.length === 0, saw: { warnings: warnings.length } };
    },
  },

  terminalAfterRestart: {
    finding: 'CT3',
    expect: 'When the engine restarts, an open terminal panel says its shell ended (or starts a new one), rather than going blank.',
    async run(c) {
      await openSessionByTitle(c, HERO);
      await c.page.keyboard.press('Meta+J');
      await c.page.locator('[data-terminal]').first().waitFor({ timeout: 5_000 });
      c.expectEngineRestart = true;
      process.kill(c.findEnginePid()!, 'SIGKILL');
      await sleep(6_000);
      const state = await c.page.evaluate(() => ({ notice: (document.querySelector('[data-terminal-notice]') as HTMLElement | null)?.innerText ?? null, terminals: document.querySelectorAll('[data-terminal]').length }));
      await c.page.keyboard.press('Meta+J');
      return { ok: state.terminals > 0 || state.notice !== null, saw: state };
    },
  },

  importStillReading: {
    finding: 'CX2',
    expect: 'Importing a file that is not a settings export shows the reason once, and the dialog stops saying "Reading…".',
    async run(c) {
      const dir = join(c.world.root, 'imports');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'not-settings.json'), '{"hello": "world"}');
      await c.queueOpenDialog([join(dir, 'not-settings.json')]);
      if (!(await command(c, 'import-settings', 'Import settings'))) return { ok: false, saw: 'no Import settings in the palette' };
      await sleep(2_000);
      const dialog = await c.page.evaluate(() => (document.querySelector('[data-import-dialog]') as HTMLElement | null)?.innerText ?? '');
      await closeAll(c);
      const reading = /Reading /.test(dialog);
      const times = dialog.split('This is not a Seshboard settings file').length - 1;
      return { ok: !reading && times <= 1, saw: { reading, reasonShown: times } };
    },
  },

  memoryFolderIsFile: {
    finding: 'CX3',
    mutates: true,
    expect: "A project whose folder became a file gets a plain answer from the memory list, not an internal ENOTDIR error.",
    async run(c) {
      const mobile = join(c.world.home, 'Developer', 'mobile-app');
      c.assertInSandbox(mobile);
      renameSync(mobile, `${mobile}.moved`);
      writeFileSync(mobile, 'not a folder\n');
      try {
        const r = await c.rpc('memory.list', { root: mobile });
        const error = r.error as { code?: string; message?: string } | undefined;
        return { ok: r.ok || (error?.code !== 'INTERNAL' && !/ENOTDIR/.test(error?.message ?? '')), saw: r.ok ? 'ok' : error };
      } finally {
        c.assertInSandbox(mobile);
        rmSync(mobile);
        renameSync(`${mobile}.moved`, mobile);
      }
    },
  },

  themeImports: {
    finding: 'check',
    expect: 'Partial themes import; themes with bad colours, var(), CSS injection, a 49-character name or a newer format are refused; the page never breaks.',
    async run(c, note) {
      const dir = join(c.world.root, 'imports');
      mkdirSync(dir, { recursive: true });
      const themes: Record<string, [unknown, 'import' | 'refuse']> = {
        partial: [{ name: 'Partial', version: 1, dark: { colors: { bg: '#101010' } } }, 'import'],
        lightAccentOnly: [{ name: 'Only accent', version: 1, light: { accent: '#ff00ff' } }, 'import'],
        injection: [{ name: 'Inject</style><img src=x onerror=alert(1)>', version: 1, dark: { colors: { text: 'red; } body { display: none } x {', bg: 'url(javascript:alert(1))' } }, light: { colors: { bg: 'var(--sb-bg)' } } }, 'refuse'],
        longName: [{ name: 'x'.repeat(49), version: 1, dark: { canvas: '#112233' } }, 'refuse'],
        newerFormat: [{ name: 'Future', version: 2, dark: { canvas: '#112233' } }, 'refuse'],
        badColours: [{ name: 'Bad colours', version: 1, dark: { canvas: 'not-a-colour', colors: { bg: '#gggggg' } } }, 'refuse'],
      };
      let ok = true;
      for (const [name, [theme, want]] of Object.entries(themes)) {
        writeFileSync(join(dir, `${name}.json`), JSON.stringify(theme));
        await c.queueOpenDialog([join(dir, `${name}.json`)]);
        if (!(await command(c, 'import-theme', 'Import theme'))) return { ok: false, saw: 'no Import theme in the palette' };
        await sleep(1_200);
        const dialog = await c.page.evaluate(() => (document.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').slice(0, 200) ?? '');
        const refused = /Can.t import this theme/.test(dialog);
        await closeAll(c);
        const page = await c.page.evaluate(() => ({ visible: getComputedStyle(document.body).display !== 'none' && document.body.innerText.length > 50, injected: document.querySelectorAll('img[src="x"]').length }));
        if (refused !== (want === 'refuse') || !page.visible || page.injected) ok = false;
        note(name, { want, refused, ...page });
      }
      return { ok, saw: 'see notes' };
    },
  },

  sessionOrder: {
    finding: 'check',
    expect: '⌃⇥ walks the sessions in the sidebar\'s order, and the rail lists them in that order.',
    async run(c) {
      await closeAll(c);
      const sidebar = await c.page.evaluate(() => [...document.querySelectorAll('[data-session-list] [data-session-id]')].filter((e) => e.getAttribute('data-archived') !== 'true').map((e) => e.getAttribute('data-session-id')!));
      await c.page.locator(`[data-session-list] [data-session-id="${sidebar[0]}"]`).first().click();
      await sleep(500);
      const walked: string[] = [];
      for (let i = 0; i < sidebar.length; i++) {
        walked.push((await c.page.evaluate(() => document.querySelector('[data-current-session]')?.getAttribute('data-current-session') ?? 'none'))!);
        await c.page.keyboard.press('Control+Tab');
        await sleep(700); // past the 600 ms in which ⌃⇥ walking merges history entries
      }
      await command(c, 'sidebar-minimize', 'Minimize sidebar');
      await sleep(800);
      const rail = await c.page.evaluate(() => [...document.querySelectorAll('[data-sidebar-rail-row]')].map((e) => e.getAttribute('data-sidebar-rail-row')!));
      await command(c, 'sidebar-open', 'Open sidebar');
      const short = (ids: string[]) => ids.map((x) => x.slice(0, 4)).join(',');
      const inOrder = walked.join() === sidebar.join() && rail.slice(0, sidebar.length).join() === sidebar.join();
      return { ok: inOrder, saw: { sidebar: short(sidebar), ctrlTab: short(walked), rail: short(rail) } };
    },
  },

  newProjectFolder: {
    finding: 'check',
    mutates: true,
    expect: 'A transcript in a new project folder under ~/.claude/projects shows in the sidebar within 5 s.',
    async run(c) {
      const id = randomUUID();
      const cwd = join(c.world.home, 'Developer', 'fresh-project');
      const dir = join(c.world.home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(cwd, { recursive: true });
      mkdirSync(dir, { recursive: true });
      const line = { parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.287', gitBranch: '', entrypoint: 'cli', type: 'user', uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: 'user', content: 'Fresh project session' } };
      const t0 = Date.now();
      writeFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify(line)}\n`);
      while (Date.now() - t0 < 5_000) {
        if (await c.page.evaluate((id) => !!document.querySelector(`[data-session-id="${id}"]`), id)) return { ok: true, saw: { shownAfterMs: Date.now() - t0 } };
        await sleep(200);
      }
      return { ok: false, saw: 'not shown within 5 s' };
    },
  },
};
