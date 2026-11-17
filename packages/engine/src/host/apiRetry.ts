import { modelName, type ApiRetry } from '@seshboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';

/**
 * What Claude Code's `api_retry` and model refusal `system` messages turn into. Pure, with tests (`apiRetry.test.ts`).
 */

/** The retry state from an `api_retry` message (`SDKAPIRetryMessage`), or null when it lacks the numbers. */
export function apiRetryOf(
  message: { attempt?: unknown; max_retries?: unknown; retry_delay_ms?: unknown; error_status?: unknown; no_response?: unknown },
  at: number,
): ApiRetry | null {
  const { attempt, max_retries: max, retry_delay_ms: delay, error_status: status } = message;
  if (typeof attempt !== 'number' || typeof max !== 'number' || typeof delay !== 'number') return null;
  return {
    attempt: Math.round(attempt),
    maxRetries: Math.round(max),
    delayMs: Math.max(0, delay),
    status: typeof status === 'number' ? Math.round(status) : null,
    at,
    // The API sent nothing within the first-byte window: its own, much smaller, retry budget.
    ...(message.no_response && typeof message.no_response === 'object' ? { noResponse: true } : {}),
  };
}

/** What a refusal changes: the line for the conversation, the model the session now runs, the messages it retracts. */
export type Refusal = { notice: RawSessionMessage; model: string | null; retracted: string[] };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/**
 * Claude Code's `model_refusal_fallback` and `model_refusal_no_fallback` messages as the session shows them. The line is
 * a `system` message with text (the transcript shows those as a notice). A fallback on the main thread stays for the
 * rest of the session (`scope: 'session'`, or none from older Claude Code), so the line says the session switched and
 * `model` is what it runs now. One a subagent or side question used (`scope: 'local'`) changes nothing for the session
 * and leaves no line. `retracted` are the refused messages Claude Code took back. A `model_refusal_no_fallback` has
 * nothing that says which thread refused, so it always shows.
 */
export function refusalOf(
  message: { subtype?: unknown; uuid?: unknown; scope?: unknown; direction?: unknown; fallback_model?: unknown; retracted_message_uuids?: unknown },
  at: number,
): Refusal | null {
  let text: string;
  let model: string | null = null;
  if (message.subtype === 'model_refusal_fallback') {
    // `revert` and `sticky` are kept in the SDK's enum for compatibility but no longer sent.
    if (message.scope === 'local' || (message.direction !== undefined && message.direction !== 'retry')) return null;
    if (typeof message.fallback_model !== 'string' || !message.fallback_model) return null;
    model = message.fallback_model;
    text = `Claude switched this session to ${modelName(model)} after a refusal`;
  } else if (message.subtype === 'model_refusal_no_fallback') {
    text = 'Claude refused and no fallback model was available';
  } else return null;
  const uuid = typeof message.uuid === 'string' && message.uuid ? message.uuid : `refusal:${at}`;
  const notice: RawSessionMessage = { type: 'system', uuid, message: { content: text }, parent_tool_use_id: null, timestamp: new Date(at).toISOString() };
  return { notice, model, retracted: strings(message.retracted_message_uuids) };
}

/** The messages an assistant message replaces after a refusal (`supersedes`): Claude Code's replacement for the refused leg. */
export const supersededBy = (message: { supersedes?: unknown }): string[] => strings(message.supersedes);
