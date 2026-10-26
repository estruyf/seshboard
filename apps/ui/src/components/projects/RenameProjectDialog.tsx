import { useEffect, useId, useRef, useState } from 'react';
import { PROJECT_NAME_MAX } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename } from '../../lib/format.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';

/**
 * Gives a project a name of your own in Seshboard. The folder keeps its name on disk; an empty
 * name, or "Use folder name", goes back to it.
 */
export function RenameProjectDialog({ root, onClose }: { root: string; onClose(): void }) {
  const project = useProjects((s) => s.projects.get(root));
  const reload = useProjects((s) => s.reload);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const folder = basename(root);
  const current = project?.name ?? folder;
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const next = value.replace(/\s+/g, ' ').trim();
  const canSave = !busy && next !== current;

  // The old name selected, so typing replaces it and an arrow key keeps it.
  useEffect(() => inputRef.current?.select(), []);

  const apply = async (name: string | null) => {
    if (!client) return setError('Not connected to the engine');
    setBusy(true);
    setError(null);
    try {
      await client.call('projects.rename', { root, name });
      reload();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const save = () => {
    if (next === current) return onClose();
    if (canSave) void apply(next || null);
  };

  return (
    <Dialog
      width="sm"
      title="Rename project"
      subtitle={<>Only Seshboard uses this name. The folder stays {folder}.</>}
      onClose={onClose}
      onSubmit={save}
      initialFocus={inputRef}
      data-rename-project-dialog
      footerStart={
        project?.nameSource === 'custom' ? (
          <Button disabled={busy} onClick={() => void apply(null)} data-rename-project-reset>
            Use folder name
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="↵" disabled={!canSave} data-rename-project-save onClick={save}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor={`${id}-name`} className="sr-only">
          Project name
        </label>
        <input
          ref={inputRef}
          id={`${id}-name`}
          value={value}
          maxLength={PROJECT_NAME_MAX}
          onChange={(e) => setValue(e.target.value)}
          placeholder={folder}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-7 w-full rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink ${error ? 'border-error' : 'border-edge'}`}
          data-rename-project-input
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
