import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { nextIndex } from '../lib/keys.ts';
import type { RemoteChangedFile } from '@seshboard/protocol/remote-client';
import { changesSummary, diffLines } from '../lib/diff.ts';
import type { Client } from './Connected.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toasts.tsx';
import { Button } from './ui.tsx';

const STATUS: Record<RemoteChangedFile['status'], { letter: string; tone: string; label: string }> = {
  added: { letter: 'A', tone: 'text-ok', label: 'Added' },
  untracked: { letter: 'U', tone: 'text-ok', label: 'New' },
  modified: { letter: 'M', tone: 'text-caution', label: 'Changed' },
  deleted: { letter: 'D', tone: 'text-error', label: 'Deleted' },
  renamed: { letter: 'R', tone: 'text-link', label: 'Renamed' },
  conflicted: { letter: '!', tone: 'text-error', label: 'Conflict' },
};

export interface ChangesState {
  files: RemoteChangedFile[];
  branch: string | null;
  error: string | null;
}

/**
 * What changed in the session's checkout, in a bottom sheet: the files with their line counts, the diff of the one you
 * tap under them, and Ask Claude to fix… and Commit at the bottom.
 */
export function ChangesSheet({ client, sessionId, changes, onClose, onAsk, onCommit }: { client: Client; sessionId: string; changes: ChangesState | null; onClose: () => void; onAsk: (path: string | null) => void; onCommit: () => void }) {
  const files = changes?.files ?? [];
  const [path, setPath] = usePickedFile(files);
  return (
    <Sheet
      title="Changes"
      subtitle={changes ? (files.length ? changesSummary(files) : 'Nothing changed') : 'Loading…'}
      onClose={onClose}
      tall
      hook="changes"
      footer={
        <div className="flex gap-2">
          <Button onClick={() => onAsk(path)} disabled={!client} className="flex-1" data-remote-ask-fix>
            Ask Claude to fix…
          </Button>
          <Button variant="primary" onClick={onCommit} disabled={!client || files.length === 0} className="flex-1" data-remote-commit>
            Commit
          </Button>
        </div>
      }
    >
      {changes?.error && <p className="pb-2 text-ui text-error">{changes.error}</p>}
      <FileList files={files} path={path} onPick={setPath} />
      {path && <FileDiff client={client} sessionId={sessionId} path={path} />}
    </Sheet>
  );
}

/** The file whose diff shows: the first until you pick another, and the first again when the picked one is committed. */
export function usePickedFile(files: readonly RemoteChangedFile[]): [string | null, (path: string) => void] {
  const [path, setPath] = useState<string | null>(files[0]?.path ?? null);
  useEffect(() => {
    if (!path || !files.some((f) => f.path === path)) setPath(files[0]?.path ?? null);
  }, [files, path]);
  return [path, setPath];
}

