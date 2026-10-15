import { useState } from 'react';
import type { RemoteLink } from '@switchboard/protocol/remote-client';
import { pairPhone } from '../lib/connection.ts';
import type { Paired } from '../lib/link.ts';
import { Button, Logo } from './ui.tsx';

/** A guess at a name for the device; it can be changed before pairing. */
function suggestedName(): string {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return 'iPhone';
  // iPadOS Safari says it's a Mac; only the touch screen gives it away.
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(agent)) return 'Android phone';
  if (/Macintosh/.test(agent)) return 'Mac browser';
  if (/Windows/.test(agent)) return 'Windows browser';
  return 'Phone';
}

type Step = { kind: 'name' } | { kind: 'waiting'; code: string | null } | { kind: 'failed'; message: string };

/**
 * Pairing on the phone: a name, then the 6 digits to compare with the computer while it asks "Pair <name>?". The device
 * is only stored once Allow is clicked there.
 */
export function PairScreen({ link, replaces, onPaired }: { link: Extract<RemoteLink, { kind: 'pair' }>; replaces: boolean; onPaired: (paired: Paired) => void }) {
  const [name, setName] = useState(suggestedName);
  const [step, setStep] = useState<Step>({ kind: 'name' });

  const pair = async () => {
    setStep({ kind: 'waiting', code: null });
    try {
      onPaired(await pairPhone(link, name.trim() || suggestedName(), (code) => setStep({ kind: 'waiting', code })));
    } catch (error) {
      const message = (error as { code?: string }).code === 'DENIED' ? 'Pairing was not allowed on your computer.' : error instanceof Error ? error.message : 'Pairing failed.';
      setStep({ kind: 'failed', message });
    }
  };

  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-full max-w-md flex-col justify-center gap-5 px-6">
      <Logo />
      <h1 className="text-hero font-semibold">Pair with your computer</h1>
      {step.kind === 'name' && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void pair();
          }}
        >
          {replaces && <p className="rounded-lg bg-warn/10 p-3 text-ui text-text">This device is paired with another computer. Pairing here replaces it.</p>}
          <label className="flex flex-col gap-1.5">
            <span className="text-ui text-muted">Name this device</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              autoComplete="off"
              enterKeyHint="go"
              className="field min-h-11 px-3 text-body pointer-fine:min-h-8"
            />
          </label>
          <p className="text-ui text-muted">Your computer will ask you to allow it, with a code to compare.</p>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Pair
          </Button>
        </form>
      )}
      {step.kind === 'waiting' && (
        <div className="flex flex-col gap-4" aria-live="polite">
          {step.code ? (
            <>
              <p className="text-body text-muted">Check that your computer shows this code, then click Allow there.</p>
              <p className="text-center font-mono text-[40px] font-semibold tracking-[0.2em] tabular-nums">{step.code}</p>
            </>
          ) : (
            <p className="text-body text-muted">Connecting to your computer…</p>
          )}
        </div>
      )}
      {step.kind === 'failed' && (
        <div className="flex flex-col gap-4" role="alert">
          <p className="text-body text-error">{step.message}</p>
          <p className="text-ui text-muted">Click Pair a phone on your computer and scan the new QR code, or open its copied link.</p>
        </div>
      )}
    </main>
  );
}
