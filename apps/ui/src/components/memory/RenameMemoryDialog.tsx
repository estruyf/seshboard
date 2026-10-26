import { useId, useState, type ReactNode } from 'react';
import { slugify } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { memoryNameProblem } from './memoryUi.ts';

/** Rename…: a memory's file, its `name:` and its MEMORY.md line change together. */
export function RenameMemoryDialog({
  root,
  path,
  name,
  taken,
  children,
  linkers = [],
  onClose,
  onRenamed,
}: {
  root: string | null;
  path: string;
  name: string;
  taken: Iterable<string>;
  /** More under the field. */
  children?(next: string): ReactNode;
  /** The memories that link to it with `[[name]]`, by name: Rename offers to update those links. */
  linkers?: string[];
  onClose(): void;
  onRenamed(path: string, name: string): void | Promise<void>;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const id = useId();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updateLinks, setUpdateLinks] = useState(true);
  const others = [...taken].filter((n) => n !== name);
  const problem = value === name ? 'Type a new name.' : memoryNameProblem(value, others);

  const save = async () => {
    if (!client || problem || busy) return;
    setBusy(true);
    try {
      const result = await client.call('memory.rename', { root, path, name: value, updateLinks: updateLinks && linkers.length > 0 });
      await onRenamed(result.path, value);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Rename “${name}”`}
      subtitle="The file, its name and its line in MEMORY.md change together."
      width="sm"
      onClose={onClose}
      onSubmit={() => void save()}
      data-memory-rename-dialog
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={!!problem || busy} onClick={() => void save()} data-memory-rename-save>
            Rename
          </Button>
        </>
      }
    >
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-name`} className="sr-only">
          New name
        </label>
        <input
          id={`${id}-name`}
          value={value}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          onBlur={() => value && setValue(slugify(value))}
          className="h-7 w-full rounded-md border border-edge bg-bg px-2.5 font-mono text-ui text-text outline-none focus:border-accent-ink"
          data-memory-rename-input
        />
        {value !== name && problem && <p className="text-meta text-error">{problem}</p>}
        {children?.(value)}
        {linkers.length > 0 && (
          <div className="mt-2 grid gap-1">
            <Checkbox checked={updateLinks} onChange={setUpdateLinks} dataAttrs={{ 'data-memory-rename-links': true }}>
              <span className="text-ui">
                Also update {linkers.length} {linkers.length === 1 ? 'link' : 'links'} to it
              </span>
            </Checkbox>
            <p className="pl-5.5 text-meta text-muted">
              In {linkers.join(', ')}: only <span className="font-mono">[[{name}]]</span> changes, nothing else in them.
            </p>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
