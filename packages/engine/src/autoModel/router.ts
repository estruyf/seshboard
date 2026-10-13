import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AUTO_TIERS, estimateVsOpus, isAutoTier, type AutoModelPrefs, type AutoTier, type LogLevel, type RouteResult, type TokenCounts } from '@switchboard/protocol';
import type { SdkRuntime } from '../host/hostManager.ts';
import { routingSystemPrompt, routingUserMessage } from './routingRules.ts';

/** Why picking failed, as the first-turn line says it: "Auto couldn't pick a model (<reason>)". */
export const ROUTE_FAILURES = {
  timeout: "Haiku didn't answer in time",
  unusable: "Haiku's answer wasn't usable",
  failed: "Haiku couldn't be reached",
} as const;

/** The longest reason kept from Haiku's answer. */
const REASON_MAX = 200;

/**
 * The model in an allowed list closest to `tier`: itself when allowed, else the nearest step, the stronger one on a
 * tie (a request Haiku thought needs Sonnet, with only Haiku and Opus allowed, goes to Opus).
 */
export function clampTier(tier: AutoTier, allowed: readonly AutoTier[]): AutoTier | null {
  if (allowed.includes(tier)) return tier;
  const at = AUTO_TIERS.indexOf(tier);
  let best: AutoTier | null = null;
  for (const candidate of allowed) {
    if (!best) best = candidate;
    const distance = Math.abs(AUTO_TIERS.indexOf(candidate) - at);
    const bestDistance = Math.abs(AUTO_TIERS.indexOf(best) - at);
    if (distance < bestDistance || (distance === bestDistance && AUTO_TIERS.indexOf(candidate) > AUTO_TIERS.indexOf(best))) best = candidate;
  }
  return best;
}

/**
 * Reads Haiku's answer: the first JSON object in it, `{"model":"haiku|sonnet|opus","reason":"…"}`, with the model
 * clamped to `allowed`. Anything else (no JSON, another model name, no allowed models) is null: unusable.
 */
export function parseRoute(text: string, allowed: readonly AutoTier[]): { model: AutoTier; reason: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { model, reason } = raw as { model?: unknown; reason?: unknown };
  const tier = typeof model === 'string' ? model.trim().toLowerCase() : null;
  if (!isAutoTier(tier)) return null;
  const picked = clampTier(tier, allowed);
  if (!picked) return null;
  const said = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : '';
  return { model: picked, reason: (said || 'Picked from your prompt.').slice(0, REASON_MAX) };
}

/** One routing call, as kept for Usage: on the profile's usage scope, in the hour it ran. */
export interface RoutingRecord {
  id: string;
  scope: string;
  at: number;
  /** The model that did the routing, as Claude Code reported it (a Haiku id). */
  model: string;
  /** What it picked; null when it failed. */
  picked: AutoTier | null;
  tokens: TokenCounts;
}

/**
 * Routing calls are made with `persistSession: false`, so no transcript records them and the Usage scanner never
 * sees their tokens. They are kept here instead (`auto_routing`), and Usage adds them as their own row.
 */
export class RoutingStore {
  private readonly insert;
  private readonly link;
  private readonly picksOf;
  constructor(private readonly db: DatabaseSync) {
    this.insert = db.prepare(
      'INSERT OR REPLACE INTO auto_routing (id, scope, at, model, picked, session_id, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
    );
    this.link = db.prepare('UPDATE auto_routing SET session_id = ? WHERE id = ?');
    this.picksOf = db.prepare('SELECT session_id AS sessionId, picked FROM auto_routing WHERE scope = ? AND session_id IS NOT NULL AND picked IS NOT NULL');
  }

  record(entry: RoutingRecord): void {
    const { tokens } = entry;
    this.insert.run(entry.id, entry.scope, entry.at, entry.model, entry.picked, tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite);
  }

  /** The session the routing call started (it is made before the session exists). */
  attach(routeId: string, sessionId: string): void {
    this.link.run(sessionId, routeId);
  }

  /** The model Auto picked for each session in a scope. */
  picks(scope: string): Map<string, AutoTier> {
    const rows = this.picksOf.all(scope) as Array<{ sessionId: string; picked: string }>;
    return new Map(rows.flatMap((r) => (isAutoTier(r.picked) ? [[r.sessionId, r.picked] as const] : [])));
  }
}

