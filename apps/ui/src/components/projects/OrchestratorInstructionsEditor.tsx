import { useEffect, useState } from 'react';
import { MAX_ORCHESTRATOR_INSTRUCTIONS } from '@seshboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { useFlash } from '../ui/useFlash.ts';

/**
 * A project's instructions for its orchestrator (docs/orchestrator.md): what the orchestrator and every session it
 * starts read after the agent's own system prompt. Saved with the project's settings; sessions started from then on
 * get the new text.
 */
export function OrchestratorInstructionsEditor({ instructions, onSave }: { instructions: string; onSave(instructions: string): Promise<void> }) {
  const [value, setValue] = useState(instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flashSaved] = useFlash();
  // Another window, or a restore, changed them: show what is saved unless something was typed here.
  useEffect(() => setValue(instructions), [instructions]);
  const changed = value.trim() !== instructions.trim();
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(value.trim());
      flashSaved('Saved. Sessions started from now on read them.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid w-full min-w-0 gap-2" data-orchestrator-instructions>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        maxLength={MAX_ORCHESTRATOR_INSTRUCTIONS}
        placeholder={'Branch from dev and open one draft pull request per session.\nRun the tests before you call work done.\nAsk me before you change CI.'}
        aria-label="Orchestrator instructions"
        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-border bg-bg px-2.5 py-2 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink/60"
        data-orchestrator-instructions-input
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !changed} aria-busy={busy || undefined} onClick={() => void save()} data-orchestrator-instructions-save>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {changed && !busy && (
          <Button size="sm" variant="quiet" onClick={() => setValue(instructions)} data-orchestrator-instructions-discard>
            Discard
          </Button>
        )}
        {saved && (
          <Notice tone="success" inline>
            {saved}
          </Notice>
        )}
        <span className="ml-auto text-meta text-muted tabular-nums">
          {value.length.toLocaleString()} of {MAX_ORCHESTRATOR_INSTRUCTIONS.toLocaleString()}
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
