import { joinPath, MAX_CONTEXT_ITEMS } from '@seshboard/protocol/client';
import { useDiffComments } from '../../state/diffCommentsStore.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { relativeTo } from '../composer/contextItems.ts';
import { reviewDraft } from './diffComments.ts';

/**
 * Submit in Changes (and the palette's Submit review comments): the session's comments go in its message box as one
 * item under a short prompt, and leave Changes. Nothing is sent: you read it and send it, and sending while Claude
 * works puts it in Up next like any message. False when there was nothing to submit or the box has no room.
 */
export function submitReview(sessionId: string, cwd: string | null): boolean {
  const comments = useDiffComments.getState().comments[sessionId] ?? [];
  if (comments.length === 0) return false;
  const drafts = useDrafts.getState();
  if ((drafts.drafts[sessionId]?.context?.length ?? 0) >= MAX_CONTEXT_ITEMS) {
    toast(`The message box holds up to ${MAX_CONTEXT_ITEMS} items. Remove one, then submit again.`, { tone: 'error' });
    return false;
  }
  const draft = reviewDraft(comments, (comment) => relativeTo(joinPath(comment.root, comment.path), cwd));
  drafts.addContext(sessionId, [draft.item]);
  drafts.requestQuote(sessionId, draft.text, { plain: true });
  useDiffComments.getState().clear(sessionId);
  return true;
}
