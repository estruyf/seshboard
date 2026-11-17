import type { ApiRetry } from '@seshboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';

/**
 * What Claude Code's `api_retry` and model refusal `system` messages turn into. Pure, with tests (`apiRetry.test.ts`).
 */

/** The retry state from an `api_retry` message (`SDKAPIRetryMessage`), or null when it lacks the numbers. */
export function apiRetryOf(message: { attempt?: unknown; max_retries?: unknown; retry_delay_ms?: unknown; error_status?: unknown }, at: number): ApiRetry | null {
  const { attempt, max_retries: max, retry_delay_ms: delay, error_status: status } = message;
  if (typeof attempt !== 'number' || typeof max !== 'number' || typeof delay !== 'number') return null;
  return { attempt: Math.round(attempt), maxRetries: Math.round(max), delayMs: Math.max(0, delay), status: typeof status === 'number' ? Math.round(status) : null, at };
}

/** "Fable" for `claude-fable-5-1`: the model's family; the id itself when it has none. */
function family(model: string): string {
  const name = model.split(/[-_]/).find((part) => part !== 'claude' && /^[a-z]+$/i.test(part));
  return name ? name[0]!.toUpperCase() + name.slice(1) : model;
}

/**
 * The line a refusal leaves in the conversation, as a `system` message with text (the transcript shows those as a
 * notice). `model_refusal_fallback` says where the turn went; `model_refusal_no_fallback` says there was nowhere to go.
 * A fallback only a subagent or a side question used (`scope: 'local'`) is left out: the session's model didn't change.
 */
export function refusalNotice(message: { subtype?: unknown; uuid?: unknown; scope?: unknown; fallback_model?: unknown }, at: number): RawSessionMessage | null {
  let text: string;
  if (message.subtype === 'model_refusal_fallback') {
    if (message.scope === 'local' || typeof message.fallback_model !== 'string' || !message.fallback_model) return null;
    text = `Claude moved this turn to ${family(message.fallback_model)} after a refusal`;
  } else if (message.subtype === 'model_refusal_no_fallback') {
    text = 'Claude refused and no fallback model was available';
  } else return null;
  const uuid = typeof message.uuid === 'string' && message.uuid ? message.uuid : `refusal:${at}`;
  return { type: 'system', uuid, message: { content: text }, parent_tool_use_id: null, timestamp: new Date(at).toISOString() };
}
