import type { SessionHostInfo } from '@switchboard/protocol/client';
import type { NewSessionStart } from '../newSession/startSession.ts';

/**
 * How to start again a session whose Claude Code stopped before it wrote a transcript (it failed at once: not
 * logged in, a folder it couldn't start in). There is nothing on disk to resume, and the engine only knows a
 * session's folder from its transcript or the live registry, so a message sent to it can't go anywhere. It
 * starts a new session instead: in the same folder, with the same profile, model, effort and mode.
 *
 * Null when the message goes to the session as usual: it runs here, it has a transcript, or another
 * Claude Code window has it open (the registry knows its folder then).
 */
export function restartAsNew(
  host: SessionHostInfo | undefined,
  { hasTranscript, openElsewhere }: { hasTranscript: boolean; openElsewhere: boolean },
): Omit<NewSessionStart, 'prompt' | 'attachments'> | null {
  if (!host || (host.state !== 'error' && host.state !== 'closed') || hasTranscript || openElsewhere) return null;
  return {
    cwd: host.cwd,
    choices: { model: host.model ?? '', permissionMode: host.permissionMode, effort: host.effort ?? '', workspace: 'current', baseRef: 'fresh', branch: '' },
    worktree: false,
    currentBranch: null,
    profileId: host.profileId,
  };
}
