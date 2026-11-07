import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoCopilot } from './copilot/copilotDemo.ts';
import { fakeAppServer } from './codex/codexFakes.ts';
import { appStateFake } from '../system/testing.ts';
import { createProviderUpdater, detectProvider, providerCatalog } from './registry.ts';
import { sessionJsonl } from './gemini/geminiFixtures.ts';
import { fakeAcpConnection } from './acp/acpFakes.ts';

const home = () => realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-detect-')));
const shellEnv = async () => ({});

describe('detecting a provider without a profile', () => {
  it("finds Copilot CLI, its own folder's sessions and who it is signed in as", async () => {
    const userHome = home();
    const copilotHome = join(userHome, '.copilot');
    for (const id of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
      mkdirSync(join(copilotHome, 'session-state', id), { recursive: true });
      writeFileSync(join(copilotHome, 'session-state', id, 'events.jsonl'), '');
    }
    const options = { env: { COPILOT_HOME: copilotHome }, home: userHome, shellEnv, copilot: demoCopilot() };
    const [info] = providerCatalog(options);
    expect(await detectProvider(info!, options)).toEqual({ id: 'copilot', installed: true, version: '1.0.4', folder: copilotHome, folderExists: true, sessions: 2, signedIn: true, login: 'demo-user' });
  });

  it('says when its CLI is missing, without starting anything', async () => {
    const userHome = home();
    let started = false;
    const options = {
      env: {},
      home: userHome,
      shellEnv,
      copilot: { binary: async () => null, createClient: async () => ((started = true), demoCopilot().createClient({ cliPath: '', env: {} })) as never },
    };
    const [info] = providerCatalog(options);
    expect(await detectProvider(info!, options)).toMatchObject({ installed: false, version: null, folder: join(userHome, '.copilot'), folderExists: false, sessions: 0, signedIn: false, login: null });
    expect(started).toBe(false);
  });

  it("finds Codex CLI without a driver: its rollout files and who it is signed in as, then stops its app-server", async () => {
    const userHome = home();
    const codexHome = join(userHome, '.codex');
    const day = join(codexHome, 'sessions', '2026', '11', '06');
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, 'rollout-2026-11-06T10-00-00-019a0000-0000-7000-8000-00000000000a.jsonl'), '');
    writeFileSync(join(day, 'rollout-2026-11-06T11-00-00-019a0000-0000-7000-8000-00000000000b.jsonl.zst'), '');
    const server = fakeAppServer({ 'account/read': () => ({ account: { type: 'chatgpt', email: 'me@example.com', planType: 'plus', workspaceName: null }, requiresOpenaiAuth: true }) });
    const options = { env: { CODEX_HOME: codexHome }, home: userHome, shellEnv, codex: { binary: async () => ({ path: '/fake/codex', version: '0.167.0' }), createAppServer: () => server } };
    const info = providerCatalog(options).find((p) => p.id === 'codex');
    expect(await detectProvider(info!, options)).toEqual({ id: 'codex', installed: true, version: '0.167.0', folder: codexHome, folderExists: true, sessions: 2, signedIn: true, login: 'me@example.com' });
    expect(server.disposed).toBe(1);
  });
});

describe('detecting Gemini CLI', () => {
  it('finds its sessions and who it is signed in as from its own files, without starting it', async () => {
    const userHome = home();
    const gemini = join(userHome, '.gemini');
    const chats = join(gemini, 'tmp', 'repo', 'chats');
    mkdirSync(chats, { recursive: true });
    writeFileSync(join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl'), sessionJsonl());
    writeFileSync(join(gemini, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
    writeFileSync(join(gemini, 'google_accounts.json'), JSON.stringify({ active: 'me@example.com', old: [] }));
    const agent = fakeAcpConnection();
    const options = { env: {}, home: userHome, shellEnv, gemini: { binary: async () => ({ path: '/fake/gemini', version: '0.67.0' }), createConnection: () => agent.connection } };
    const info = providerCatalog(options).find((p) => p.id === 'gemini')!;
    expect(info).toMatchObject({ name: 'Google Gemini', defaultFolder: gemini, resumeCommand: 'gemini --resume {sessionId}', canStart: true, supports: ['delete', 'worktree', 'branch', 'later', 'schedule', 'trigger'] });
    expect(await detectProvider(info, options)).toEqual({ id: 'gemini', installed: true, version: '0.67.0', folder: gemini, folderExists: true, sessions: 1, signedIn: true, login: 'me@example.com' });
    // Nothing was asked of its ACP agent, so no `gemini --acp` started; it is stopped with the throwaway adapter.
    expect(agent.requests).toEqual([]);
    expect(agent.disposed()).toBe(1);
  });

  it('is signed out without a way to sign in in its settings or a login of Google’s', async () => {
    const userHome = home();
    const options = { env: {}, home: userHome, shellEnv, gemini: { binary: async () => ({ path: '/fake/gemini', version: '0.67.0' }) } };
    const info = providerCatalog(options).find((p) => p.id === 'gemini')!;
    expect(await detectProvider(info, options)).toMatchObject({ installed: true, signedIn: false, login: null, folderExists: false, sessions: 0 });
  });
});

describe('update checks of providers', () => {
  const deps = { store: appStateFake(), ready: Promise.resolve(), onChange: () => {}, log: () => {} };

  it("checks Copilot CLI and Codex CLI, each with its own CLI's answer", async () => {
    const userHome = home();
    const copilot = createProviderUpdater('copilot', { env: {}, home: userHome, shellEnv, copilot: demoCopilot() }, deps);
    const codex = createProviderUpdater('codex', { env: {}, home: userHome, shellEnv, codex: { binary: async () => ({ path: join(userHome, '.local', 'bin', 'codex'), version: '0.167.0' }), latestVersion: async () => '0.168.0' } }, deps);
    expect(copilot?.state).toMatchObject({ provider: 'copilot' });
    await codex!.check();
    expect(codex!.state).toMatchObject({ provider: 'codex', name: 'Codex CLI', status: 'available', installedVersion: '0.167.0', latestVersion: '0.168.0', command: 'codex update' });
    copilot?.close();
    codex!.close();
  });

  it("checks Gemini CLI against npm's latest, updating it with npm", async () => {
    const userHome = home();
    const pkg = join(userHome, 'npm', 'lib', 'node_modules', '@google', 'gemini-cli', 'bundle');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'gemini.js'), '');
    const gemini = createProviderUpdater('gemini', { env: {}, home: userHome, shellEnv, gemini: { binary: async () => ({ path: join(pkg, 'gemini.js'), version: '0.66.0' }), latestVersion: async () => '0.67.0' } }, deps);
    await gemini!.check();
    expect(gemini!.state).toMatchObject({ provider: 'gemini', name: 'Gemini CLI', status: 'available', installedVersion: '0.66.0', latestVersion: '0.67.0', command: 'npm install -g @google/gemini-cli@latest' });
    gemini!.close();
  });
});