/** The changed files with their line counts, as a list you pick from with a tap, a click, or ↑ and ↓. */
export function FileList({ files, path, onPick }: { files: readonly RemoteChangedFile[]; path: string | null; onPick: (path: string) => void }) {
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const at = files.findIndex((f) => f.path === path);
  const move = (event: KeyboardEvent) => {
    const next = event.key === 'ArrowDown' ? nextIndex(at, files.length, 1) : event.key === 'ArrowUp' ? nextIndex(at, files.length, -1) : event.key === 'Home' ? 0 : event.key === 'End' ? files.length - 1 : null;
    if (next === null || next < 0) return;
    event.preventDefault();
    onPick(files[next]!.path);
    list.current?.querySelectorAll('[role=option]')[next]?.scrollIntoView({ block: 'nearest' });
  };
  if (!files.length) return null;
  return (
    <ul
      ref={list}
      role="listbox"
      aria-label="Changed files"
      tabIndex={0}
      aria-activedescendant={at >= 0 ? `${id}-${at}` : undefined}
      onKeyDown={move}
      className="-mx-1 flex flex-col rounded-lg outline-offset-0"
      data-remote-files
    >
      {files.map((file, i) => {
        const status = STATUS[file.status];
        const picked = file.path === path;
        const slash = file.path.lastIndexOf('/');
        return (
          <li
            key={file.path}
            id={`${id}-${i}`}
            role="option"
            aria-selected={picked}
            onClick={() => onPick(file.path)}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 pointer-fine:min-h-8 ${picked ? 'bg-selected' : 'hover:bg-border/45'}`}
            data-remote-file={file.path}
          >
            <span aria-label={status.label} className={`w-3 shrink-0 font-mono text-meta font-semibold ${status.tone}`}>
              {status.letter}
            </span>
            <span className="min-w-0 flex-1 truncate text-left font-mono text-ui" dir="rtl">
              <bdi>
                {slash >= 0 && <span className="text-faint">{file.path.slice(0, slash + 1)}</span>}
                {file.path.slice(slash + 1)}
              </bdi>
            </span>
            <span className="shrink-0 font-mono text-meta tabular-nums">
              <span className="text-ok">+{file.additions}</span> <span className="text-error">−{file.deletions}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One file's diff, loaded when it is picked. */
export function FileDiff({ client, sessionId, path }: { client: Client; sessionId: string; path: string }) {
  const [diff, setDiff] = useState<{ path: string; text: string; truncated: boolean } | { path: string; error: string } | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    setDiff(null);
    void client.call('changes.diff', { sessionId, path }).then(
      (result) => live && setDiff({ path, text: result.diff, truncated: result.truncated }),
      (error: Error) => live && setDiff({ path, error: error.message }),
    );
    return () => {
      live = false;
    };
  }, [client, sessionId, path]);
  return (
    <div className="mt-3">
      <h3 className="truncate pb-1 font-mono text-meta text-muted">{path}</h3>
      {!diff ? <p className="text-ui text-muted">Loading the diff…</p> : 'error' in diff ? <p className="text-ui text-error">{diff.error}</p> : <DiffView text={diff.text} truncated={diff.truncated} />}
    </div>
  );
}

/** A diff in the theme's colours: removed lines on `error`, added on `ok`, hunk headers muted. Long lines scroll here. */
export function DiffView({ text, truncated }: { text: string; truncated: boolean }) {
  const lines = diffLines(text);
  if (!lines.length) return <p className="text-ui text-muted">No changes to show.</p>;
  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-lg bg-code py-1" data-remote-diff>
      <pre className="w-max min-w-full font-mono text-meta leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`px-2.5 ${line.kind === 'add' ? 'bg-ok/10' : line.kind === 'del' ? 'bg-error/10' : line.kind === 'hunk' ? 'pt-1 text-faint' : line.kind === 'note' ? 'text-faint italic' : ''}`}
          >
            <span aria-hidden className="inline-block w-3 select-none text-faint">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
            </span>
            {line.text || ' '}
          </div>
        ))}
      </pre>
      {truncated && <p className="px-2.5 py-1 text-meta text-faint">The rest of this diff is on your computer.</p>}
    </div>
  );
}

/**
 * Commits every change from here: busy while it runs, a toast with the commit when it went through, and what git said
 * when it didn't (a hook that refused, say).
 */
export function useCommit(client: Client, sessionId: string, onCommitted: () => void) {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const commit = async (message: string): Promise<boolean> => {
    const text = message.trim();
    if (!client || !text || busy) return false;
    setBusy(true);
    setOutput(null);
    try {
      const result = await client.call('changes.commit', { sessionId, message: text });
      if (result.ok) {
        toast('Committed', { detail: `${result.sha.slice(0, 7)} · ${text.split('\n')[0]}` });
        onCommitted();
        return true;
      }
      setOutput(result.output);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "The commit didn't reach your computer.");
    } finally {
      setBusy(false);
    }
    return false;
  };
  return { busy, output, commit };
}

/** What git said when the commit didn't go through. */
export function CommitOutput({ output }: { output: string | null }) {
  if (!output) return null;
  return (
    <div className="pt-3" role="alert">
      <p className="pb-1 text-ui font-semibold text-error">git commit didn't go through</p>
      <pre className="max-h-60 overflow-auto rounded-lg bg-code p-2.5 font-mono text-meta whitespace-pre-wrap">{output}</pre>
    </div>
  );
}

/** Commit every change: the message (the catch-up's ask to start from), and what git said when it didn't work. */
export function CommitSheet({ client, sessionId, initial, files, onClose, onCommitted }: { client: Client; sessionId: string; initial: string; files: number; onClose: () => void; onCommitted: () => void }) {
  const [message, setMessage] = useState(initial);
  const { busy, output, commit } = useCommit(client, sessionId, onCommitted);
  return (
    <Sheet
      title="Commit"
      subtitle={`${files} ${files === 1 ? 'file' : 'files'}. It only commits; nothing is pushed.`}
      onClose={onClose}
      hook="commit"
      footer={
        <div className="flex gap-2">
          <Button onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void commit(message).then((done) => done && onClose())} disabled={!client || busy || !message.trim()} className="flex-1" data-remote-commit-confirm>
            {busy ? 'Committing…' : 'Commit'}
          </Button>
        </div>
      }
    >
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={3}
        aria-label="Commit message"
        placeholder="Commit message"
        className="field w-full resize-none px-3 py-2 text-body [field-sizing:content]"
        data-remote-commit-message
      />
      <CommitOutput output={output} />
    </Sheet>
  );
}
