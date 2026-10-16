import { useEffect, useSyncExternalStore } from 'react';

/**
 * Short news that isn't next to anything on screen (AGENTS.md, Context menus and confirmations): an answer that went
 * through, a commit, "Already answered", an Undo after a swipe. Above the bottom bar, gone after four seconds (six
 * with an Undo, so there is time to reach it).
 */
export interface Toast {
  id: number;
  text: string;
  detail?: string | undefined;
  tone: 'neutral' | 'error';
  /** A button on the toast: Undo. */
  action?: { label: string; run: () => void } | undefined;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function toast(text: string, options: { detail?: string | undefined; tone?: Toast['tone']; action?: Toast['action'] } = {}): void {
  toasts = [...toasts.slice(-2), { id: nextId++, text, detail: options.detail, tone: options.tone ?? 'neutral', action: options.action }];
  changed();
}

function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  changed();
}

const subscribe = (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener));

export function Toasts() {
  const shown = useSyncExternalStore(subscribe, () => toasts);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50 flex flex-col items-center gap-2 px-4 pointer-fine:right-4 pointer-fine:bottom-4 pointer-fine:left-auto pointer-fine:items-end">
      {shown.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastView({ toast: t }: { toast: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.action ? 6_000 : 4_000);
    return () => clearTimeout(timer);
  }, [t.id, t.action]);
  const text = (
    <>
      <span className={`block truncate text-ui font-semibold ${t.tone === 'error' ? 'text-error' : 'text-text'}`}>{t.text}</span>
      {t.detail && <span className="block truncate text-meta text-muted">{t.detail}</span>}
    </>
  );
  if (!t.action) {
    return (
      <button type="button" onClick={() => dismiss(t.id)} className="toast-in overlay pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-left" data-remote-toast>
        {text}
      </button>
    );
  }
  const { label, run } = t.action;
  return (
    <div className="toast-in overlay pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-4" data-remote-toast>
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={() => {
          dismiss(t.id);
          run();
        }}
        className="min-h-11 shrink-0 rounded-lg px-3 text-ui font-semibold text-link hover:bg-border/45 pointer-fine:min-h-7"
        data-remote-toast-action
      >
        {label}
      </button>
    </div>
  );
}
