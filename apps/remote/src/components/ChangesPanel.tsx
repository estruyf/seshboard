import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { changesSummary } from '../lib/diff.ts';
import type { ChangesState } from './ChangesSheet.tsx';
import { CommitOutput, FileDiff, FileList, useCommit, usePickedFile } from './ChangesSheet.tsx';
import type { Client } from './Connected.tsx';
import { Button } from './ui.tsx';

/** Whether Changes was open the last time, in this browser. */
const OPEN_KEY = 'switchboard-remote:changes-panel';

export function panelWasOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPanel(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage off: it opens closed next time.
  }
}

/**
 * Changes on the right of a wide window (1280px and more; below that it is the bottom sheet): the files, the diff of
 * the one picked, a commit message to start from the catch-up's title, and Ask Claude to fix… and Commit.
 */
export function ChangesPanel({ client, sessionId, changes, initialMessage, onClose, onAsk, onCommitted }: { client: Client; sessionId: string; changes: ChangesState | null; initialMessage: string; onClose: () => void; onAsk: (path: string | null) => void; onCommitted: () => void }) {
  const files = changes?.files ?? [];
  const [path, setPath] = usePickedFile(files);
  const [message, setMessage] = useState(initialMessage);
  const { busy, output, commit } = useCommit(client, sessionId, onCommitted);
  // A new catch-up brings a new title to start from, unless you already wrote your own.
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (!typed) setMessage(initialMessage);
  }, [initialMessage, typed]);

  return (
    <aside aria-label="Changes" className="flex w-[390px] shrink-0 flex-col border-l border-border bg-bg" data-remote-changes-panel>
      <header className="safe-top flex items-start gap-2 border-b border-border px-4 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-title font-semibold">Changes</h2>
          <p className="text-meta text-muted">{changes ? (files.length ? changesSummary(files) : 'Nothing changed') : 'Loading…'}</p>
        </div>
        <Button variant="quiet" size="md" aria-label="Close Changes" onClick={onClose} className="-mr-2 px-2!">
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {changes?.error && <p className="pb-2 text-ui text-error">{changes.error}</p>}
        <FileList files={files} path={path} onPick={setPath} />
        {path && <FileDiff client={client} sessionId={sessionId} path={path} />}
      </div>
      <footer className="safe-bottom flex flex-col gap-2 border-t border-border px-4 pt-3">
        <textarea
          value={message}
          onChange={(event) => {
            setTyped(true);
            setMessage(event.target.value);
          }}
          rows={2}
          aria-label="Commit message"
          placeholder="Commit message"
          disabled={files.length === 0}
          className="field max-h-40 w-full resize-none px-2.5 py-1.5 text-ui [field-sizing:content] disabled:opacity-60"
          data-remote-commit-message
        />
        <CommitOutput output={output} />
        <div className="flex gap-2">
          <Button onClick={() => onAsk(path)} disabled={!client} className="flex-1" data-remote-ask-fix>
            Ask Claude to fix…
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              void commit(message).then((done) => {
                if (!done) return;
                setTyped(false);
                setMessage('');
              })
            }
            disabled={!client || busy || files.length === 0 || !message.trim()}
            className="flex-1"
            data-remote-commit
          >
            {busy ? 'Committing…' : 'Commit'}
          </Button>
        </div>
        <p className="text-meta text-faint">It only commits; nothing is pushed.</p>
      </footer>
    </aside>
  );
}
