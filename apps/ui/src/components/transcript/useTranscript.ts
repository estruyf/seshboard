import { useCallback, useEffect, useState } from 'react';
import type { TranscriptMessage } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

export interface TranscriptState {
  status: 'loading' | 'ready' | 'error';
  messages: TranscriptMessage[];
  /** Why the transcript couldn't be read (status `error`). */
  error: string | null;
  /** Reads the transcript again from the start. */
  retry(): void;
}

/** Watches one session's transcript: a full load first, then live appends while the file changes. */
export function useTranscript(sessionId: string): TranscriptState {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<Omit<TranscriptState, 'retry'>>({ status: 'loading', messages: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!client) return;
    const off = client.on('transcript.updated', (update) => {
      if (update.sessionId !== sessionId) return;
      setState((prev) =>
        update.error !== undefined
          ? { status: 'error', messages: [], error: update.error }
          : { status: 'ready', error: null, messages: update.mode === 'replace' ? update.messages : [...prev.messages, ...update.messages] },
      );
    });
    void client.call('transcript.watch', { sessionId });
    return () => {
      off();
      void client.call('transcript.unwatch', { sessionId }).catch(() => {});
    };
  }, [client, sessionId, attempt]);

  // Watching again starts with a full read, so a retry is a fresh subscription.
  const retry = useCallback(() => {
    setState({ status: 'loading', messages: [], error: null });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
