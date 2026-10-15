import type { PermissionDecision, RemotePrompt } from '@switchboard/protocol/remote-client';
import type { Client } from './Connected.tsx';
import { toast } from './Toasts.tsx';

/**
 * Answers a prompt and says how it went in a toast: Allowed or Denied, "Already answered" when another device (or the
 * computer) was first, or why it failed. `gone` means the prompt is no longer open, so the list should refresh.
 */
export async function answer(client: NonNullable<Client>, prompt: RemotePrompt, decision: PermissionDecision, sessionTitle: string | undefined): Promise<'done' | 'gone' | 'failed'> {
  try {
    await client.call('session.respond', { requestId: prompt.requestId, decision });
    toast(decision.behavior === 'allow' ? 'Allowed' : 'Denied', { detail: sessionTitle });
    return 'done';
  } catch (error) {
    if ((error as { code?: string }).code === 'NOT_FOUND') {
      toast('Already answered', { detail: sessionTitle });
      return 'gone';
    }
    toast(error instanceof Error ? error.message : "The answer didn't reach your computer.", { tone: 'error' });
    return 'failed';
  }
}