export interface ModelRouterOptions {
  sdk: () => Promise<SdkRuntime>;
  env: (profileId: string) => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  ephemeral: { add(id: string): void; delete(id: string): void };
  /** Settings › Conversation › Auto model, as main last sent them. */
  prefs: () => AutoModelPrefs;
  /** Keeps a call's tokens for Usage, on the profile it ran on. */
  record: (profileId: string, entry: Omit<RoutingRecord, 'scope'>) => void;
  log: (level: LogLevel, message: string) => void;
  /** How long Haiku has to answer once Claude Code is ready (3 seconds). */
  answerMs?: number;
  /** How long Claude Code has to start before the answer clock runs. */
  startMs?: number;
  /** Smoke runs and screenshots: answer from this instead of calling a model; `hold` never answers. */
  stub?: (prompt: string, allowed: readonly AutoTier[]) => { model: AutoTier; reason: string } | 'hold' | null;
}

export interface RouteParams {
  profileId: string;
  prompt: string;
  imageCount: number;
}

const sum = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;
const emptyTokens = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Picks the model a new session starts on: one Haiku call on the session's profile (so it uses that plan), with
 * no tools, no settings, no memory, in the home folder, that sees only the prompt's text and how many images it
 * has. Never throws: a failure is a result, and the session starts on the default model.
 */
export class ModelRouter {
  constructor(private readonly options: ModelRouterOptions) {}

  async route(params: RouteParams): Promise<RouteResult> {
    const { allowed, lean } = this.options.prefs();
    const done = (routeId: string | null, outcome: { model: AutoTier; reason: string } | { failure: string }, tokens: number): RouteResult =>
      'failure' in outcome
        ? { ok: false, routeId, reason: outcome.failure, tokens, allowed: [...allowed] }
        : { ok: true, routeId: routeId ?? randomUUID(), model: outcome.model, reason: outcome.reason, tokens, estimateVsOpus: estimateVsOpus(outcome.model), allowed: [...allowed] };

    if (this.options.stub) {
      const answer = this.options.stub(params.prompt, allowed);
      // The smoke test's Esc check: if Esc failed to stop choosing, nothing ever starts.
      if (answer === 'hold') return new Promise<never>(() => {});
      return done(null, answer ?? { failure: ROUTE_FAILURES.unusable }, 0);
    }

    const sessionId = randomUUID();
    this.options.ephemeral.add(sessionId);
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
      const [env, claudePath, sdk] = await Promise.all([this.options.env(params.profileId), this.options.claudePath(), this.options.sdk()]);
      const message = routingUserMessage(params.prompt, params.imageCount);
      const prompt: AsyncIterable<SDKUserMessage> = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'user', message: { role: 'user', content: message }, parent_tool_use_id: null };
        },
      };
      query = sdk.query({
        prompt,
        options: {
          cwd: homedir(),
          env,
          pathToClaudeCodeExecutable: claudePath,
          sessionId,
          persistSession: false,
          model: 'haiku',
          systemPrompt: routingSystemPrompt(allowed, lean),
          // Only the prompt: no tools, no MCP servers, no settings files (and so no CLAUDE.md or memory).
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
        if (event.type === 'system' && 'subtype' in event && event.subtype === 'init') arm(this.options.answerMs ?? 3_000);
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
      if (!timedOut) this.options.log('debug', `Auto model routing failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
      query?.close();
      // Let the helper leave the live registry before we stop hiding it.
      setTimeout(() => this.options.ephemeral.delete(sessionId), 5_000).unref?.();
    }

    const parsed = text === null ? null : parseRoute(text, allowed);
    const routeId = randomUUID();
    if (sum(tokens) > 0) this.options.record(params.profileId, { id: routeId, at: Date.now(), model, picked: parsed?.model ?? null, tokens });
    if (parsed) return done(routeId, parsed, sum(tokens));
    return done(sum(tokens) > 0 ? routeId : null, { failure: timedOut ? ROUTE_FAILURES.timeout : text !== null ? ROUTE_FAILURES.unusable : ROUTE_FAILURES.failed }, sum(tokens));
  }
}

/** A prompt with this in it keeps the stubbed router choosing for good (the smoke test stops the session). */
export const SMOKE_HOLD = '[smoke: hold]';

/**
 * The smoke run's and the screenshots' router: no model is called. Long prompts or ones that ask to plan or
 * refactor go to the strongest allowed model, short questions to the cheapest, the rest to the middle.
 */
export function stubRoute(prompt: string, allowed: readonly AutoTier[]): { model: AutoTier; reason: string } | 'hold' | null {
  if (prompt.includes(SMOKE_HOLD)) return 'hold';
  const text = prompt.toLowerCase();
  const want: AutoTier = /\b(plan|refactor|design|architect|migrat)/.test(text) || prompt.length > 1_200 ? 'opus' : prompt.length < 60 && text.trim().endsWith('?') ? 'haiku' : 'sonnet';
  const model = clampTier(want, allowed);
  if (!model) return null;
  const reason = { haiku: 'A quick question with a short answer.', sonnet: 'A small, local change: one setting and the code that reads it.', opus: 'Planning work across many files.' }[model];
  return { model, reason };
}
