import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CloneProgress } from '@switchboard/protocol';
import type { AppStateStore, JsonValue } from '../db/appState.ts';
import { git } from '../git/gitChanges.ts';
import { CloneService } from './cloneService.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const memoryState = (): AppStateStore => {
  const values = new Map<string, JsonValue>();
  return { get: (key) => values.get(key) ?? null, set: (key, value) => void values.set(key, value) };
};

/** A gh that records what it was asked, is signed in or not, and clones from the local source (or hangs). */
const FAKE_GH = `
const { spawnSync } = require('node:child_process');
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, args.join(' ') + '\\n');
if (args[0] === 'auth') process.exit(process.env.FAKE_GH_SIGNED_IN === '1' ? 0 : 1);
if (args[0] === 'repo' && args[1] === 'clone') {
  const [, , repo, target, , ...gitArgs] = args;
  if (process.env.FAKE_GH_HANG === '1') {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'partial'), '');
    setInterval(() => {}, 1000);
  } else {
    const result = spawnSync('git', ['clone', ...gitArgs, join(process.env.FAKE_SOURCE, repo + '.git'), target], { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
}
`;

async function setup(options: { signedIn?: boolean; hang?: boolean; source?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-clones-')));
  dirs.push(root);
  // The "GitHub" side: a repository with project settings, as a bare repository at <source>/acme/payments.git.
  const work = join(root, 'work');
  mkdirSync(join(work, '.claude'), { recursive: true });
  await git(work, ['init', '-q', '-b', 'main']);
  writeFileSync(join(work, 'README.md'), '# Payments\n');
  writeFileSync(join(work, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: './setup.sh' }] }] } }));
  await git(work, ['add', '.']);
  await git(work, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'first']);
  await git(work, ['branch', 'release']);
  const source = join(root, 'source');
  mkdirSync(join(source, 'acme'), { recursive: true });
  await git(root, ['clone', '-q', '--bare', work, join(source, 'acme', 'payments.git')]);

  const ghLog = join(root, 'gh.log');
  writeFileSync(ghLog, '');
  const ghScript = join(root, 'gh.cjs');
  writeFileSync(ghScript, FAKE_GH);
  const folder = join(root, 'Developer');
  const added: string[] = [];
  const events: CloneProgress[] = [];
  const settings: unknown[] = [];
  const service = new CloneService({
    appState: memoryState(),
    home: root,
    env: async () => ({ FAKE_GH_LOG: ghLog, FAKE_SOURCE: source, FAKE_GH_SIGNED_IN: options.signedIn ? '1' : '0', FAKE_GH_HANG: options.hang ? '1' : '0' }),
    gh: { file: process.execPath, args: [ghScript] },
    ...(options.source === false ? {} : { source }),
    addProject: (path) => void added.push(path),
    isProject: (path) => added.includes(path),
    progress: (event) => void events.push(event),
    settingsChanged: (next) => void settings.push(next),
    log: () => {},
  });
  const ended = (jobId: string) => until(() => events.some((e) => e.jobId === jobId && e.state !== 'running')).then(() => events.filter((e) => e.jobId === jobId).at(-1)!);
  const ghCalls = () => readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean);
  return { root, folder, service, added, events, settings, ended, ghCalls };
}

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Clone from GitHub', () => {
  it('is off until it is turned on with a folder, and refuses to clone while off', async () => {
    const { service, folder, settings } = await setup();
    expect(service.settings()).toEqual({ enabled: false, folder: null });
    expect(() => service.setSettings({ enabled: true })).toThrow(/folder/);
    expect(await service.plan('https://github.com/acme/payments')).toMatchObject({ state: 'off', name: 'payments' });
    await expect(service.start('j1', 'https://github.com/acme/payments', 'payments')).rejects.toMatchObject({ code: 'CLONE_OFF' });

    expect(service.setSettings({ folder })).toEqual({ enabled: false, folder });
    expect(service.setSettings({ enabled: true })).toEqual({ enabled: true, folder });
    expect(settings).toHaveLength(2);
    expect(() => service.setSettings({ folder: 'relative/path' })).toThrow();
  });

  it('says where a clone goes, and refuses URLs that are not GitHub repositories', async () => {
    const { service, folder } = await setup();
    service.setSettings({ enabled: true, folder });
    expect(await service.plan('https://github.com/acme/payments/tree/release')).toEqual({
      state: 'free',
      repo: { owner: 'acme', name: 'payments', branch: 'release' },
      name: 'payments',
      where: '~/Developer/payments',
    });
    expect(await service.plan('acme/payments', 'pay')).toMatchObject({ name: 'pay', where: '~/Developer/pay' });
    await expect(service.plan('https://gitlab.com/acme/payments')).rejects.toMatchObject({ code: 'INVALID', message: 'Only GitHub repositories can be cloned here.' });
    await expect(service.plan('acme/payments', '../escape')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('clones into the folder (making it), adds the project, and says what the repository brings', async () => {
    const { service, folder, added, events, ended } = await setup();
    service.setSettings({ enabled: true, folder });
    await service.start('j1', 'https://github.com/acme/payments/tree/release', 'payments');
    const done = await ended('j1');
    const target = join(folder, 'payments');
    expect(events[0]).toMatchObject({ jobId: 'j1', state: 'running', phase: 'starting', percent: 0 });
    expect(done).toMatchObject({ state: 'done', root: target, reused: false, percent: 100, brings: { hooks: [{ event: 'SessionStart', command: './setup.sh' }] } });
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('# Payments\n');
    expect((await git(target, ['branch', '--show-current'])).trim()).toBe('release');
    expect((await git(target, ['remote', 'get-url', 'origin'])).trim()).toBe('https://github.com/acme/payments.git');
    expect(added).toEqual([target]);

    // Cloned already: used as it is, and as one of your projects now, nothing to ask about.
    expect(await service.plan('git@github.com:acme/payments.git')).toMatchObject({ state: 'cloned', where: '~/Developer/payments' });
    await service.start('j2', 'acme/payments', 'payments');
    expect(await ended('j2')).toMatchObject({ state: 'done', root: target, reused: true, brings: null });
    expect(added).toEqual([target]);
  });

  it('asks for another name when something else has it', async () => {
    const { service, folder } = await setup();
    service.setSettings({ enabled: true, folder });
    mkdirSync(join(folder, 'payments'), { recursive: true });
    writeFileSync(join(folder, 'payments', 'notes.txt'), 'mine');
    expect(await service.plan('acme/payments')).toMatchObject({ state: 'taken' });
    await expect(service.start('j1', 'acme/payments', 'payments')).rejects.toMatchObject({ code: 'CLONE_TAKEN', message: '~/Developer/payments already exists. Choose another name.' });
    expect(readFileSync(join(folder, 'payments', 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('fails with a reason for a branch that does not exist, and leaves no folder', async () => {
    const { service, folder, ended, added } = await setup();
    service.setSettings({ enabled: true, folder });
    await service.start('j1', 'https://github.com/acme/payments/tree/nope', 'payments');
    expect(await ended('j1')).toMatchObject({ state: 'failed', error: 'acme/payments has no branch nope.' });
    expect(existsSync(join(folder, 'payments'))).toBe(false);
    expect(added).toEqual([]);
  });

  it('clones with gh when it is signed in (cloneCommand covers git without it)', async () => {
    const signedIn = await setup({ signedIn: true, source: false });
    signedIn.service.setSettings({ enabled: true, folder: signedIn.folder });
    await signedIn.service.start('j1', 'acme/payments', 'payments');
    expect(await signedIn.ended('j1')).toMatchObject({ state: 'done' });
    expect(signedIn.ghCalls()).toEqual(['auth status --hostname=github.com', `repo clone acme/payments ${join(signedIn.folder, 'payments')} -- --progress`]);

  });

  it('Cancel stops the clone and removes the folder it made', async () => {
    const { service, folder, ended } = await setup({ signedIn: true, hang: true, source: false });
    service.setSettings({ enabled: true, folder });
    await service.start('j1', 'acme/payments', 'payments');
    await until(() => existsSync(join(folder, 'payments', 'partial')));
    // A second clone into the same folder waits for this one.
    await expect(service.start('j2', 'acme/payments', 'payments')).rejects.toMatchObject({ code: 'BUSY' });
    service.cancel('j1');
    expect(await ended('j1')).toMatchObject({ state: 'cancelled' });
    expect(existsSync(join(folder, 'payments'))).toBe(false);
    expect(existsSync(folder)).toBe(true);
  });
});
