/**
 * Real OpenAI Codex through its driver, with the user's own `codex` and login (their `CODEX_HOME`, used as it is): a
 * reply, a command approved in Ask before edits, a file written in Accept edits, Plan mode and a stop. Costs a few small
 * turns on the cheapest model at low effort. Opt-in, in a throwaway git repository only:
 * SESHBOARD_LIVE_CODEX_CWD=/path/to/throwaway/repo npx vitest run codexDriver.live
 * (SESHBOARD_LIVE_CODEX_MODEL picks the model.)
 */
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PermissionRequest } from '@seshboard/protocol';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { codexHome, codexProvider } from './codexProvider.ts';

const cwd = process.env.SESHBOARD_LIVE_CODEX_CWD;

const until = async (condition: () => boolean, ms = 120_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const textOf = (messages: RawSessionMessage[]) =>
  messages
    .filter((m) => m.type === 'assistant')
    .flatMap((m) => ((m.message as { content?: Array<{ type: string; text?: string }> }).content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? ''))
    .join('\n');

describe.skipIf(!cwd)('live Codex through its driver', () => {
  it('replies, asks before a command, writes in Accept edits, plans, and stops', async () => {
    const adapter = codexProvider({ profileId: 'live', codexHome: codexHome(process.env, homedir()), userHome: homedir(), log: (level, message) => console.log(`[${level}] ${message}`) });
    const driver = adapter.driver!;
    for (const file of ['approved.txt', 'hello.txt']) rmSync(join(cwd!, file), { force: true });
    const states: string[] = [];
    const messages: RawSessionMessage[] = [];
    const permissions: Array<Omit<PermissionRequest, 'sessionId'>> = [];
    let streamed = 0;
    let session: Awaited<ReturnType<typeof driver.start>>;
    const events: DriverEvents = {
      stream: () => void streamed++,
      messages: (m) => void messages.push(...m),
      state: (state, error) => void states.push(error ? `${state}: ${error}` : state),
      permission: (request) => {
        permissions.push(request);
        session.respond(request.requestId, { behavior: 'allow' });
      },
      permissionDone: () => {},
      usage: () => {},
      model: () => {},
    };
    /** Sends a message and waits for its turn to end. */
    const turn = async (text: string) => {
      const ends = states.length;
      await session.send(text, []);
      await until(() => states.slice(ends).some((s) => s === 'idle' || s.startsWith('error')));
    };
    try {
      expect((await driver.status()).signedIn).toBe(true);
      const models = await driver.models();
      const model = process.env.SESHBOARD_LIVE_CODEX_MODEL ?? (models.find((m) => /mini|nano|luna/i.test(m.value)) ?? models.at(-1)!).value;
      session = await driver.start({ cwd: cwd!, model, effort: 'low', permissionMode: 'default' }, events);

      await turn('Reply with just the word ok.');
      expect(textOf(messages).toLowerCase()).toContain('ok');
      expect(streamed).toBeGreaterThan(0);

      // Ask before edits: the read-only sandbox, so a command that writes asks first.
      await turn('Run the shell command `touch approved.txt`, requesting approval to run it outside the sandbox (it writes a file). Then say done. Do nothing else.');
      if (!permissions.length) console.log(JSON.stringify(messages.slice(-6), null, 1), states);
      expect(permissions.length).toBeGreaterThan(0);
      expect(existsSync(join(cwd!, 'approved.txt'))).toBe(true);

      // Accept edits: a file in the folder is written without asking.
      const asked = permissions.length;
      await session.setMode('acceptEdits');
      await turn('Create a file hello.txt containing the single line: hello. Then say done.');
      expect(existsSync(join(cwd!, 'hello.txt'))).toBe(true);
      expect(permissions.length).toBe(asked);

      // Plan mode: Codex's own, in the read-only sandbox.
      await session.setMode('plan');
      await turn('Plan, in two short bullets, how you would add a LICENSE file. Do not change any files.');
      expect(existsSync(join(cwd!, 'LICENSE'))).toBe(false);

      // Stop: the turn ends as stopped.
      await session.setMode('default');
      const ends = states.length;
      await session.send('Count from 1 to 300, one number per line.', []);
      await until(() => streamed > 0);
      await session.interrupt();
      await until(() => states.slice(ends).includes('idle'));

      // Started here: Codex records Seshboard as the client.
      expect(await adapter.source.info(session.sessionId)).toMatchObject({ provider: 'codex', origin: 'app' });
      await session.close();
      expect(await adapter.inUse!(session.sessionId)).toBe(false);
    } finally {
      await driver.dispose();
      await adapter.dispose!();
    }
  }, 600_000);
});
