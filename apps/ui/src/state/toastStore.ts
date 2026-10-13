import { create } from 'zustand';

/** A button on a toast: the one thing to do about it ("Start it"), or a second choice ("Review first"). */
export interface ToastAction {
  label: string;
  /** The yellow fill; one per toast at most. */
  primary?: boolean;
  onSelect(): void;
  /** Test hooks. */
  data?: Record<`data-${string}`, string | boolean>;
}

/**
 * A toast in the window's corner that goes away by itself: one line with an optional Undo, or (with `body` or
 * `actions`) a small card with a title, a sentence and its buttons. #14 (toasts everywhere) can grow this further.
 */
export interface Toast {
  id: number;
  /** The line, or the card's title. */
  message: string;
  /** A small icon before the message: added to the queue, a pull request created. */
  icon?: 'queue' | 'pull-request';
  /** A coloured dot before the message instead (a theme's accent); a validated colour value. */
  dot?: string;
  /** A status dot in a theme colour: `ok` for something that became free. */
  tone?: 'ok';
  /** The card's sentence under the title. */
  body?: string;
  /** A one-click way back, for about five seconds. */
  undo?: () => void;
  actions?: ToastAction[];
  /** How long it stays while visible; `TOAST_MS` when left out. */
  durationMs?: number;
  /** Test hooks on the toast itself. */
  data?: Record<`data-${string}`, string | boolean>;
}

/** How long a toast stays while visible (the timer pauses on hover and while the window is in the background). */
export const TOAST_MS = 5_000;

interface ToastState {
  toasts: Toast[];
  show(toast: Omit<Toast, 'id'>): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  show: (toast) => {
    const id = nextId++;
    // Newest last; three at most, so a burst of quick actions doesn't fill the window.
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-3) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Shows a toast; returns its id. */
export const toast = (message: string, options: Omit<Toast, 'id' | 'message'> = {}) => useToasts.getState().show({ message, ...options });
