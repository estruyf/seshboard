import { useState } from 'react';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';

/**
 * Write a commit message and commit. What is staged is committed; with nothing staged, every change
 * is. ⌘↵ commits, Esc cancels. `onCommit` rejects with git's message, which the dialog shows.
 */
export function CommitDialog({ branch, files, onCommit, onClose }: { branch: string | null; files: number; onCommit(message: string): Promise<void>; onClose(): void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCommit(message.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      width="sm"
      title={
        <>
          Commit {files === 1 ? '1 file' : `${files} files`}
          {branch && <span className="font-normal text-muted"> on {branch}</span>}
        </>
      }
      subtitle="Commits what is staged, or every change when nothing is. Git runs in a terminal tab so you see the hooks’ output."
      onClose={onClose}
      onSubmit={() => void commit()}
      data-commit-dialog
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" data-confirm disabled={busy || !message.trim()} onClick={() => void commit()} kbd={busy ? undefined : '⌘↵'}>
            {busy ? 'Committing…' : 'Commit'}
          </Button>
        </>
      }
    >
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        autoFocus
        rows={4}
        spellCheck
        placeholder="Commit message"
        aria-label="Commit message"
        data-commit-message
        className="field block w-full resize-none px-2.5 py-2 text-body outline-none placeholder:text-faint"
      />
      {error && (
        <p role="alert" className="mt-2 text-ui break-words whitespace-pre-wrap text-error">
          That didn’t work: {error}
        </p>
      )}
    </Dialog>
  );
}
