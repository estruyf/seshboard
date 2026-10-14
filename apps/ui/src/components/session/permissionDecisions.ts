import type { PermissionDecision, PermissionRequest } from '@switchboard/protocol/client';

/** What Claude is told when you say no without saying why. */
export const DECLINED = 'The user declined this action.';

/**
 * The answers a permission or question card sends, built in one place so every way of answering (the card above the
 * message box, the catch-up's card and its banner) sends exactly the same.
 */
export const permissionDecisions = {
  allow: (): PermissionDecision => ({ behavior: 'allow' }),
  deny: (feedback = ''): PermissionDecision => ({ behavior: 'deny', message: feedback.trim() || DECLINED }),
  /** A question's answers, by question, added to the tool's input as Claude Code expects them. */
  answer: (request: Pick<PermissionRequest, 'input'>, answers: Record<string, string>): PermissionDecision => ({
    behavior: 'allow',
    updatedInput: { ...(request.input as Record<string, never>), answers },
  }),
};
