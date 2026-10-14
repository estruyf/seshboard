/**
 * g. The edges: deep links of every kind (and in a burst, during a reload, over dialogs), the companion socket
 * (garbage, half and huge messages, wrong tokens, 400 connections), and settings, theme and memory imports of bad
 * files, then exports.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { expensiveChecks } from '../lib/checks.ts';
import { sleep } from '../lib/harness.ts';
import { closeAll, command, engineAnswers, goHome, setUp } from '../lib/ui.ts';
import type { Phase } from './types.ts';

export const edges: Phase = async (c) => {
  await setUp(c);
  const home = c.world.home;
  const acme = c.world.acme;
  const link = async (url: string) => {
    c.log('deep-link', url.length > 200 ? `${url.slice(0, 200)}…(${url.length})` : url);
    await c.app.evaluate(({ app }, url) => void app.emit('open-url', { preventDefault() {} }, url), url);
    await sleep(700);
  };
  const enc = encodeURIComponent;
  const links = [
    `switchboard://new-session?prompt=${enc('hello')}&cwd=${enc(acme)}`,
    `switchboard://new-session?prompt=${enc('auto')}&cwd=${enc(acme)}&autostart=1`,
    `switchboard://new-session?project=acme-store&autostart=yes&prompt=x`,
    `switchboard://new-session?cwd=${enc(acme + '/../acme-store')}`,
    `switchboard://new-session?cwd=${enc(acme + '​')}`,
    `switchboard://new-session?cwd=${enc('‮' + acme)}`,
    `switchboard://new-session?prompt=${enc('a'.repeat(5_001))}`,
    `switchboard://new-session?prompt=${enc('x'.repeat(31_000))}`,
    `switchboard://new-session?prompt=${enc('\u0000null')}`,
    `switchboard://new-session?prompt=${enc('👩‍👩‍👧')}&question=1`,
    `switchboard://new-session?autostart=maybe`,
    `switchboard://new-session?repo=evil/../../x`,
    `switchboard://new-session?cwd=${enc(home + '/does-not-exist')}&autostart=1&prompt=x`,
    `switchboard://new-session?cwd=${enc(acme + '/package.json')}&autostart=1&prompt=x`,
    `switchboard://new-session?cwd=${enc(acme)}&autostart=1&mode=bypassPermissions&permissionMode=bypassPermissions&prompt=bypass`,
    `switchboard://new-session?cwd=${enc(acme)}&autostart=1&mode=auto&prompt=auto`,
    `switchboard://new-session?cwd=${enc(acme)}&autostart=1&dangerouslySkipPermissions=1&prompt=skip`,
    `switchboard://session/not-a-real-session`,
    `switchboard://session/${'a'.repeat(100)}`,
    `switchboard://session/${c.world.sessions.hero}`,
    `switchboard://session/../../etc/passwd`,
    `switchboard://%E0%A4%A`,
    `switchboard://delete-everything`,
    `switchboard:new-session?prompt=path-form`,
    `switchboard://show`,
    `switchboard://show?x=1`,
    `SWITCHBOARD://NEW-SESSION?prompt=upper`,
    `switchboard://new-session?cwd=${enc('//server/share')}`,
    `switchboard://new-session?cwd=${enc('file:///etc')}`,
    `x`.repeat(40_000),
  ];
  for (const url of links) {
    await link(url);
    await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-link-${links.indexOf(url)}.png`) });
    // A link that autostarted with a permission mode other than the project's or default is a security finding.
    const mode = await c.page.evaluate(() => document.querySelector('[data-current-session] [data-chip="mode"], [data-new-session-view] [data-chip="mode"]')?.getAttribute('aria-label') ?? document.querySelector('[data-chip="mode"]')?.textContent ?? null).catch(() => null);
    c.log('mode-after-link', '', mode);
    if (mode && /bypass|auto|don.t ask|accept edits/i.test(mode) && /mode=|permissionMode|dangerously/.test(url)) c.signal('link-permission', `a link set the permission mode to "${mode}": ${url.slice(0, 160)}`);
    await closeAll(c);
    await goHome(c);
  }
  // Links while a dialog is open, and many at once.
  await c.page.keyboard.press('Meta+/');
  await link(`switchboard://new-session?prompt=${enc('while the shortcuts sheet is open')}&cwd=${enc(acme)}`);
  await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-link-over-dialog.png`) });
  await closeAll(c);
  await c.page.locator('[data-open-settings]').first().click();
  await link(`switchboard://session/${c.world.sessions.hero}`);
  await sleep(1_000);
  const inSettings = await c.page.evaluate(() => !!document.querySelector('[data-settings]')).catch(() => false);
  c.log('link-from-settings', '', { stillInSettings: inSettings });
  await closeAll(c);
  for (let i = 0; i < 30; i++) void c.app.evaluate(({ app }, i) => void app.emit('open-url', { preventDefault() {} }, `switchboard://new-session?prompt=burst${i}`), i);
  await sleep(3_000);
  // A link that arrives while the window reloads.
  void c.page.reload();
  await link(`switchboard://new-session?prompt=${enc('during reload')}`);
  await sleep(5_000);
  await closeAll(c);

  // The companion socket.
  const infoFile = join(c.profileDir, 'companion', 'engine.json');
  if (!existsSync(infoFile)) c.signal('companion', 'no companion engine.json in the profile');
  else {
    const info = JSON.parse(readFileSync(infoFile, 'utf8')) as { socket: string; token: string };
    const send = (chunks: Array<string | Buffer>, opts: { wait?: number; end?: boolean } = {}) =>
      new Promise<string>((resolve) => {
        const s = connect(info.socket);
        let got = '';
        s.on('data', (d) => (got += d.toString()));
        s.on('error', (e) => resolve(`error ${e.message}`));
        s.on('close', () => resolve(got));
        s.on('connect', async () => {
          for (const ch of chunks) {
            s.write(ch);
            await sleep(5);
          }
          if (opts.end) s.end();
          setTimeout(() => s.destroy(), opts.wait ?? 1_000);
        });
      });
    const hello = `${JSON.stringify({ kind: 'request', id: 1, method: 'hello', params: { token: info.token, protocol: 1, client: { name: 'chaos', version: '0' } } })}\n`;
    const cases: Array<[string, Array<string | Buffer>, { wait?: number; end?: boolean }?]> = [
      ['garbage', ['\u0000\u0001\u0002 not json\n']],
      ['half', ['{"kind":"request","id":1,"meth'], { wait: 6_500 }],
      ['no-newline-big', ['x'.repeat(9 * 1024 * 1024)], { wait: 3_000 }],
      ['wrong-token', [`${JSON.stringify({ kind: 'request', id: 1, method: 'hello', params: { token: 'nope', protocol: 1, client: { name: 'x', version: '0' } } })}\n`]],
      ['before-hello', [`${JSON.stringify({ kind: 'request', id: 1, method: 'sessions.list', params: { folders: [acme] } })}\n`]],
      ['hello-ok', [hello]],
      ['hello-then-garbage', [hello, '{"kind":"request","id":2,"method":"sessions.list","params":{"folders":"not-an-array"}}\n', '[1,2,3]\n', 'null\n']],
      ['hello-then-unknown', [hello, `${JSON.stringify({ kind: 'request', id: 2, method: 'engine.shutdown', params: {} })}\n`]],
      ['hello-then-huge-list', [hello, `${JSON.stringify({ kind: 'request', id: 2, method: 'sessions.list', params: { folders: Array.from({ length: 10_000 }, (_, i) => `${acme}/${i}`), limit: 200 } })}\n`], { wait: 5_000 }],
      ['hello-then-context', [hello, `${JSON.stringify({ kind: 'request', id: 2, method: 'context.add', params: { target: { kind: 'session', sessionId: c.world.sessions.hero }, items: Array.from({ length: 101 }, () => ({ kind: 'file', path: `${acme}/README.md` })) } })}\n`]],
      ['hello-then-watch-drop', [hello, `${JSON.stringify({ kind: 'request', id: 2, method: 'sessions.watch', params: { folders: [acme] } })}\n`], { wait: 200 }],
      ['split-utf8', [hello.slice(0, 10), hello.slice(10), Buffer.from([0xe2, 0x82]), Buffer.from([0xac, 0x0a])]],
      ['response-kind', [hello, `${JSON.stringify({ kind: 'response', id: 99, ok: true, result: {} })}\n`, `${JSON.stringify({ kind: 'event', name: 'x', payload: {} })}\n`]],
    ];
    for (const [name, chunks, opts] of cases) {
      c.log('companion', name);
      const reply = await send(chunks, opts);
      c.log('companion-reply', name, reply.slice(0, 300));
    }
    // Many connections at once, and connect-and-drop.
    c.log('companion', '200 connections');
    await Promise.all(Array.from({ length: 200 }, (_, i) => send(i % 2 ? [hello] : [], { wait: 300 })));
    for (let i = 0; i < 200; i++) {
      const s = connect(info.socket);
      s.on('error', () => {});
      s.on('connect', () => s.destroy());
    }
    await sleep(2_000);
    const ms = await engineAnswers(c);
    if (ms === null) c.signal('companion', 'after the companion barrage the UI did not answer');
  }

  // Imports: settings, themes, memory, with empty, wrong, huge and vanishing files.
  const dir = join(c.world.root, 'imports');
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, string | Buffer]> = [
    ['empty.json', ''],
    ['wrong.json', '{"hello": "world"}'],
    ['array.json', '[1,2,3]'],
    ['binary.json', Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))],
    ['huge.json', `{"version":1,"settings":${JSON.stringify({ blob: 'z'.repeat(60 * 1024 * 1024) })}}`],
    ['notjson.md', '# just markdown\n'],
  ];
  for (const [name, content] of files) writeFileSync(join(dir, name), content);
  for (const [cmd, title] of [
    ['import-settings', 'Import settings'],
    ['import-theme', 'Import theme'],
    ['memory-import-export', 'Memory'],
  ] as const) {
    for (const [name] of [...files, ['vanishing.json', '']] as Array<[string, string]>) {
      const path = join(dir, name);
      if (name === 'vanishing.json') writeFileSync(path, '{"x":1}');
      await c.queueOpenDialog([path]);
      c.log('import', cmd, name);
      await command(c, cmd, title);
      if (cmd === 'memory-import-export') {
        await sleep(800);
        await c.page.locator('[data-memory-import]').first().click({ timeout: 1_500 }).catch(() => {});
      }
      if (name === 'vanishing.json') rmSync(path, { force: true });
      await sleep(2_000);
      await c.page.screenshot({ path: join(c.options.outDir, `${c.tag}-import-${cmd}-${name}.png`) });
      await closeAll(c);
      await c.page.locator('[data-close-settings]').first().click({ timeout: 1_000 }).catch(() => {});
    }
  }
  // Exports (written into <root>/exports).
  for (const [cmd, title] of [['export-settings', 'Export settings'], ['export-theme', 'Export theme']] as const) {
    await command(c, cmd, title);
    await sleep(1_500);
    await closeAll(c);
  }
  await expensiveChecks(c);
};
