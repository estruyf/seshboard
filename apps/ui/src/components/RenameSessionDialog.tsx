import { useEffect, useId, useRef, useState } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { Button } from './ui/Button.tsx';
import { Dialog } from './ui/Dialog.tsx';

const TITLE_MAX = 200;

/**
 * Gives a session a title of your own. It is stored the way Claude Code's `/rename` stores it, so the
 * CLI shows it too; the sidebar and header pick it up from the next `sessions.changed`.
 */
export function RenameSessionDialog({ sessionId, title, onClose }: { sessionId: string; title: string; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const next = value.replace(/\s+/g, ' ').trim();
  const canSave = !busy && next.length > 0 && next !== title;

  // The old title selected, so typing replaces it and an arrow key keeps it.
  useEffect(() => inputRef.current?.select(), []);

  const save = async () => {
    if (next === title) return onClose();
    if (!canSave) return;
    if (!client) return setError('Not connected to the engine');
    setBusy(true);
    setError(null);
    try {
      await client.call('session.rename', { sessionId, title: next });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      width="sm"
      title="Rename session"
      subtitle="Claude Code shows this name too."
      onClose={onClose}
      onSubmit={() => void save()}
      initialFocus={inputRef}
      data-rename-session-dialog
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="↵" disabled={!canSave} data-rename-session-save onClick={() => void save()}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={`${id}-title`} className="sr-only">
          Session name
        </label>
        <input
          ref={inputRef}
          id={`${id}-title`}
          value={value}
          maxLength={TITLE_MAX}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Session name"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`field h-7 w-full px-2.5 text-ui outline-none ${error ? 'border-error' : ''}`}
          data-rename-session-input
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="text-meta text-error">
            {`That didn't work: ${error}`}
          </p>
        )}
      </form>
    </Dialog>
  );
}
