import { BellRing } from 'lucide-react';
import type { SessionSummary } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { reminderWhen } from '../../state/reminders.ts';
import { openRemindEditor } from '../../state/remindEditorStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { basename } from '../../lib/format.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';

/** The snoozed sessions (Remind me later), soonest first: what the Reminders card lists and the sidebar's Upcoming counts. */
export const snoozedSessions = (sessions: Iterable<SessionSummary>): SessionSummary[] =>
  [...sessions].filter((s) => s.remindAt != null && s.remindedAt == null).sort((a, b) => a.remindAt! - b.remindAt!);

/**
 * Reminders in Upcoming: each snoozed session with when it comes back and its note. Edit changes the time, Remind now
 * brings it back at once (under Reminders), Cancel puts it back in the list.
 */
export function RemindersCard({ reminders, now }: { reminders: readonly SessionSummary[]; now: number }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const projects = useProjects((s) => s.projects);
  const remind = (s: SessionSummary, at: number | null, what: string) =>
    void client?.call('sessions.remind', { sessionIds: [s.id], at }).catch((e: Error) => toast(`Couldn't ${what}: ${e.message}`, { tone: 'error' }));
  return (
    <section aria-labelledby="upcoming-reminders" className="grid content-start gap-1 rounded-xl border border-border bg-card p-3" data-upcoming-reminders>
      <SectionHeader as="h2" headingId="upcoming-reminders" count={reminders.length} className="px-1 pb-1">
        Reminders
      </SectionHeader>
      {reminders.length === 0 ? (
        <p className="px-1 pb-1 text-ui text-muted" data-upcoming-no-reminders>
          Nothing snoozed. Press L on a session, or pick Remind me… in its menu.
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {reminders.map((s) => (
            <li key={s.id} className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-border/45" data-upcoming-reminder={s.id}>
              <ProjectIcon project={projects.get(s.projectRoot)} root={s.projectRoot} size={18} />
              <button type="button" className="grid min-w-0 flex-1 text-left" onClick={() => useSessions.getState().select(s.id)}>
                <span className="truncate text-ui text-text">{s.title}</span>
                <span className="truncate text-meta text-muted">{[projects.get(s.projectRoot)?.name ?? basename(s.projectRoot), s.note].filter(Boolean).join(' · ')}</span>
              </button>
              <span className="flex shrink-0 items-center gap-1 text-meta text-muted tabular-nums" data-upcoming-reminder-when>
                <BellRing size={11} aria-hidden />
                {reminderWhen(s.remindAt!, now)}
              </span>
              <Button size="sm" onClick={() => openRemindEditor([s.id])} data-upcoming-reminder-edit>
                Edit
              </Button>
              <Button size="sm" onClick={() => remind(s, Date.now(), 'remind you now')} data-upcoming-reminder-now>
                Remind now
              </Button>
              <Button variant="quiet" size="sm" onClick={() => remind(s, null, 'cancel the reminder')} data-upcoming-reminder-cancel>
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
