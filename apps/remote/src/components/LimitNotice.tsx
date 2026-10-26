import { useState } from 'react';
import { Clock, Gauge, Play } from 'lucide-react';
import type { RemoteLimitStanding } from '@seshboard/protocol/remote-client';
import { heldLine, limitHeadline, limitHolds, resumeLine } from '../lib/limit.ts';
import type { Client } from './Connected.tsx';
import { Button } from './ui.tsx';

/**
 * Above the message box of a session whose Claude profile is at a plan usage limit, as on the computer: which limit,
 * when it resets and a countdown. A session the limit stopped offers Resume now and Resume when it resets
 * (`limits.resume`, `limits.arm`) and says how many queued messages wait for it; another session of the profile only
 * says the limit holds. Nothing shows while Claude works, and an older computer (no `limits` feature) never sends one.
 */
export function LimitNotice({ client, sessionId, limit, held, busy, now }: {
  client: NonNullable<Client>;
  sessionId: string;
  limit: RemoteLimitStanding | null;
  /** Messages in Up next, which wait for the limit. */
  held: number;
  busy: boolean;
  now: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!limit || busy || !limitHolds(limit, now)) return null;
  const headline = limitHeadline(limit, now);

  if (!limit.stopped) {
    return (
      <div className="px-3 pt-2 sm:px-6" data-remote-limit="profile">
        <p className="mx-auto flex w-full max-w-3xl items-center gap-1.5 px-1 text-meta text-muted">
          <Gauge className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
          {headline}
        </p>
      </div>
    );
  }

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    setPending(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
    } finally {
      setPending(false);
    }
  };
  const heldText = heldLine(held);
  const detail = [heldText, limit.gaveUp ? 'It couldn’t resume by itself after the reset.' : null].filter(Boolean).join(' · ');

  return (
    <div className="px-3 pt-2 sm:px-6" data-remote-limit="stopped">
      <div role="status" className="mx-auto grid w-full max-w-3xl gap-2 rounded-lg border border-accent-ink/40 bg-accent/10 px-3 py-2">
        <div className="flex items-start gap-2">
          <Gauge className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
          <div className="grid min-w-0 gap-0.5">
            <span className="text-ui font-medium">{headline}</span>
            {detail && <span className="text-meta text-muted">{detail}</span>}
            {error && <span role="alert" className="text-meta text-error">{error}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="md" disabled={pending} onClick={() => void run(() => client.call('limits.resume', { sessionId }))} data-remote-limit-resume>
            <Play className="size-3" fill="currentColor" aria-hidden />
            Resume now
          </Button>
          {limit.resumeAt !== null ? (
            <span className="flex items-center gap-2 text-meta text-muted" data-remote-limit-resumes>
              <Clock className="size-3.5" aria-hidden />
              {resumeLine(limit.resumeAt, now)}
              <Button size="md" disabled={pending} onClick={() => void run(() => client.call('limits.arm', { sessionId, armed: false }))} data-remote-limit-cancel>
                Cancel
              </Button>
            </span>
          ) : (
            limit.resetsAt !== null && (
              <Button size="md" disabled={pending} onClick={() => void run(() => client.call('limits.arm', { sessionId, armed: true }))} data-remote-limit-arm>
                Resume when it resets
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
