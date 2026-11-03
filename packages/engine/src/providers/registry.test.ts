import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoCopilot } from './copilot/copilotDemo.ts';
import { detectProvider, providerCatalog } from './registry.ts';

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
});
