import { useEffect, useId, useRef, useState } from 'react';
import { SESSION_NOTE_MAX } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useNoteEditor } from '../../state/noteEditorStore.ts';
import { saveNote } from '../../state/sessionNotes.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';


/**
 * What's left in a session, in your words: one line under its title in the sidebar ("push after review"). Mounted
 * once per window; N on a row or in catch-up, Note… in a menu and the palette open it (`useNoteEditor`).
 */
export function SessionNoteDialog() {
  const sessionId = useNoteEditor((s) => s.sessionId);
  const summary = useSessions((s) => (sessionId ? (s.sessions.get(sessionId) ?? null) : null));
  if (!sessionId || !summary) return null;
  return <NoteForm key={sessionId} sessionId={sessionId} title={summary.title} note={summary.note ?? ''} />;
}

function NoteForm({ sessionId, title, note }: { sessionId: string; title: string; note: string }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [value, setValue] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const close = () => useNoteEditor.getState().close();

  // The note there now selected, so typing replaces it.
  useEffect(() => inputRef.current?.select(), []);

  const save = async (text: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveNote(client, sessionId, text);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      width="sm"
      title="Note"
      subtitle={`What's left in “${title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title}”. It shows under its title.`}
      onClose={close}
      onSubmit={() => void save(value)}
      initialFocus={inputRef}
      data-session-note-dialog
      footerStart={
        note ? (
          <Button onClick={() => void save(null)} disabled={busy} data-session-note-clear>
            Clear
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" kbd="↵" disabled={busy} data-session-note-save onClick={() => void save(value)}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
      >
        <label htmlFor={`${id}-note`} className="sr-only">
          Note
        </label>
        <input
          ref={inputRef}
          id={`${id}-note`}
          value={value}
          maxLength={SESSION_NOTE_MAX}
          onChange={(e) => setValue(e.target.value)}
          placeholder="push after review, waiting on Jan…"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-7 w-full rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink ${error ? 'border-error' : 'border-edge'}`}
          data-session-note-input
        />
        <p className="text-meta text-muted">
          {value.length} / {SESSION_NOTE_MAX}. Empty clears it.
        </p>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-meta text-error">
            {`That didn't work: ${error}`}
          </p>
        )}
      </form>
    </Dialog>
  );
}
