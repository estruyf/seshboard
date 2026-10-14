import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { CatchUpNeedKind, type LogLevel, type TokenCounts } from '@switchboard/protocol';
import type { SdkRuntime } from '../host/hostManager.ts';
import { needKind, needOf, type Summary } from './fallback.ts';
import type { Signals } from './signals.ts';
import { oneLine, type Turn } from './turn.ts';

/**
 * What Haiku is told. It sees your prompt, Claude's last reply, a list of the tool calls (tool, file or command, exit
 * code), the signals and the plan, never a file's contents, a diff or memory, and answers with one JSON object.
 */
export const SUMMARY_SYSTEM_PROMPT = `You write the catch-up card for a coding session that just finished a turn. The person is coming back to it and must decide what to do next in under 30 seconds.

You get JSON with: "ask" (what they asked for), "finalReply" (the assistant's last message), "toolCalls" (tool, file or command, exit code), "signals" (tests, diff, files outside the scope, whether there was a plan) and "plan" (the plan text, or null).

Answer with one JSON object and nothing else:
{"did": ["..."], "skipped": ["..."], "need": {"kind": "...", "title": "...", "text": "..."}, "planDeviated": false}

- "did": 1 to 5 short lines, past tense, plain words, no markdown, no file paths unless one is essential. What was done, not how.
- "skipped": 0 to 3 short lines about what was skipped, failed or left unfinished. An empty list when nothing was.
- "need": the one next step for the person.
  - "kind": "reply" when tests fail or the reply ends with a question for them; "review" when files changed outside the scope; "commit" when it finished cleanly with changes; "none" when it finished cleanly without changes.
  - "title": a few words, starting with a verb ("Commit the changes", "Answer Claude's question").
  - "text": one or two plain sentences saying why.
- "planDeviated": true only when there was a plan and the work did not follow it.

Write plain, short sentences. No em dashes. Don't start a sentence with "And" or "But".`;

/** The user message: everything Haiku may see, as JSON. Never file contents, diffs or memory. */
export function summaryInput(turn: Turn, signals: Signals): string {
  return JSON.stringify({
    ask: turn.ask,
    finalReply: oneLine(turn.finalText, 4_000),
    toolCalls: turn.tools.slice(-60).map((t) => ({
      tool: t.name,
      ...(t.command ? { command: oneLine(t.command, 200) } : t.file ? { file: t.file } : {}),
      exitCode: t.declined ? 'declined' : t.exitCode,
    })),
    signals: {
      tests: signals.tests,
      diff: signals.diff,
      filesOutsideScope: signals.outOfScope.slice(0, 20),
      hadPlan: turn.plan !== null,
    },
    plan: turn.plan === null ? null : oneLine(turn.plan, 4_000),
  });
}

const Line = z.string().trim().min(1).max(300);
/** Haiku's answer as it must be: anything else is unusable, and the fallback takes over. */
const SummaryAnswer = z.object({
  did: z.array(Line).min(1).max(5),
  skipped: z.array(Line).max(3),
  need: z.object({ kind: CatchUpNeedKind, title: Line, text: z.string().trim().min(1).max(600) }),
  planDeviated: z.boolean(),
});

