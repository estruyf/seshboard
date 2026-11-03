/**
 * Real GitHub Copilot CLI, through the SDK and the user's own `copilot` and login. Costs a small request per test. The
 * sessions it starts (and one fork, renamed "Seshboard live …") stay in Copilot's folder.
 * Opt-in, in a throwaway git repository only: SESHBOARD_LIVE_COPILOT_CWD=/path/to/throwaway/repo npx vitest run copilot.live
 * SESHBOARD_LIVE_COPILOT_MODEL picks the model (a free one keeps it at no cost).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import type { CopilotDriver } from './copilotDriver.ts';
import { copilotProvider } from './copilotProvider.ts';
import { copilotHome, copilotSessionSource, copilotSessionsDir } from './copilotSource.ts';

const cwd = process.env.SESHBOARD_LIVE_COPILOT_CWD;

describe.skipIf(!cwd)('live GitHub Copilot session', () => {
  it('is signed in with its own login, runs a turn and reads it back from disk', async () => {
    const provider = copilotProvider({ profileId: 'live', copilotHome: copilotHome(process.env, homedir()), userHome: homedir() });
    const driver = provider.driver!;
    try {
      const status = await driver.status();
      expect(status.problem).toBeNull();
      const messages: RawSessionMessage[] = [];
      const states: string[] = [];
      let idle: () => void = () => {};
      const done = new Promise<void>((resolve) => (idle = resolve));
      const session = await driver.start(
        { cwd: cwd!, model: process.env.SESHBOARD_LIVE_COPILOT_MODEL ?? null, permissionMode: 'default' },
        {
          stream: () => {},
          messages: (m) => messages.push(...m),
          state: (s) => (states.push(s), s !== 'running' && idle()),
          // Nothing to allow: the prompt needs no tools.
          permission: (r) => session.respond(r.requestId, { behavior: 'deny', message: 'Not in this test.' }),
          permissionDone: () => {},
          usage: () => {},
          model: () => {},
        },
      );
      await session.send('Reply with exactly: OK', []);
      await done;
      expect(states.at(-1)).toBe('idle');
      expect(messages.some((m) => m.type === 'assistant')).toBe(true);
      await session.close();
      const fromDisk = await provider.source.info(session.sessionId);
      expect(fromDisk).toMatchObject({ provider: 'copilot', origin: 'app', cwd });
    } finally {
      await driver.dispose();
    }
  }, 120_000);

  it('renames, reads through Copilot, previews a rewind and forks: the session actions (the same one request)', async () => {
    const home = copilotHome(process.env, homedir());
    const provider = copilotProvider({ profileId: 'live', copilotHome: home, userHome: homedir() });
    const driver = provider.driver as CopilotDriver;
    try {
      const messages: RawSessionMessage[] = [];
      let idle: () => void = () => {};
      const done = new Promise<void>((resolve) => (idle = resolve));
      const events: DriverEvents = {
        stream: () => {},
        messages: (m) => messages.push(...m),
        state: (s) => s !== 'running' && idle(),
        permission: (r) => session.respond(r.requestId, { behavior: 'deny', message: 'Not in this test.' }),
        permissionDone: () => {},
        usage: () => {},
        model: () => {},
      };
      const session = await driver.start({ cwd: cwd!, model: process.env.SESHBOARD_LIVE_COPILOT_MODEL ?? null, permissionMode: 'default' }, events);
      await session.send('Reply with exactly: OK', []);
      await done;
      const id = session.sessionId;
      const prompt = messages.find((m) => m.type === 'user')!;
      const reply = messages.findLast((m) => m.type === 'assistant')!;

      // Renamed through Copilot: its workspace.yaml says so, as the reader expects.
      await session.rename!('Seshboard live test');
      await vi.waitFor(async () => expect(await provider.source.info(id)).toMatchObject({ customTitle: 'Seshboard live test' }), { timeout: 10_000 });

      // Read through the runtime: the same messages as the file.
      const fromFile = await copilotSessionSource(copilotSessionsDir(home)).messages(id);
      expect((await driver.readEvents(id))?.length).toBeGreaterThan(0);
      expect((await provider.source.messages(id)).map((m) => m.uuid)).toEqual(fromFile.map((m) => m.uuid));
      // Open in Seshboard's own runtime only: not open elsewhere.
      expect(await provider.inUse!(id)).toBe(false);

      // Started with file-change tracking: a rewind to the prompt is possible (nothing changed in files).
      expect(await session.rewind!(prompt.uuid, true)).toMatchObject({ canRewind: true, error: null, files: [] });

      // Forked at the reply: a session of its own, with the reply in it.
      const forked = await provider.source.fork!(id, reply.uuid);
      expect(forked).not.toBe(id);
      await vi.waitFor(async () => expect((await provider.source.messages(forked)).map((m) => m.uuid)).toContain(reply.uuid), { timeout: 10_000 });
      // Renamed while it doesn't run here: resumed for it, then let go.
      await provider.source.rename!(forked, 'Seshboard live fork');
      // Its folder is known, so sending to it resumes it there.
      await vi.waitFor(async () => expect(await provider.source.info(forked)).toMatchObject({ customTitle: 'Seshboard live fork', cwd }), { timeout: 10_000 });
      expect(provider.trashPaths!(forked)).toEqual([join(copilotSessionsDir(home), forked)]);
      await session.close();
    } finally {
      await driver.dispose();
    }
  }, 180_000);
});
