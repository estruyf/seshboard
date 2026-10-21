import { ListEnd, Target } from 'lucide-react';
import { useRef } from 'react';
import { ordinal } from '../../state/focus.ts';
import { useFocusGate, type GateRequest } from '../../state/focusGate.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';

/** A long session title shortened for a button. */
const short = (title: string) => (title.length > 32 ? `${title.slice(0, 31)}…` : title);

function GateDialog({ request }: { request: GateRequest }) {
  const { verdict, canSaveForLater, saveLabel, resolve } = request;
  const strict = verdict.kind === 'blocked';
  const going = `${verdict.count} of ${verdict.limit}`;
  const waiting = verdict.sessions.find((s) => s.state === 'needs-you');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const laterRef = useRef<HTMLButtonElement>(null);
  // Focus starts on the safe choice: Cancel in Nudge, the queue in Strict.
  const initialFocus = strict && canSaveForLater ? laterRef : cancelRef;
  const cancel = () => resolve({ kind: 'cancel' });

  const later = canSaveForLater && (
    <Button
      ref={laterRef}
      variant={strict ? 'primary' : 'secondary'}
      icon={<ListEnd size={13} aria-hidden />}
      onClick={() => resolve({ kind: 'later' })}
      data-focus-gate-later
    >
      {saveLabel}
    </Button>
  );
  return (
    <Dialog
      role="alertdialog"
      width="sm"
      // Clicking beside it must not count as an answer.
      dismissable={false}
      icon={<Target size={18} className={strict ? 'text-warn' : 'text-accent-ink'} aria-hidden />}
      title={strict ? 'Finish one first' : `Start a ${ordinal(verdict.count + 1)} session?`}
      subtitle={
        strict
          ? `You have ${going} sessions going and your focus limit is strict. ${canSaveForLater ? (saveLabel === 'Add to queue' ? 'Open one to finish or settle it, or add this prompt to the queue.' : 'Open one to finish or settle it first, or keep this one queued.') : 'Open one to finish or settle it first.'}`
          : `You have ${going} sessions going. Starting another puts you over your focus limit.`
      }
      initialFocus={initialFocus}
      onClose={cancel}
      data-focus-gate={strict ? 'strict' : 'nudge'}
      footerStart={
        <Button ref={cancelRef} kbd="Esc" onClick={cancel} data-focus-gate-cancel>
          Cancel
        </Button>
      }
      footer={
        strict ? (
          <>
            {waiting && (
              <Button
                variant={canSaveForLater ? 'secondary' : 'primary'}
                onClick={() => resolve({ kind: 'open', sessionId: waiting.id })}
                data-tooltip={waiting.title}
                className="min-w-0"
                data-focus-gate-open={waiting.id}
              >
                <span className="truncate">Open {short(waiting.title)}</span>
              </Button>
            )}
            {later}
          </>
        ) : (
          <>
            {later}
            <Button variant="primary" onClick={() => resolve({ kind: 'start' })} data-focus-gate-start>
              Start anyway
            </Button>
          </>
        )
      }
    />
  );
}

/** The question at the focus limit, for every start path (see `passFocusGate`). Escape closes it and keeps the prompt. */
export function FocusGateDialog() {
  const request = useFocusGate((s) => s.request);
  return request ? <GateDialog request={request} /> : null;
}