/** Plain words: no list markers, emphasis or backticks, one line each. */
const plain = (line: string, max: number) => oneLine(line.replace(/^[-*•]\s+/, '').replace(/\*\*|__|`/g, '').replace(/\s+—\s+/g, ', '), max);

/**
 * Reads Haiku's answer: the first JSON object in it, checked against `SummaryAnswer`. The kind of next step follows the
 * rules (failing tests or an error need a reply, out-of-scope files a review): Haiku's own kind only counts where the
 * rules leave room, a question back to you at the end of a clean finish, and an error keeps the rules' words. Null when
 * the answer is unusable.
 */
export function parseSummary(text: string, rules: { signals: Signals; state: 'finished' | 'error'; error: string | null }): (Summary & { planDeviated: boolean }) | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = SummaryAnswer.safeParse(raw);
  if (!parsed.success) return null;
  const answer = parsed.data;
  const ruled = needKind({ state: rules.state, signals: rules.signals, asksBack: false });
  const questionBack = answer.need.kind === 'reply' && (ruled === 'commit' || ruled === 'none');
  const kind = questionBack ? 'reply' : ruled;
  // A turn that stopped with an error says so in Claude Code's own words, not Haiku's.
  const need =
    answer.need.kind === kind && rules.state !== 'error'
      ? { kind, title: plain(answer.need.title, 120), text: plain(answer.need.text, 400) }
      : needOf(kind, { signals: rules.signals, question: null, error: rules.state === 'error' ? (rules.error ?? 'The turn ended with an error.') : null });
  return {
    did: answer.did.map((line) => plain(line, 200)),
    skipped: answer.skipped.map((line) => plain(line, 200)),
    need,
    planDeviated: answer.planDeviated,
  };
}

/** One summary call, as kept for Usage: on the profile's usage scope, when it ran. */
export interface SummaryRecord {
  id: string;
  at: number;
  model: string;
  sessionId: string;
  tokens: TokenCounts;
}

export interface SummarizerOptions {
  sdk: () => Promise<SdkRuntime>;
  env: (profileId: string) => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  ephemeral: { add(id: string): void; delete(id: string): void };
  /** Keeps a call's tokens for Usage, on the profile it ran on. */
  record: (profileId: string, entry: SummaryRecord) => void;
  log: (level: LogLevel, message: string) => void;
  /** How long Haiku has to answer once Claude Code is ready (6 seconds). */
  answerMs?: number;
  /** How long Claude Code has to start before the answer clock runs. */
  startMs?: number;
  /** Smoke runs and screenshots: answer from this instead of calling a model. */
  stub?: (input: string) => string | null;
}

const emptyTokens = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const sum = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;

/**
 * Writes catch-up summaries: one Haiku call on the session's profile (so it uses that plan), with no tools, no settings,
 * no memory, in the home folder. Never throws: it returns Haiku's text, or null when there was none in time.
 */
export class Summarizer {
  constructor(private readonly options: SummarizerOptions) {}

  async ask(profileId: string, sessionId: string, input: string): Promise<string | null> {
    if (this.options.stub) return this.options.stub(input);
    const helperId = randomUUID();
    this.options.ephemeral.add(helperId);
    let query: ReturnType<SdkRuntime['query']> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        query?.close();
      }, ms);
    };
    let text: string | null = null;
    let model = 'haiku';
    const tokens = emptyTokens();
    try {
      arm(this.options.startMs ?? 10_000);
      const [env, claudePath, sdk] = await Promise.all([this.options.env(profileId), this.options.claudePath(), this.options.sdk()]);
      const prompt: AsyncIterable<SDKUserMessage> = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'user', message: { role: 'user', content: input }, parent_tool_use_id: null };
        },
      };
      query = sdk.query({
        prompt,
        options: {
          cwd: homedir(),
          env,
          pathToClaudeCodeExecutable: claudePath,
          sessionId: helperId,
          persistSession: false,
          model: 'haiku',
          systemPrompt: SUMMARY_SYSTEM_PROMPT,
          // Only what summaryInput gives it: no tools, no MCP servers, no settings files (so no CLAUDE.md or memory).
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          settingSources: [],
          maxTurns: 1,
          thinking: { type: 'disabled' },
        },
      });
      for await (const event of query) {
        // Claude Code is up: from here Haiku has its few seconds.
        if (event.type === 'system' && 'subtype' in event && event.subtype === 'init') arm(this.options.answerMs ?? 6_000);
        if (event.type === 'result') {
          if (event.subtype === 'success' && !event.is_error) text = event.result;
          for (const [id, usage] of Object.entries(event.modelUsage ?? {})) {
            model = id;
            tokens.input += usage.inputTokens;
            tokens.output += usage.outputTokens;
            tokens.cacheRead += usage.cacheReadInputTokens;
            tokens.cacheWrite += usage.cacheCreationInputTokens;
          }
          break;
        }
      }
    } catch (error) {
      if (!timedOut) this.options.log('debug', `Catch-up summary failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
      query?.close();
      // Let the helper leave the live registry before we stop hiding it.
      setTimeout(() => this.options.ephemeral.delete(helperId), 5_000).unref?.();
    }
    if (sum(tokens) > 0) this.options.record(profileId, { id: randomUUID(), at: Date.now(), model, sessionId, tokens });
    if (timedOut) this.options.log('debug', `Catch-up summary for ${sessionId}: Haiku didn't answer in time`);
    return text;
  }
}

/**
 * The smoke run's and the screenshots' summary: no model is called. It answers in the shape Haiku must, from the tool
 * list it was given, so the whole path (parsing, the rules) runs.
 */
export function stubSummary(input: string): string | null {
  const data = JSON.parse(input) as { toolCalls: Array<{ tool: string; command?: string; file?: string; exitCode: number | string | null }>; signals: { tests: Signals['tests'] } };
  const edits = data.toolCalls.filter((t) => ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(t.tool)).length;
  const did = [edits ? `Changed ${edits === 1 ? 'one file' : `${edits} files`}` : 'Looked into your question', ...data.toolCalls.filter((t) => t.command).slice(-2).map((t) => `Ran ${t.command}`)];
  return JSON.stringify({
    did: did.slice(0, 5),
    skipped: data.toolCalls.filter((t) => t.exitCode !== 0 && t.exitCode !== null && t.command).slice(0, 2).map((t) => `${t.command} failed`),
    need: { kind: edits ? 'commit' : 'none', title: edits ? 'Commit the changes' : 'Nothing to do', text: edits ? 'The work is done. Look it over, then commit.' : 'Nothing changed.' },
    planDeviated: false,
  });
}
