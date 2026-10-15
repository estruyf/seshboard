import { useEffect, useState } from 'react';
import type { FolderEntry } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

/** How long typing has to pause before the engine lists a folder. */
const DEBOUNCE_MS = 100;

export interface FolderSuggestions {
  /** The folder these results are for, as typed (`~/dev/`); rows from an earlier folder are never shown. */
  dir: string | null;
  /** The start of a name these results are for. */
  prefix: string;
  here: FolderEntry | null;
  folders: FolderEntry[];
}

const EMPTY: FolderSuggestions = { dir: null, prefix: '', here: null, folders: [] };

/**
 * The folders in `dir` that start with `prefix`, from the engine (`fs.folders`), 100ms after typing stops.
 * Null `dir` (not typing a path) clears them. The answer keeps the folder it was for, so the caller can tell
 * a stale answer from a fresh one.
 */
export function useFolderSuggestions(dir: string | null, prefix: string): FolderSuggestions {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [result, setResult] = useState<FolderSuggestions>(EMPTY);

  useEffect(() => {
    if (!dir || !client) {
      setResult(EMPTY);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      client.call('fs.folders', { path: dir, prefix }).then(
        ({ here, folders }) => !cancelled && setResult({ dir, prefix, here, folders }),
        () => !cancelled && setResult({ dir, prefix, here: null, folders: [] }),
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, dir, prefix]);

  return result;
}
