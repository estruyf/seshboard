import { useId, useState } from 'react';
import { slugify } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { memoryNameProblem, TYPE_CHOICES } from './memoryUi.ts';

const field = 'h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';

/**
 * New memory: a name (it becomes the file name, so it is a slug and can't be taken), a type, a one-line description
 * and the text. Saved in Claude Code's format with a line in MEMORY.md.
 */
export function NewMemoryDialog({
  root,
  profileId = null,
  where,
  taken,
  initial = {},
  onClose,
  onCreated,
}: {
  /** The project, or null for the personal folder. */
  root: string | null;
  profileId?: string | null;
  /** Where it goes, as the subtitle says it ("switchboard", "Personal"). */
  where: string;
  taken: Iterable<string>;
  initial?: { name?: string; type?: string; description?: string; body?: string };
  onClose(): void;
  onCreated(path: string): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const id = useId();
  const [name, setName] = useState(initial.name ?? '');
  const [type, setType] = useState(initial.type ?? 'project');
  const [description, setDescription] = useState(initial.description ?? '');
  const [body, setBody] = useState(initial.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = memoryNameProblem(name, taken);

  const save = async () => {
    if (!client || problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { path } = await client.call('memory.create', { root, profileId, name, type, description: description.trim(), body });
      onClose();
      onCreated(path);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New memory"
      subtitle={`In ${where}. Claude reads it like any memory it wrote itself.`}
      width="md"
      onClose={onClose}
      onSubmit={() => void save()}
      data-memory-new-dialog
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={!!problem || busy} onClick={() => void save()} data-memory-new-save>
            Save memory
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 gap-y-3">
        <label htmlFor={`${id}-name`} className="pt-1.5 text-ui text-muted">
          Name
        </label>
        <div className="grid gap-1">
          <input
            id={`${id}-name`}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            onBlur={() => name && setName(slugify(name))}
            placeholder="e.g. release-process"
            aria-invalid={!!name && !!problem}
            className={`${field} font-mono`}
            data-memory-new-name
          />
          {name && problem && <p className="text-meta text-error">{problem}</p>}
        </div>
        <span className="pt-1 text-ui text-muted">Type</span>
        <SegmentedControl mode="radio" label="Type" value={type} onChange={setType} className="justify-self-start" segments={TYPE_CHOICES.map((t) => ({ value: t, label: t, data: { 'data-memory-new-type': t } }))} />
        <label htmlFor={`${id}-description`} className="pt-1.5 text-ui text-muted">
          Description
        </label>
        <input id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value.replace(/[\r\n]+/g, ' '))} placeholder="One line Claude sees in MEMORY.md" className={field} data-memory-new-description />
        <label htmlFor={`${id}-body`} className="pt-1.5 text-ui text-muted">
          Text
        </label>
        <textarea id={`${id}-body`} value={body} onChange={(e) => setBody(e.target.value)} rows={7} spellCheck={false} className="w-full resize-y rounded-md border border-edge bg-bg p-2.5 font-mono text-ui text-text outline-none focus:border-accent-ink" data-memory-new-body />
      </div>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}
