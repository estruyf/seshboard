import { costOf } from '@seshboard/protocol';
import type { UsageLine } from './transcriptUsage.ts';

/**
 * Token usage from other providers' session files, as `UsageLine`s for the Usage scanner. Each reader takes a whole
 * file's lines (only those with one of its markers), because what a line means depends on lines before it: Copilot's
 * totals are cumulative, Codex names a response's model in its turn. The formats are the CLIs' own: anything unexpected
 * reads as "no usage".
 */

type Loose = Record<string, unknown>;

const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const text = (v: unknown) => (typeof v === 'string' && v ? v : null);

const parse = (line: string): Loose | null => {
  try {
    return obj(JSON.parse(line));
  } catch {
    return null;
  }
};

/** What a Copilot session's file has to say about tokens: its start (the folder) and every shutdown (the totals). */
export const COPILOT_USAGE_MARKERS = ['"session.start"', '"session.shutdown"'];

/** Copilot's AI credits come in nano units: a credit is a US cent. */
const NANO_AIU_PER_USD = 1e11;

interface CopilotTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
  nanoAiu: number | null;
}

/**
 * GitHub Copilot CLI's usage, from `session-state/<id>/events.jsonl`. Copilot writes no tokens per request to disk, only
 * the session's totals per model on each `session.shutdown`, counted from the session's start. So each shutdown counts
 * what its run added (its totals less the last shutdown's), at the shutdown's time, and a session that is still running
 * counts once it ends. Copilot bills in AI credits and writes what the run cost in them (`totalNanoAiu`): that is the
 * cost (`usd`), with no price table needed. Without it (billing by premium requests), the price table prices the run's
 * tokens as they are read: a run's totals don't say which of its requests had a long prompt.
 */
export function copilotUsage(lines: readonly string[], sessionId: string): UsageLine[] {
  const found: UsageLine[] = [];
  const last = new Map<string, CopilotTotals>();
  let cwd: string | null = null;
  for (const line of lines) {
    const event = parse(line);
    if (!event) continue;
    const data = obj(event.data);
    if (event.type === 'session.start') {
      cwd = text(obj(data.context).cwd) ?? cwd;
      continue;
    }
    if (event.type !== 'session.shutdown') continue;
    const id = text(event.id);
    const at = Date.parse(String(event.timestamp ?? ''));
    if (!id || !Number.isFinite(at)) continue;
    for (const [model, metric] of Object.entries(obj(data.modelMetrics))) {
      const usage = obj(obj(metric).usage);
      const details = obj(obj(metric).tokenDetails);
      const cacheRead = count(usage.cacheReadTokens);
      const cacheWrite = count(usage.cacheWriteTokens);
      // `inputTokens` includes the cache's tokens; the details have the rest on its own, when they are there.
      const input = 'input' in details ? count(obj(details.input).tokenCount) : Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
      const nano = obj(metric).totalNanoAiu;
      const now: CopilotTotals = { input, output: count(usage.outputTokens), cacheRead, cacheWrite, requests: count(obj(obj(metric).requests).count), nanoAiu: typeof nano === 'number' && Number.isFinite(nano) ? nano : null };
      const before = last.get(model);
      last.set(model, now);
      // Totals that went down started again (a session made anew under the same id): the run is all of them.
      const fresh = !before || now.input < before.input || now.output < before.output || now.cacheRead < before.cacheRead;
      const minus = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'requests') => (fresh ? now[key] : Math.max(0, now[key] - before[key]));
      const run = { input: minus('input'), output: minus('output'), cacheRead: minus('cacheRead'), cacheWrite: minus('cacheWrite') };
      if (run.input + run.output + run.cacheRead + run.cacheWrite === 0) continue;
      const nanoAiu = now.nanoAiu === null ? null : fresh || before.nanoAiu === null ? now.nanoAiu : Math.max(0, now.nanoAiu - before.nanoAiu);
      found.push({
        key: `copilot|${id}|${model}`,
        sessionId,
        at,
        model,
        cwd,
        ...run,
        cacheWrite1h: 0,
        fast: false,
        turns: Math.max(1, minus('requests')),
        usd: nanoAiu === null ? costOf(run, model) : nanoAiu / NANO_AIU_PER_USD,
      });
    }
  }
  return found;
}

/** What a Codex rollout file has to say about tokens: the thread, each turn's model, and the tokens. */
export const CODEX_USAGE_MARKERS = ['"session_meta"', '"turn_context"', '"token_usage_record"', '"token_count"'];

/** OpenAI's counts, as Codex writes them: `input_tokens` includes the cached ones and the cache writes. */
function codexTokens(usage: Loose) {
  const cacheRead = count(usage.cached_input_tokens);
  const cacheWrite = count(usage.cache_write_input_tokens);
  return { input: Math.max(0, count(usage.input_tokens) - cacheRead - cacheWrite), output: count(usage.output_tokens), cacheRead, cacheWrite };
}

/**
 * OpenAI Codex CLI's usage, from a rollout file (`sessions/YYYY/MM/DD/rollout-*.jsonl`). Newer files have a
 * `token_usage_record` per response, with its id and turn, and the turn's `turn_context` names the model. Older ones
 * have only `token_count` events: the thread's running total and the last request's tokens, sometimes written twice,
 * so a request is known by the total it brought the thread to. A file with records reads only those.
 */
export function codexUsage(lines: readonly string[]): UsageLine[] {
  const records = lines.some((line) => line.includes('"token_usage_record"'));
  const found: UsageLine[] = [];
  const models = new Map<string, string>();
  let model: string | null = null;
  let sessionId: string | null = null;
  let cwd: string | null = null;
  for (const line of lines) {
    const event = parse(line);
    if (!event) continue;
    const payload = obj(event.payload);
    const at = Date.parse(String(event.timestamp ?? ''));
    if (event.type === 'session_meta') {
      sessionId = text(payload.id) ?? sessionId;
      cwd = text(payload.cwd) ?? cwd;
    } else if (event.type === 'turn_context') {
      model = text(payload.model) ?? model;
      const turn = text(payload.turn_id);
      if (turn && model) models.set(turn, model);
      cwd = text(payload.cwd) ?? cwd;
    } else if (event.type === 'token_usage_record' && records) {
      const response = text(payload.response_id);
      const used = models.get(text(payload.turn_id) ?? '') ?? model;
      const session = text(payload.thread_id) ?? sessionId;
      if (!response || !used || !session || !Number.isFinite(at)) continue;
      found.push({ key: `codex|${response}`, sessionId: session, at, model: used, cwd, ...codexTokens(obj(payload.usage)), cacheWrite1h: 0, fast: false });
    } else if (event.type === 'event_msg' && payload.type === 'token_count' && !records) {
      const info = obj(payload.info);
      const total = count(obj(info.total_token_usage).total_tokens);
      if (!total || !model || !sessionId || !Number.isFinite(at)) continue;
      found.push({ key: `codex|${sessionId}|${total}`, sessionId, at, model, cwd, ...codexTokens(obj(info.last_token_usage)), cacheWrite1h: 0, fast: false });
    }
  }
  return found;
}
