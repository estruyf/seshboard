import type { Query } from '@anthropic-ai/claude-agent-sdk';

/**
 * The SDK's mods calls. `Query.setUiHost()` and `Query.request()` are in the SDK's code (0.3.288) but not in its types:
 * internal, so they may change without notice. Every use goes through this file, so a change in the SDK touches one place.
 */

/** Claude Code asks the app on a mod's behalf. Each answer is what Claude Code's schema for it expects. */
export interface UiHost {
  copy(request: { plugin?: string; text: string }, options: { signal: AbortSignal }): Promise<{ copied: boolean }>;
  promptRead(request: Record<string, unknown>, options: { signal: AbortSignal }): Promise<{ text: string; cursor: number }>;
  promptFill(request: { text: string; mode: 'replace' | 'append' | 'insert' }, options: { signal: AbortSignal }): Promise<{ filled: boolean }>;
  promptSuggest(request: { text: string }, options: { signal: AbortSignal }): Promise<{ shown: boolean }>;
}

/** The answers registered with `setUiHost`, as `ui_attach` lists them. */
export const UI_HOST_ANSWERS = ['ui_copy', 'ui_prompt_read', 'ui_prompt_fill', 'ui_prompt_suggest'] as const;

export interface ModsBridge {
  /** Registers (or, with null, drops) the app's answers. */
  setUiHost(host: UiHost | null): void;
  /** Sends a control request and gives back its `response`. Rejects with `ModsTimeout` after `timeoutMs`. */
  request(request: { subtype: string } & Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>>;
}

/** Claude Code didn't answer a mods request in time. */
export class ModsTimeout extends Error {
  constructor(readonly subtype: string, readonly ms: number) {
    super(`Claude Code didn't answer ${subtype} in ${Math.round(ms / 1000)}s`);
  }
}

/** Claude Code doesn't know the request: this session can't draw mods. */
export function isUnsupported(error: unknown): boolean {
  return error instanceof Error && /unsupported control request subtype/i.test(error.message);
}

interface QueryWithUi {
  setUiHost?: (host: UiHost | undefined) => void;
  request?: (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<{ response?: unknown } | undefined>;
}

/** The bridge for a query, or null when this SDK has neither call. */
export function modsBridge(query: Query): ModsBridge | null {
  const q = query as unknown as QueryWithUi;
  if (typeof q.setUiHost !== 'function' || typeof q.request !== 'function') return null;
  return {
    setUiHost: (host) => q.setUiHost!.call(query, host ?? undefined),
    request: async (request, timeoutMs) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new ModsTimeout(request.subtype, timeoutMs)), timeoutMs);
      timer.unref?.();
      try {
        const reply = await q.request!.call(query, request, { signal: abort.signal });
        const response = reply?.response;
        return response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
      } catch (error) {
        if (abort.signal.aborted) throw new ModsTimeout(request.subtype, timeoutMs);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
