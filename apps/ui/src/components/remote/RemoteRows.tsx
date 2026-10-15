import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '../ui/Button.tsx';

/**
 * The rows of Settings › Remote's lists (paired devices, other computers): an icon, a name, a status line, quiet
 * actions on the right, and the inline confirm a destructive action asks first in.
 */

export function ListRow({ icon, name, status, actions, confirm, attrs }: { icon: ReactNode; name: ReactNode; status: ReactNode; actions: ReactNode; confirm?: ReactNode; attrs?: Record<`data-${string}`, string> }) {
  return (
    <li className="grid" {...attrs}>
      <div className="flex min-h-12 items-center gap-3 px-4 py-2">
        <span className="flex shrink-0 text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui">{name}</span>
          <span className="block truncate text-meta text-muted">{status}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">{actions}</span>
      </div>
      {confirm}
    </li>
  );
}

/** "Connected now" with its dot, in the ok colour. */
export function ConnectedNow() {
  return (
    <span className="inline-flex items-center gap-1.5 text-ok">
      <span aria-hidden className="size-1.5 rounded-full bg-ok" />
      Connected now
    </span>
  );
}

/** The quiet action that turns red on hover: Revoke, Remove. */
export const dangerQuiet = 'hover:text-error';

/**
 * Asks before a destructive action, in a strip under its row: the question, Cancel (focused) and the filled action.
 * Esc cancels. Focus goes back to `returnTo` (the row's button) when it closes.
 */
export function ConfirmStrip({ question, action, onConfirm, onCancel, returnTo }: { question: string; action: string; onConfirm(): void; onCancel(): void; returnTo: RefObject<HTMLButtonElement | null> }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  // Once, when it opens: the row's button is read then, and gets focus back when the strip closes.
  useEffect(() => {
    cancel.current?.focus();
    const target = returnTo.current;
    return () => target?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="flex flex-wrap items-center gap-2 border-t border-error/30 bg-error/6 px-4 py-2.5"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onCancel();
      }}
      data-confirm-strip
    >
      <p id={id} className="min-w-0 flex-1 text-ui">
        {question}
      </p>
      <Button ref={cancel} size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" variant="danger" filled onClick={onConfirm} data-confirm>
        {action}
      </Button>
    </div>
  );
}

/** A name edited in place: ↩ saves, Esc cancels. */
export function RenameField({ name, label, onSave, onCancel }: { name: string; label: string; onSave(name: string): void; onCancel(): void }) {
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const save = () => {
    const next = draft.trim();
    if (!next || next === name) return onCancel();
    onSave(next.slice(0, 60));
  };
  return (
    <input
      ref={input}
      value={draft}
      maxLength={60}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      className="h-6 w-full max-w-72 rounded-md border border-edge bg-bg px-1.5 text-ui text-text"
      data-rename-field
    />
  );
}
