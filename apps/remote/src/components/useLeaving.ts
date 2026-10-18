import { useEffect, useState } from 'react';
import type { RemotePrompt } from '@switchboard/protocol/remote-client';

/**
 * Cards that were answered fold away before they leave: they stay in the list (even once the computer dropped the
 * prompt) until their animation ends, or at once when motion is reduced.
 */
export function useLeaving<P extends RemotePrompt>(current: readonly P[]) {
  const [leaving, setLeaving] = useState<Map<string, P>>(new Map());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Forget what the computer no longer lists, so the sets stay small.
  useEffect(() => {
    const open = new Set(current.map((p) => p.requestId));
    setHidden((h) => (h.size && [...h].some((id) => !open.has(id)) ? new Set([...h].filter((id) => open.has(id))) : h));
  }, [current]);
  const gone = (id: string) => {
    setLeaving((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
    setHidden((h) => new Set(h).add(id));
  };
  return {
    isLeaving: (id: string) => leaving.has(id),
    leave: (prompt: P) => (reduced ? gone(prompt.requestId) : setLeaving((m) => new Map(m).set(prompt.requestId, prompt))),
    gone,
    merge: (shown: readonly P[]) => {
      const ids = new Set(shown.map((p) => p.requestId));
      return [...shown, ...[...leaving.values()].filter((p) => !ids.has(p.requestId))].filter((p) => !hidden.has(p.requestId)).sort((a, b) => a.createdAt - b.createdAt);
    },
  };
}
