import { useState } from 'react';
import { Clock, Gauge, Play } from 'lucide-react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { heldLine, limitAhead, limitHeadline, limitStanding, resumeLine } from '../../lib/usageLimit.ts';
import { useLimits } from '../../state/limitsStore.ts';
import { useMinute } from '../focus/useMinute.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';

/**
 * Above the message box of a session whose Claude profile is at a plan usage limit: which limit, when it resets and a
 * countdown. A session the limit stopped offers Resume now and Resume when it resets, and says how many queued
 * messages wait for it; another session of the profile only says the limit holds. Nothing shows while Claude works.
 */
export function UsageLimitNotice({ sessionId, profileId, busy, held, resumeAllowed }: {
  sessionId: string;
  profileId: string;
  busy: boolean;
  /** Messages in Up next, which wait for the limit. */
  held: number;
  /** Resuming a session that isn't running starts it again, which the focus limit has a say in. */
  resumeAllowed(): Promise<boolean>;
}) {
  const limits = useLimits((s) => s.state);
  const standing = limitStanding(limits, sessionId, profileId);
  const now = useMinute(standing !== null);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!standing || busy) return null;
  const { limit, resume, gaveUp } = standing;
  const headline = limitHeadline(limit, now);

  // Another session of the profile: the limit holds for it too, but it has nothing to resume.
  if (standing.kind === 'at') {
    if (!limitAhead(limit, now)) return null;
    return (
      <Notice inline tone="accent" icon={<Gauge size={12} aria-hidden />} className="px-1 text-meta" data-limit-notice="profile">
        {headline}
      </Notice>
    );
  }

  const run = async (work: () => Promise<unknown>) => {
    if (!client) return;
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
  const resumeNow = () =>
    run(async () => {
      if (!(await resumeAllowed())) return;
      await client!.call('limits.resume', { sessionId });
    });
  const arm = (armed: boolean) => run(() => client!.call('limits.arm', { sessionId, armed }));
  const heldText = heldLine(held);

  return (
    <Notice
      tone="accent"
      icon={<Gauge size={14} aria-hidden />}
      data-limit-notice="stopped"
      data-limit-notice-armed={resume !== null || undefined}
      actions={
        <span className="flex flex-wrap items-center gap-1.5">
          <Button variant="primary" size="sm" icon={<Play size={10} fill="currentColor" aria-hidden />} disabled={pending} onClick={() => void resumeNow()} data-limit-notice-resume>
            Resume now
          </Button>
          {resume ? (
            <span className="flex items-center gap-1.5 text-meta text-muted" data-limit-notice-resumes>
              <Clock size={11} aria-hidden />
              {resumeLine(resume, now)}
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
        {(heldText || gaveUp || error) && (
          <span className="text-meta text-muted">
            {[heldText, gaveUp ? 'It couldn’t resume by itself after the reset.' : null].filter(Boolean).join(' · ')}
            {error && <span className="block text-error">{error}</span>}
          </span>
        )}
      </span>
    </Notice>
  );
}
