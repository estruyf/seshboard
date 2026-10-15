import { useEffect, useSyncExternalStore } from 'react';

/**
 * Short news that isn't next to anything on screen (AGENTS.md, Context menus and confirmations): an answer that went
 * through, a commit, "Already answered". Above the bottom bar, gone after four seconds.
 */
export interface Toast {
  id: number;
  text: string;
  detail?: string | undefined;
  tone: 'neutral' | 'error';
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function toast(text: string, options: { detail?: string | undefined; tone?: Toast['tone'] } = {}): void {
  toasts = [...toasts.slice(-2), { id: nextId++, text, detail: options.detail, tone: options.tone ?? 'neutral' }];
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
    const timer = setTimeout(() => dismiss(t.id), 4_000);
    return () => clearTimeout(timer);
  }, [t.id]);
  return (
    <button type="button" onClick={() => dismiss(t.id)} className="toast-in overlay pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-left" data-remote-toast>
      <span className={`block text-ui font-semibold ${t.tone === 'error' ? 'text-error' : 'text-text'}`}>{t.text}</span>
      {t.detail && <span className="block truncate text-meta text-muted">{t.detail}</span>}
    </button>
  );
}
