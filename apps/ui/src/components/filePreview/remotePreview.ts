import { createContext } from 'react';

/** A session on a paired computer whose files open here, through that computer (`files.read`, `files.image`). */
export interface RemoteFileSession {
  computerId: string;
  sessionId: string;
}

/**
 * Set around the conversation of a session on a computer that reads its session's files (`REMOTE_FEATURE_FILES`), and
 * around a preview of one of its files: paths in it open that computer's file in the preview. Null elsewhere.
 */
export const RemoteFileContext = createContext<RemoteFileSession | null>(null);
