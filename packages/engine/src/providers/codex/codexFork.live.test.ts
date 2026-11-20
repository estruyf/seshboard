/**
 * Real OpenAI Codex: fork from a message, Edit and resend, and Ask about this session, with the user's own `codex` and
 * login (their `CODEX_HOME`, used as it is). Costs a few small turns on the cheapest model at low effort. Opt-in, in a
 * throwaway git repository only: SESHBOARD_LIVE_CODEX_CWD=/path/to/throwaway/repo npx vitest run codexFork.live
 * (SESHBOARD_LIVE_CODEX_MODEL picks the model.)
 */
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { createAppServer } from './appServer.ts';
import { codexRolloutsOf } from './codexFiles.ts';
import { codexHome, codexProvider } from './codexProvider.ts';
import type { CodexSessionSource } from './codexSource.ts';

const cwd = process.env.SESHBOARD_LIVE_CODEX_CWD;

const until = async (condition: () => boolean, ms = 120_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const textOf = (message: RawSessionMessage | undefined) =>
  ((message?.message as { content?: Array<{ type: string; text?: string }> } | undefined)?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');

describe.skipIf(!cwd)('live Codex fork and Ask', () => {
  it('forks from a message, edits and resends, and answers a question without a trace', async () => {
    const home = codexHome(process.env, homedir());
    /** Tokens per thread, from Codex's own count (the last total each thread reported). */
    const tokens = new Map<string, number>();
    const adapter = codexProvider({
      profileId: 'live',
      codexHome: home,
      userHome: homedir(),
      createAppServer: (options) => {
        const server = createAppServer(options);
        server.onNotification(({ method, params }) => {
          const p = params as { threadId?: string; tokenUsage?: { total?: { totalTokens?: number } } };
          if (method === 'thread/tokenUsage/updated' && p.threadId && p.tokenUsage?.total?.totalTokens) tokens.set(p.threadId, p.tokenUsage.total.totalTokens);
        });
        return server;
      },
    });
    const driver = adapter.driver!;
    const source = adapter.source as CodexSessionSource;
    const states: string[] = [];
    const events: DriverEvents = {
      stream: () => {},
      messages: () => {},
      state: (state) => void states.push(state),
      permission: () => {},
      permissionDone: () => {},
      usage: () => {},
      model: () => {},
    };
    const turn = async (session: { send(text: string, attachments: []): Promise<string> }, text: string) => {
      const ends = states.length;
      await session.send(text, []);
      await until(() => states.slice(ends).some((s) => s === 'idle' || s === 'error'));
    };
    try {
      const models = await driver.models();
      const model = process.env.SESHBOARD_LIVE_CODEX_MODEL ?? (models.find((m) => /mini|nano|luna/i.test(m.value)) ?? models.at(-1)!).value;
      const session = await driver.start({ cwd: cwd!, model, effort: 'low', permissionMode: 'default' }, events);
      await turn(session, 'Reply with just the word one.');
      await turn(session, 'Reply with just the word two.');
      await session.close();
      const original = session.sessionId;
      const messages = await adapter.source.messages(original);
      const prompts = messages.filter((m) => m.type === 'user' && textOf(m).includes('Reply with'));
      const replies = messages.filter((m) => m.type === 'assistant' && textOf(m).trim());
      expect(prompts).toHaveLength(2);

      // Fork at the first reply: its turn, not the second.
      const forked = await adapter.source.fork!(original, replies[0]!.uuid);
      expect(forked).not.toBe(original);
      expect((await source.turns(forked)).length).toBe(1);
      expect(await adapter.source.info(forked)).toMatchObject({ provider: 'codex', origin: 'app' });
      const listed = await adapter.source.list();
      // Codex's own list leaves out a fork without a turn of its own; Seshboard lists the one it made.
      expect(listed.find((s) => s.sessionId === forked)).toMatchObject({ summary: 'Reply with just the word one.' });

      // Edit and resend: a fork at the message before the second prompt, then the new prompt in it.
      const index = messages.indexOf(prompts[1]!);
      const edited = await adapter.source.fork!(original, messages[index - 1]!.uuid);
      expect((await source.turns(edited)).length).toBe(1);
      const resent = await driver.start({ cwd: cwd!, model, effort: 'low', permissionMode: 'default', resume: edited }, events);
      await turn(resent, 'Reply with just the word three.');
      await resent.close();
      const relisted = await adapter.source.list();
      const editedThread = await source.thread(edited);
      console.log('after a turn: listed', relisted.some((s) => s.sessionId === edited), 'preview', JSON.stringify(editedThread?.preview), 'model', editedThread?.model);
      const after = await adapter.source.messages(edited);
      expect(after.some((m) => m.type === 'assistant' && /three/i.test(textOf(m)))).toBe(true);
      expect(after.some((m) => /two/i.test(textOf(m)))).toBe(false);

      // Ask about the original: a throwaway fork that leaves nothing behind.
      let forkId = '';
      let streamed = '';
      const asked = await driver.ask!({ sessionId: original, cwd: cwd!, model, prompt: 'Which word did you reply with first? Answer with that word only.', onText: (t) => void ('delta' in t ? (streamed += t.delta) : (streamed = '')), onFork: (id) => (forkId = id) });
      console.log('ask', asked, 'streamed', JSON.stringify(streamed));
      expect(asked.error).toBeUndefined();
      expect(asked.answer?.toLowerCase()).toContain('one');
      expect(forkId).not.toBe('');
      expect(codexRolloutsOf(home, forkId)).toEqual([]);
      expect((await adapter.source.list()).some((s) => s.sessionId === forkId)).toBe(false);
      // The original is as it was.
      expect((await source.turns(original)).length).toBe(2);
      console.log('tokens per thread', Object.fromEntries(tokens), 'total', [...tokens.values()].reduce((a, b) => a + b, 0));
    } finally {
      await driver.dispose();
      await adapter.dispose!();
    }
  }, 600_000);
});
