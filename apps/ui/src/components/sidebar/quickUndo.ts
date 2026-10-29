import { toast, useToasts, type Toast } from '../../state/toastStore.ts';

// The last quick action in the sidebar, for its toast's Undo and for ⌘Z in the sidebar. One at a time, and only while
// its toast is up: what you can no longer see isn't undone by a key.

let last: { undo: () => void; toastId: number } | null = null;

/** Shows the toast for a quick action, with an Undo that takes it back; ⌘Z in the sidebar does the same until the next one. */
export function quickActionDone(message: string, undo: () => void, icon?: Toast['icon']): void {
  const entry = {
    undo: () => {
      if (last === entry) last = null;
      undo();
    },
    toastId: 0,
  };
  entry.toastId = toast(message, { icon, undo: entry.undo, undoShortcut: 'sidebar.undo', data: { 'data-quick-action-toast': true } });
  last = entry;
}

/** ⌘Z in the sidebar: undoes the last quick action and closes its toast. False when there is nothing to undo. */
export function undoLastQuickAction(): boolean {
  const entry = last;
  if (!entry || !useToasts.getState().toasts.some((t) => t.id === entry.toastId)) return false;
  entry.undo();
  useToasts.getState().dismiss(entry.toastId);
  return true;
}
