/** Starting sessions when Claude Code fails, folders that aren't folders, malformed output, many sessions at once. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../lib/harness.ts';
import { composer, newSessionIn, openSessionByTitle } from '../lib/ui.ts';
import type { Case } from './types.ts';

const create = (cwd: string, extra: Record<string, unknown> = {}) => ({ cwd, prompt: 'hello', attachments: [], model: null, permissionMode: 'default', effort: null, worktree: null, checkoutBranch: null, profileId: 'default', ...extra });
const message = (r: { ok: boolean; result?: unknown; error?: unknown }) => (r.ok ? r.result : r.error) as { message?: string; code?: string; sessionId?: string };

export const sessionCases: Record<string, Case> = {
  deadWarm: {
    finding: 'CE1',
    expect: 'After a pre-warmed Claude Code process exited, a new session (any mode or model) starts on a fresh process or says why Claude Code failed, never "This session is not running".',
    async run(c, note) {
      let ok = true;
      for (const extra of [{ permissionMode: 'plan' }, { model: 'opus' }, {}]) {
        await c.rpc('session.prewarm', { cwd: c.world.acme, profileId: 'default' });
        await sleep(2_500); // the fake claude exits at once, like a crashed or logged-out one
        const r = message(await c.rpc('session.create', create(c.world.acme, extra)));
        if (r.message === 'This session is not running') ok = false;
        note(JSON.stringify(extra), r);
      }
      return { ok, saw: 'see notes' };
    },
  },

  fileAsFolder: {
    finding: 'CS1',
    expect: 'A file is refused as a session folder: session.create says so, and projects.inspect does not call it an existing folder.',
    async run(c) {
      const file = join(c.world.acme, 'package.json');
      const created = await c.rpc('session.create', create(file));
      const inspect = message(await c.rpc('projects.inspect', { path: file })) as { exists?: boolean };
      const refused = !created.ok && message(created).code !== 'INTERNAL';
      return { ok: refused && inspect.exists !== true, saw: { create: message(created), inspect } };
    },
  },

  typedFilePath: {
    finding: 'CS1',
    expect: "A file's path typed in New session's project field is not offered (or not started) as a folder.",
    async run(c) {
      const file = join(c.world.acme, 'package.json');
      await newSessionIn(c, 'acme-store');
      await c.page.locator('[data-new-session-view] button[data-folder-select]').first().click();
      await c.page.locator('[data-new-session-view] input[data-folder-select]').first().fill(file);
      await sleep(500);
      await c.page.keyboard.press('Enter');
      await sleep(1_000);
      await c.calls(true);
      // New session can refuse the file before a prompt is typed: a disabled message box doesn't start it.
      const box = composer(c);
      if (await box.isDisabled()) {
        const reason = await c.page.evaluate(() => /a file, not a folder|no longer exists/i.exec((document.querySelector('[data-new-session-view]') as HTMLElement | null)?.innerText ?? '')?.[0] ?? null);
        return { ok: true, saw: { refused: reason ?? 'message box disabled' } };
      }
      await box.fill('typed a file path');
      await c.page.keyboard.press('Meta+Enter');
      await sleep(3_000);
      const sent = (await c.calls()).filter((x) => x.method === 'session.create').map((x) => x.params.cwd);
      return { ok: !sent.includes(file), saw: sent.map((p) => String(p).replace(c.world.root, '<sandbox>')) };
    },
  },

  newSessionFails: {
    finding: 'CS2',
    mutates: true,
    expect: 'When a new session fails at once (no login), its prompt can be sent again: it is back in the message box, and kept as unsent after a restart.',
    async run(c, note) {
      const prompt = 'A prompt that must not get lost';
      await newSessionIn(c, 'acme-store');
      await composer(c).fill(prompt);
      await c.page.keyboard.press('Meta+Enter');
      await sleep(5_000);
      const view = await c.page.evaluate(() => {
        const box = document.querySelector('[data-current-session] [data-composer]') as HTMLTextAreaElement | null;
        return { header: (document.querySelector('[data-current-session]') as HTMLElement | null)?.innerText.split('\n').slice(0, 3).join(' | ') ?? null, boxDisabled: box?.disabled ?? null, boxText: box?.value ?? null };
      });
      note('view', view);
      await c.restart();
      await sleep(2_000);
      const unsent = await c.page.evaluate(() => (document.querySelector('[data-home-unsent]') as HTMLElement | null)?.innerText ?? '');
      note('unsent after restart', unsent.slice(0, 200));
      return { ok: view.boxDisabled === false && view.boxText === prompt && unsent.includes(prompt), saw: { ...view, unsent: unsent.slice(0, 200) } };
    },
  },

  garbageInit: {
    finding: 'CE3',
    mutates: true,
    expect: 'A malformed message from Claude Code fails only that run: the Worktrees list still loads afterwards.',
    async run(c, note) {
      c.world.claudeMode('garbage');
      await openSessionByTitle(c, 'Investigate flaky checkout');
      await composer(c).fill('garbage reply');
      await c.page.keyboard.press('Enter');
      await sleep(5_000);
      c.world.claudeMode('fail');
      const list = await c.rpc('worktrees.list', { root: c.world.acme, fetch: false });
      note('worktrees.list', list.ok ? 'ok' : list.error);
      return { ok: list.ok, saw: list.ok ? 'ok' : list.error };
    },
  },

  burst: {
    finding: 'CU11',
    mutates: true,
    expect: '150 sessions appearing at once show up without a React error #185 and without the window stalling for a second.',
    async run(c, note) {
      const n = Number(process.env.CHAOS_BURST_N ?? 150);
      const signalsBefore = c.signals.length;
      for (let i = 0; i < n; i++) {
        const cwd = join(c.world.home, 'Developer', `burst-${i % 10}`);
        const dir = join(c.world.home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
        if (i < 10) {
          mkdirSync(cwd, { recursive: true });
          mkdirSync(dir, { recursive: true });
        }
        const id = randomUUID();
        const user = { parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.287', gitBranch: 'main', entrypoint: 'cli', type: 'user', uuid: randomUUID(), timestamp: new Date(Date.now() - i * 60_000).toISOString(), message: { role: 'user', content: `Burst ${i}` } };
        writeFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify(user)}\n`);
      }
      // The longest the window took to answer while they came in.
      let worst = 0;
      const end = Date.now() + 15_000;
      while (Date.now() < end) {
        const t = performance.now();
        await c.page.evaluate(() => 1);
        worst = Math.max(worst, performance.now() - t);
        await sleep(100);
      }
      await c.pollPage();
      const react185 = c.signals.slice(signalsBefore).some((s) => s.kind === 'pageerror' && /#185/.test(s.detail));
      const footer = await c.page.evaluate(() => document.querySelector('[data-footer-sessions]')?.textContent ?? null);
      note('result', { n, worstAnswerMs: Math.round(worst), react185, footer });
      return { ok: !react185 && worst < 1_000, saw: { worstAnswerMs: Math.round(worst), react185 } };
    },
  },
};
