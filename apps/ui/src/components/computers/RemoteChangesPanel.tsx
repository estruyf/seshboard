import { ChevronRight, FileDiff, GitCommitHorizontal, RefreshCw, X } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Computer, Contract, RemoteChangedFile, RpcClient } from '@seshboard/protocol/client';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { STATUS } from '../changes/ChangesPanel.tsx';
import { modKey } from '../../lib/shortcuts.ts';
import { DiffRows } from '../memory/DiffRows.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { callComputer } from './callComputer.ts';

/** What `changes.get` says about the session's checkout there. */
export interface RemoteChanges {
  branch: string | null;
  files: RemoteChangedFile[];
  error: string | null;
}

/**
 * Changes of a session on another computer, on the right like a local session's: what is not committed in its
 * checkout there, each file's diff under it, and Commit with a message (it never pushes). The list is read when the
 * panel opens, when Claude finishes a turn and with Refresh; nothing in it opens a file here.
 */
export function RemoteChangesPanel({
  client,
  computer,
  sessionId,
  changes,
  onRefresh,
  onCommitted,
  onClose,
  width,
  onWidth,
}: {
  client: RpcClient<Contract>;
  computer: Computer;
  sessionId: string;
  /** Null while loading. */
  changes: RemoteChanges | null;
  onRefresh(): void;
  onCommitted(): void;
  onClose(): void;
  width: number;
  onWidth(width: number): void;
}) {
  const connected = computer.state === 'connected';
  const files = changes?.files ?? [];
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const idBase = useId();

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const commit = async () => {
    if (committing || !message.trim() || !connected) return;
    setCommitting(true);
    setFailed(null);
    try {
      const result = await callComputer(client, computer.id, 'changes.commit', { sessionId, message: message.trim() });
      if (result.ok) {
        setMessage('');
        onCommitted();
      } else setFailed(result.output || 'The commit did not go through.');
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  // Drag the left edge to resize; ← → do the same from the keyboard (the width is the one Ask and a local panel share).
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = askWidthForKey(event.key, width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    onWidth(next);
  };
  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
    event.preventDefault();
    onClose();
  };

  const added = files.reduce((sum, f) => sum + f.additions, 0);
  const removed = files.reduce((sum, f) => sum + f.deletions, 0);
  return (
    <aside aria-label="Changes" tabIndex={-1} onKeyDown={onPanelKey} className="relative flex max-w-[85%] min-w-0 shrink-0 flex-col border-l border-border bg-bg outline-none" style={{ width }} data-remote-changes-panel>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Changes panel width"
        aria-valuenow={width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-link/40 focus-visible:bg-link/40"
        data-tooltip="Drag (or use ← →) to resize"
      />
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 pt-2.5 pb-2">
        <FileDiff size={16} aria-hidden className="mt-0.5 shrink-0 text-muted" />
        <div className="grid min-w-0 flex-1">
          <h2 className="truncate text-ui font-semibold text-text">Changes</h2>
          <span className="truncate text-meta text-muted" data-remote-changes-summary>
            {changes === null
              ? 'Loading…'
              : files.length
                ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · +${added} −${removed}${changes.branch ? ` · ${changes.branch}` : ''} · on ${computer.name}`
                : `Not committed on ${computer.name}`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="quiet" size="sm" iconOnly icon={<RefreshCw size={13} aria-hidden />} aria-label="Refresh" disabled={!connected} onClick={onRefresh} data-remote-changes-refresh />
          <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close" kbd="Esc" onClick={onClose} data-remote-changes-close />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {changes?.error && (
          <div className="p-3">
            <Notice tone="error">{changes.error}</Notice>
          </div>
        )}
        {changes === null ? (
          <p className="p-4 text-ui text-muted">Loading…</p>
        ) : files.length === 0 && !changes.error ? (
          <p className="p-4 text-ui text-muted">No uncommitted changes.</p>
        ) : (
          files.map((file, index) => {
            const status = STATUS[file.status];
            const slash = file.path.lastIndexOf('/');
            const isOpen = open.has(file.path);
            const diffId = `${idBase}-diff-${index}`;
            return (
              <div key={file.path} className="border-b border-border" data-remote-changed-file={file.path}>
                <button type="button" onClick={() => toggle(file.path)} aria-expanded={isOpen} aria-controls={isOpen ? diffId : undefined} className="flex h-8 w-full min-w-0 items-center gap-1.5 px-2 text-left text-ui hover:bg-border/30" data-remote-file-toggle>
                  <ChevronRight size={13} aria-hidden className={`shrink-0 text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span aria-label={status.label} className={`w-3 shrink-0 font-mono text-meta font-semibold ${status.tone}`}>
                    {status.letter}
                  </span>
                  <span className="min-w-0 flex-1 truncate" data-tooltip={file.path}>
                    <span className="text-text">{file.path.slice(slash + 1)}</span>
                    {slash > 0 && <span className="ml-1.5 text-meta text-faint">{file.path.slice(0, slash)}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-meta" aria-label={`${file.additions} added, ${file.deletions} removed`}>
                    <span className="text-ok">+{file.additions}</span> <span className="text-error">−{file.deletions}</span>
                  </span>
                </button>
                {isOpen && <RemoteFileDiff id={diffId} client={client} computerId={computer.id} sessionId={sessionId} path={file.path} version={changes} />}
              </div>
            );
          })
        )}
      </div>

      <form
        className="grid shrink-0 gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
        data-remote-commit-form
      >
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && modKey(event)) {
              event.preventDefault();
              void commit();
            }
          }}
          rows={2}
          disabled={!connected || files.length === 0}
          placeholder={files.length ? 'Commit message' : 'Nothing to commit'}
          aria-label="Commit message"
          className="field-sizing-content max-h-40 min-h-12 w-full resize-none rounded-lg border border-edge bg-card px-2.5 py-1.5 text-ui text-text outline-none placeholder:text-faint focus:border-link disabled:opacity-60"
          data-remote-commit-message
        />
        {failed && (
          <pre role="alert" className="max-h-32 overflow-auto rounded-md bg-code p-2 font-mono text-meta whitespace-pre-wrap text-error" data-remote-commit-failed>
            {failed}
          </pre>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-meta text-muted">Commits every change there. It doesn’t push.</span>
          <Button
            type="submit"
            variant="primary"
            icon={committing ? undefined : <GitCommitHorizontal size={14} aria-hidden />}
            kbd="⌘↵"
            disabled={!connected || files.length === 0 || !message.trim()}
            aria-busy={committing || undefined}
            data-remote-commit
          >
            {committing ? 'Committing…' : 'Commit'}
          </Button>
        </div>
      </form>
    </aside>
  );
}

/** One file's diff there, read when it opens and again when the list is read again (`version`). */
function RemoteFileDiff({ id, client, computerId, sessionId, path, version }: { id: string; client: RpcClient<Contract>; computerId: string; sessionId: string; path: string; version: unknown }) {
  const [state, setState] = useState<{ diff: string; truncated: boolean } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    void callComputer(client, computerId, 'changes.diff', { sessionId, path }).then(
      (result) => live && setState(result),
      (e: Error) => live && setState({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [client, computerId, sessionId, path, version]);
  return (
    <div id={id} className="overflow-x-auto bg-code py-1 font-mono text-meta" data-remote-file-diff>
      {state === null ? (
        <p className="px-3 py-1 font-sans text-muted">Loading…</p>
      ) : 'error' in state ? (
        <p className="px-3 py-1 font-sans text-error">{state.error}</p>
      ) : (
        <>
          <DiffRows diff={state.diff} />
          {state.truncated && <p className="px-3 py-1 font-sans text-faint">The rest of the diff is on that computer.</p>}
        </>
      )}
    </div>
  );
}
