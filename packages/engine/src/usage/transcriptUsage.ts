import { cacheTtlOf, type CacheTtl } from '@seshboard/protocol';
import { oneLine, promptText } from '../catchUp/turn.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';

/**
 * Token usage from Claude Code's transcript lines. Only `assistant` lines carry a `message.usage`; Claude Code writes
 * one line per content block of a message and repeats the whole message's usage on each, so callers count a message
 * once by its `key`. The format is Claude Code's own: anything unexpected reads as "no usage".
 */

/** One API response's tokens, as one transcript line reports them. */
export interface UsageLine {
  /** `message.id` + `requestId` (whichever exist; the line's uuid without either). The same response has the same key in every file. */
  key: string;
  /** The session the line belongs to. Subagent transcripts carry their parent's id, so their tokens count for it. */
  sessionId: string;
  at: number;
  model: string;
  cwd: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** The part of `cacheWrite` that went to the hour-long prompt cache, which costs more (`costEstimate.ts`). */
  cacheWrite1h: number;
  fast: boolean;
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const text = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** The marker every line with usage has; lines without it (tool results can be megabytes) are never parsed. */
export const USAGE_MARKER = '"usage"';

/** The tokens of an API response, as an assistant message's `usage` reports them. */
export interface UsageCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  fast: boolean;
  /** Which prompt cache it wrote to (null: it wrote nothing, or the transcript doesn't say). */
  cacheTtl: CacheTtl | null;
}

/**
 * Reads an assistant message's `usage` (the transcript line's `message`), or null when it has none or Claude Code
 * wrote the message itself (`<synthetic>`: API errors, local notices), which used no tokens. Shared by the Usage
 * scanner and the conversation, so a turn's tokens add up the way the Usage view counts them.
 */
export function usageCounts(message: { model?: unknown; usage?: Record<string, unknown> | null } | null | undefined): UsageCounts | null {
  const usage = message?.usage;
  if (!message || !usage || typeof usage !== 'object') return null;
  if (message.model === '<synthetic>') return null;
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    fast: usage.speed === 'fast',
    cacheTtl: cacheTtlOf(usage),
  };
}

/** Reads a transcript line's usage, or null when it has none (another type, a `<synthetic>` message, bad JSON). */
export function parseUsageLine(line: string): UsageLine | null {
  if (!line.includes(USAGE_MARKER)) return null;
  let json: {
    type?: unknown;
    timestamp?: unknown;
    sessionId?: unknown;
    requestId?: unknown;
    uuid?: unknown;
    cwd?: unknown;
    message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> | null } | null;
  };
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (json?.type !== 'assistant') return null;
  const message = json.message;
  const counts = usageCounts(message);
  const model = text(message?.model);
  if (!message || !counts || !model) return null;
  const sessionId = text(json.sessionId);
  const at = Date.parse(String(json.timestamp ?? ''));
  if (!sessionId || !Number.isFinite(at)) return null;
  const id = text(message.id);
  const requestId = text(json.requestId);
  const key = id || requestId ? `${id ?? ''}|${requestId ?? ''}` : text(json.uuid);
  if (!key) return null;
  return {
    key,
    sessionId,
    at,
    model,
    cwd: text(json.cwd),
    ...counts,
    cacheWrite1h: Math.min(counts.cacheWrite, count((message.usage?.cache_creation as { ephemeral_1h_input_tokens?: unknown } | null | undefined)?.ephemeral_1h_input_tokens)),
  };
}

/** One prompt of yours, as a transcript line has it: Activity's turns. */
export interface PromptLine {
  /** Its time and first words: a fork copies a transcript's lines, and the prompt still counts once. */
  key: string;
  sessionId: string;
  at: number;
  cwd: string | null;
  /** Shortened to one line. */
  text: string;
}

/** What every prompt's line has; `PROMPT_NOT` is on tool results (they can be megabytes), so those are never parsed. */
export const PROMPT_MARKER = '"type":"user"';
export const PROMPT_NOT = '"tool_use_id"';
/** Commands that do nothing in the conversation: they aren't turns. */
const NOT_A_TURN = /^\/(clear|compact|context|cost|exit|help|login|logout|model|resume|status|usage)(\s|$)/;
const PROMPT_TEXT_MAX = 240;

/** Reads a transcript line as a prompt of yours, or null: another type, a subagent's, Claude Code's own, bad JSON. */
export function parsePromptLine(line: string): PromptLine | null {
  let json: RawSessionMessage & { timestamp?: unknown; sessionId?: unknown; cwd?: unknown; isSidechain?: unknown; isMeta?: unknown };
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (json?.type !== 'user' || json.isSidechain === true || json.isMeta === true) return null;
  const sessionId = text(json.sessionId);
  const at = Date.parse(String(json.timestamp ?? ''));
  if (!sessionId || !Number.isFinite(at)) return null;
  // The transcript's line has no `parent_tool_use_id` (the SDK adds it): being in the main chain says the same.
  const prompt = promptText({ ...json, parent_tool_use_id: null });
  if (!prompt || NOT_A_TURN.test(prompt)) return null;
  const short = oneLine(prompt, PROMPT_TEXT_MAX);
  return { key: `${at}|${short.slice(0, 80)}`, sessionId, at, cwd: text(json.cwd), text: short };
}

/** The start of the UTC hour a moment falls in: the bucket session totals are kept in. */
export const hourOf = (at: number) => Math.floor(at / 3_600_000) * 3_600_000;
