import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SESSION_NOTE_MAX } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { fromLocalInput, reminderPresets, reminderWhen, toLocalInput } from '../../state/reminders.ts';
import { useRemindEditor } from '../../state/remindEditorStore.ts';
import { saveNote } from '../../state/sessionNotes.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';

/**
 * Remind me later: the session leaves the main list until the time you pick, then comes back under Reminders with a
 * notification. One session can carry a note with it (its "what's left" note). Mounted once per window.
 */
export function RemindDialog() {
  const target = useRemindEditor((s) => s.target);
  if (!target) return null;
  return <RemindForm key={target.sessionIds.join(',')} sessionIds={target.sessionIds} then={target.then} />;
}

function RemindForm({ sessionIds, then }: { sessionIds: string[]; then?: () => void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const one = sessionIds.length === 1 ? sessionIds[0]! : null;
  const summary = useSessions((s) => (one ? (s.sessions.get(one) ?? null) : null));
  const [now] = useState(Date.now);
  const presets = useMemo(() => reminderPresets(now), [now]);
  const [choice, setChoice] = useState<string>(presets[0]!.id);
  const [picked, setPicked] = useState(() => toLocalInput(presets.find((p) => p.id === 'tomorrow')?.at ?? now + 60 * 60_000));
  const [note, setNote] = useState(summary?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => useRemindEditor.getState().close();
  const at = choice === 'pick' ? fromLocalInput(picked) : (presets.find((p) => p.id === choice)?.at ?? null);
  const valid = at !== null && at > Date.now();

  useEffect(() => first.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true]')?.focus(), []);

  const save = async () => {
    if (busy || !valid || at === null) return;
    if (!client) return setError('Not connected to the engine');
    setBusy(true);
    setError(null);
    try {
      await client.call('sessions.remind', { sessionIds, at });
      // The note goes with it: saving here updates the session's note.
      if (one && note.trim() !== (summary?.note ?? '')) await saveNote(client, one, note.trim() ? note : null);
      close();
      then?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      width="sm"
      title={one ? 'Remind me' : `Remind me about ${sessionIds.length} sessions`}
      subtitle={one ? 'It leaves the list until then, and comes back under Reminders.' : 'They leave the list until then, and come back under Reminders.'}
      onClose={close}
      onSubmit={() => void save()}
      data-remind-dialog
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" kbd="↵" disabled={busy || !valid} data-remind-save onClick={() => void save()}>
            {busy ? 'Setting…' : at !== null && valid ? `Remind ${reminderWhen(at, Date.now())}` : 'Remind me'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div ref={first}>
          <RadioGroup label="When" className="grid gap-1">
            {presets.map((p) => (
              <Radio key={p.id} checked={choice === p.id} onSelect={() => setChoice(p.id)} dataAttrs={{ 'data-remind-preset': p.id }}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{p.label}</span>
                  <span className="text-meta text-muted tabular-nums">{p.hint}</span>
                </span>
              </Radio>
            ))}
            <Radio checked={choice === 'pick'} onSelect={() => setChoice('pick')} dataAttrs={{ 'data-remind-preset': 'pick' }}>
              Pick a date and time…
            </Radio>
          </RadioGroup>
          {choice === 'pick' && (
            <input
              type="datetime-local"
              aria-label="Date and time"
              value={picked}
              min={toLocalInput(Date.now())}
              onChange={(e) => setPicked(e.target.value)}
              className="mt-2 h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink"
              data-remind-pick
            />
          )}
        </div>
        {one && (
          <div className="grid gap-1">
            <label htmlFor={`${id}-note`} className="text-ui text-muted">
              Note (optional)
            </label>
            <input
              id={`${id}-note`}
              value={note}
              maxLength={SESSION_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What's left: push after review…"
              className="h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink"
              data-remind-note
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-meta text-error">
            {`That didn't work: ${error}`}
          </p>
        )}
      </div>
    </Dialog>
  );
}
