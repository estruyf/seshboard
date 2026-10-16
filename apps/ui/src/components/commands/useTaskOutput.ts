import { useEffect, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';

/** How often a running command's output is read again. */
const POLL_MS = 1000;

export interface TaskOutputState {
  text: string;
  /** The whole file's size, in bytes. */
  size: number;
  /** Only the end is shown. */
  truncated: boolean;
  /** No file (yet, or any more). */
  missing: boolean;
  /** Read at least once. */
  loaded: boolean;
  error: string | null;
}

const INITIAL: TaskOutputState = { text: '', size: 0, truncated: false, missing: false, loaded: false, error: null };

/**
 * The end of a background command's output, read through the engine: every second while it runs, once more when it
 * has ended (so the last lines show), and once for a command that ended before the panel opened.
 */
export function useTaskOutput(sessionId: string, outputFile: string | null, running: boolean): TaskOutputState {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<TaskOutputState>(INITIAL);

  useEffect(() => setState(INITIAL), [outputFile]);

  useEffect(() => {
    if (!client || !outputFile) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const out = await client.call('session.taskOutput', { sessionId, outputFile });
        if (!cancelled) setState({ ...out, loaded: true, error: null });
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, loaded: true, error: (error as Error).message }));
      }
      if (!cancelled && running) timer = setTimeout(() => void read(), POLL_MS);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, sessionId, outputFile, running]);

  return state;
}
