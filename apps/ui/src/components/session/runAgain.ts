import type { AutoTier, ImageAttachment, PermissionMode, Effort } from '@seshboard/protocol/client';
import type { DisplayItem } from '../transcript/displayItems.ts';

const ATTACHABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** What "Run again with Opus" needs from the app; the popover passes the real ones, tests fake them. */
export interface RunAgainDeps {
  /** One image of the transcript, as base64. */
  image(imageId: string): Promise<{ mediaType: string; data: string }>;
  createSession(params: {
    cwd: string;
    prompt: string;
    attachments: ImageAttachment[];
    model: AutoTier;
    permissionMode: PermissionMode;
    effort: Effort | null;
    profileId: string | null;
  }): Promise<{ sessionId: string }>;
  /** Stops the original's turn, when it is working. */
  interrupt(): void;
  /** Shows the new session. */
  open(sessionId: string): void;
  /** Puts the original in Archived, where it can be brought back. */
  archive(): void;
}

export interface RunAgainInput {
  items: readonly DisplayItem[];
  model: AutoTier;
  cwd: string | null;
  /** The original's running process, when it has one: its folder, mode, effort and profile carry over. */
  host?: { cwd: string; state: string; permissionMode: PermissionMode; effort: Effort | null; profileId: string } | null;
}

/**
 * "Run again with Opus": the session's first prompt, with its images, in a new session on `model`, in the same
 * folder, mode, effort and profile. The new session opens and the original goes to Archived (undo is Unarchive).
 * Returns the new session's id.
 */
export async function runAgain(input: RunAgainInput, deps: RunAgainDeps): Promise<string> {
  const first = input.items.find((item): item is Extract<DisplayItem, { kind: 'user' }> => item.kind === 'user' && !item.subagent);
  const cwd = input.host?.cwd ?? input.cwd;
  if (!first || !cwd) throw new Error("Couldn't find the first prompt of this session.");
  const attachments: ImageAttachment[] = [];
  for (const image of first.images) {
    const { mediaType, data } = await deps.image(image.imageId);
    const type = ATTACHABLE.find((t) => t === mediaType);
    if (type) attachments.push({ type: 'image', mediaType: type, data });
  }
  const { sessionId } = await deps.createSession({
    cwd,
    prompt: first.text,
    attachments,
    model: input.model,
    permissionMode: input.host?.permissionMode ?? 'default',
    effort: input.host?.effort ?? null,
    profileId: input.host?.profileId ?? null,
  });
  if (input.host && (input.host.state === 'running' || input.host.state === 'needs-you')) deps.interrupt();
  deps.open(sessionId);
  deps.archive();
  return sessionId;
}
