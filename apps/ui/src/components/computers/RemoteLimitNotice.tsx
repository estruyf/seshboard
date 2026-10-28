import { useState } from 'react';
import { Clock, Gauge, Play } from 'lucide-react';
import { REMOTE_FEATURE_LIMITS, type Computer, type Contract, type RemoteLimitStanding, type RpcClient } from '@seshboard/protocol/client';
import { heldLine, limitHeadline, resumeLine } from '../../lib/usageLimit.ts';
import { useMinute } from '../focus/useMinute.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { callComputer } from './callComputer.ts';

/**
 * Above the message box of a session on another computer whose Claude profile is at a plan usage limit, as the notice
 * of a local session (`UsageLimitNotice`): which limit, when it resets and a countdown, with Resume now and Resume when
 * it resets for a session the limit stopped, which that computer carries out (`limits.resume`, `limits.arm`). Nothing
 * shows while Claude works there, or for a computer that doesn't send limits (an older Seshboard).
 */
export function RemoteLimitNotice({ client, computer, sessionId, limit, held, busy }: {
  client: RpcClient<Contract>;
  computer: Computer;
  sessionId: string;
  limit: RemoteLimitStanding | null;
  /** Messages in its Up next, which wait for the limit. */
  held: number;
  busy: boolean;
}) {
  const now = useMinute(limit !== null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!limit || busy || !computer.features.includes(REMOTE_FEATURE_LIMITS)) return null;
  if (limit.resetsAt !== null && limit.resetsAt <= now) return null;
  const headline = limitHeadline(limit, now);

  // Another session of the profile: the limit holds for it too, but it has nothing to resume.
  if (!limit.stopped) {
    return (
      <Notice inline tone="accent" icon={<Gauge size={12} aria-hidden />} className="px-1 text-meta" data-limit-notice="profile">
        {headline}
      </Notice>
    );
  }

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    setPending(true);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const arm = (armed: boolean) => run(() => callComputer(client, computer.id, 'limits.arm', { sessionId, armed }));
  const heldText = heldLine(held);

  return (
    <Notice
      tone="accent"
      icon={<Gauge size={14} aria-hidden />}
      data-limit-notice="stopped"
      data-limit-notice-armed={limit.resumeAt !== null || undefined}
      actions={
        <span className="flex flex-wrap items-center gap-1.5">
          <Button variant="primary" size="sm" icon={<Play size={10} fill="currentColor" aria-hidden />} disabled={pending} onClick={() => void run(() => callComputer(client, computer.id, 'limits.resume', { sessionId }))} data-limit-notice-resume>
            Resume now
          </Button>
          {limit.resumeAt !== null ? (
            <span className="flex items-center gap-1.5 text-meta text-muted" data-limit-notice-resumes>
              <Clock size={11} aria-hidden />
              {resumeLine({ at: limit.resumeAt }, now)}
              <Button size="sm" disabled={pending} onClick={() => void arm(false)} data-limit-notice-cancel>
                Cancel
              </Button>
            </span>
          ) : (
            limit.resetsAt !== null && (
              <Button size="sm" disabled={pending} onClick={() => void arm(true)} data-limit-notice-arm>
                Resume when it resets
              </Button>
            )
          )}
        </span>
      }
    >
      <span className="grid gap-0.5">
        <span className="font-medium">{headline}</span>
        {(heldText || limit.gaveUp || error) && (
          <span className="text-meta text-muted">
            {[heldText, limit.gaveUp ? 'It couldn’t resume by itself after the reset.' : null].filter(Boolean).join(' · ')}
            {error && <span className="block text-error select-text">{error}</span>}
          </span>
        )}
      </span>
    </Notice>
  );
}
