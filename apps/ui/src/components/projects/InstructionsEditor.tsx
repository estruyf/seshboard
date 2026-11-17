import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { useFlash } from '../ui/useFlash.ts';

/**
 * A project's free text, saved with its settings (the orchestrator's instructions, plan mode's): a textarea with Save,
 * Discard and a count. `hook` names the `data-*` attributes (`data-<hook>`, `-input`, `-save`, `-discard`) the smoke
 * steps find it by.
 */
export function InstructionsEditor({
  instructions,
  onSave,
  max,
  label,
  placeholder,
  savedNote,
  hook,
  rows = 6,
}: {
  instructions: string;
  onSave(instructions: string): Promise<void>;
  max: number;
  /** The textarea's accessible name. */
  label: string;
  placeholder: string;
  /** Said after a save, for when the text takes effect. */
  savedNote: string;
  hook: string;
  rows?: number;
}) {
  const [value, setValue] = useState(instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flashSaved] = useFlash();
  // Another window, or a restore, changed what is saved: show it, unless something was typed here that isn't saved yet.
  const shown = useRef(instructions);
  useEffect(() => {
    const before = shown.current;
    shown.current = instructions;
    setValue((typed) => (typed.trim() === before.trim() ? instructions : typed));
  }, [instructions]);
  const changed = value.trim() !== instructions.trim();
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(value.trim());
      flashSaved(savedNote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const hooks = (suffix = '') => ({ [`data-${hook}${suffix}`]: true });
  return (
    <div className="grid w-full min-w-0 gap-2" {...hooks()}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        aria-label={label}
        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-border bg-bg px-2.5 py-2 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink/60"
        {...hooks('-input')}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !changed} aria-busy={busy || undefined} onClick={() => void save()} {...hooks('-save')}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {changed && !busy && (
          <Button size="sm" variant="quiet" onClick={() => setValue(instructions)} {...hooks('-discard')}>
            Discard
          </Button>
        )}
        {saved && (
          <Notice tone="success" inline>
            {saved}
          </Notice>
        )}
        <span className="ml-auto text-meta text-muted tabular-nums">
          {value.length.toLocaleString()} of {max.toLocaleString()}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-meta text-error">
          Couldn't save the instructions: {error}
        </p>
      )}
    </div>
  );
}
