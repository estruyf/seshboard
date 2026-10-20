import { GitPullRequest, Globe, ListEnd, Monitor, Puzzle, Smartphone, X, Users } from 'lucide-react';
import { TOAST_MS, useToasts, type Toast } from '../../state/toastStore.ts';
import { UpdateToasts } from '../updates/UpdateToasts.tsx';
import { Button } from './Button.tsx';
import { ToastFrame, useToastCountdown } from './ToastFrame.tsx';

/** One toast: it counts down while visible, pauses while the pointer is on it or the window is in the background. */
function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = () => useToasts.getState().dismiss(toast.id);
  const countdown = useToastCountdown(toast.durationMs ?? TOAST_MS, dismiss);

  const lead = (
    <>
      {toast.icon === 'queue' && <ListEnd size={14} className="shrink-0 text-muted" aria-hidden />}
      {toast.icon === 'pull-request' && <GitPullRequest size={14} className="shrink-0 text-ok" aria-hidden />}
      {toast.icon === 'phone' && <Smartphone size={14} className="shrink-0 text-ok" aria-hidden />}
      {toast.icon === 'browser' && <Globe size={14} className="shrink-0 text-ok" aria-hidden />}
      {toast.icon === 'computer' && <Monitor size={14} className="shrink-0 text-ok" aria-hidden />}
      {toast.icon === 'shared' && <Users size={14} className="shrink-0 text-link" aria-hidden />}
      {toast.dot && <span className="size-2 shrink-0 rounded-full" style={{ background: toast.dot }} aria-hidden />}
      {toast.tone === 'ok' && <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />}
    </>
  );
  const card = !!toast.body || !!toast.actions?.length;

  if (card) {
    return (
      <ToastFrame
        lead={lead}
        title={toast.message}
        body={toast.body}
        actions={toast.actions?.length ? toast.actions.map((action) => (
          <Button
            key={action.label}
            variant={action.primary ? 'primary' : action.danger ? 'danger' : 'secondary'}
            onClick={() => {
              dismiss();
              action.onSelect();
            }}
            {...action.data}
          >
            {action.label}
          </Button>
        )) : undefined}
        onDismiss={dismiss}
        data-toast
        {...countdown}
        {...toast.data}
      />
    );
  }
  return (
    <div
      role="status"
      {...countdown}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      className="pointer-events-auto flex min-h-11 w-[360px] max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-xl border overlay py-1.5 pr-1.5 pl-3.5 text-ui text-text"
      data-toast
      {...toast.data}
    >
      {lead}
      {toast.source ? (
        // A mod's toast: its name on a small line above, so it always says who wrote it.
        <span className="min-w-0 flex-1 py-0.5">
          <span className="flex items-center gap-1 text-meta text-muted" data-toast-source>
            <Puzzle size={11} className="shrink-0" aria-hidden />
            <span className="truncate">{toast.source}</span>
          </span>
          <span className="line-clamp-3 break-words">{toast.message}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{toast.message}</span>
      )}
      {toast.undo && (
        // In the link colour, like the sidebar's Select all: the one thing to do with a toast.
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            dismiss();
          }}
          className="shrink-0 rounded px-1.5 text-ui font-semibold text-link hover:underline"
          data-toast-undo
        >
          Undo
        </button>
      )}
      <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Dismiss" onClick={dismiss} className="shrink-0" />
    </div>
  );
}

/** The toasts, bottom right, newest at the bottom; news about updates sits above them until it's dealt with. */
export function ToastLayer() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="no-drag pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-2" data-toasts>
      <UpdateToasts />
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
