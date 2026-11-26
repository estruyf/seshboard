import { create } from 'zustand';
import type { ApprovalEditor } from '@seshboard/protocol/client';

/**
 * Open in editor on an approval card (docs/seshboard-tools.md): which card's draft is open in which editor. Saving
 * there answers the card with what was saved; closing it without saving denies it (`ApprovalEditorHost`).
 */
export interface ApprovalEditorRequest {
  requestId: string;
  sessionId: string;
  editor: ApprovalEditor;
  /** The card's draft: `{ root, isNew, value }`, `value` as the editor reads a saved one. */
  draft: unknown;
}

export const useApprovalEditor = create<{ open: ApprovalEditorRequest | null }>(() => ({ open: null }));

export function openApprovalEditor(request: ApprovalEditorRequest): void {
  useApprovalEditor.setState({ open: request });
}

export function closeApprovalEditor(): void {
  useApprovalEditor.setState({ open: null });
}
