import { GitCompareArrows, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { matches } from '../../lib/shortcuts.ts';
import { useMemoryView } from '../../state/memoryStore.ts';
import { showInChanges } from '../../state/showInChanges.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';

/**
 * An instruction file (CLAUDE.md, a rule, CLAUDE.local.md, agent memory): read, and edited as plain text. ⌘S saves.
 * Nothing is staged or committed: after a change to a file the team shares, "Changed in git" points at Changes.
 */
export function InstructionEditor({ root, path, content, modified, shared }: { root: string; path: string; content: string | null; modified: number | null; shared: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content ?? '');
  const [savedAt, setSavedAt] = useState<number | null>(modified);
  const [changedInGit, setChangedInGit] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // A new read replaces the text, unless you are editing it.
  useEffect(() => {
    if (!editing && content !== null) setDraft(content);
    if (modified !== null && !editing) setSavedAt(modified);
  }, [content, modified, editing]);
  const dirty = editing && content !== null && draft !== content;
  useEffect(() => {
    useMemoryView.setState({ dirty });
  }, [dirty]);
  useEffect(() => () => useMemoryView.setState({ dirty: false }), []);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const save = async (force = false) => {
    if (!client || !dirty) return;
    try {
      const result = await client.call('memory.writeInstruction', { root, path, content: draft, expectedModified: savedAt, force });
      setSavedAt(result.modified);
      setChangedInGit(result.changedInGit);
      setEditing(false);
      setError(null);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'CHANGED') setConflict(true);
      else setError(err.message);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matches(event, 'memory.save')) return;
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (content === null) return <p className="text-ui text-muted">Reading…</p>;
  return (
    <div className="grid gap-3" data-instruction-editor={path}>
      {changedInGit && shared && (
        <Notice
          tone="info"
          icon={<GitCompareArrows size={13} aria-hidden />}
          onDismiss={() => setChangedInGit(false)}
          actions={
            <Button size="sm" onClick={() => !showInChanges(root, path) && void openIn(path).catch(() => {})} data-instruction-show-changes>
              Show in Changes
            </Button>
          }
          data-instruction-changed
        >
          Changed in git. Nothing is committed: review and commit it like any other change.
        </Notice>
      )}
      {editing ? (
        <textarea
          ref={ref}
          aria-label="File text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-80 w-full resize-y rounded-lg border border-edge bg-code p-4 font-mono text-ui text-text outline-none focus:border-accent-ink"
          data-instruction-body
        />
      ) : (
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-border bg-code p-4 font-mono text-ui break-words whitespace-pre-wrap select-text" data-memory-content onDoubleClick={() => setEditing(true)}>
            {content}
          </pre>
          <Button size="sm" icon={<Pencil size={12} aria-hidden />} onClick={() => setEditing(true)} className="absolute top-2 right-2" data-instruction-edit>
            Edit
          </Button>
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 text-meta">
          <span className={dirty ? 'text-text' : 'text-muted'}>{dirty ? 'Unsaved changes' : 'No changes'}</span>
          <Kbd shortcut="memory.save" />
          <span className="flex-1" />
          <Button size="sm" onClick={() => (setDraft(content), setEditing(false))}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void save()} data-instruction-save>
            Save
          </Button>
        </div>
      )}
      {error && (
        <Notice tone="error" onDismiss={() => setError(null)}>
          {`Couldn't save: ${error}`}
        </Notice>
      )}
      {conflict && (
        <ConfirmDialog
          title="It changed on disk"
          body="This file was saved somewhere else after you opened it. Saving replaces that version with yours."
          confirmLabel="Save mine"
          danger
          onConfirm={() => save(true)}
          onClose={() => setConflict(false)}
        />
      )}
    </div>
  );
}
