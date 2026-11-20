import { createContext } from 'react';

/**
 * Opens a path in Claude's text as a file of the session (`FileSheet`). Set by the session view when the computer reads
 * its sessions' files (`REMOTE_FEATURE_FILES`); null elsewhere, where a path stays text.
 */
export const FileOpenerContext = createContext<((path: string) => void) | null>(null);
