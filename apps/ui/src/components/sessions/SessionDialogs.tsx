import { useEffect, useMemo, useState } from 'react';
import type { ClaudeProfile } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tildify } from '../../lib/format.ts';
import { trashName } from '../../lib/platform.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useProjectName } from '../../state/useQueue.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Select, type SelectOption } from '../ui/Select.tsx';
import { formatBytes } from '../worktrees/worktreeGroups.ts';
import { deletePlan, keptLine, type ManagerRow } from './sessionManager.ts';

const sessionsText = (count: number) => (count === 1 ? '1 session' : `${count.toLocaleString()} sessions`);

/**
 * Asks before moving sessions to the Trash: how much it frees, a line per project, and which picked sessions stay and
 * why. The engine checks the same rules again (`sessions.deleteMany`) and says what it skipped.
 */
export function MoveToTrashDialog({ rows, onClose, onDone }: { rows: readonly ManagerRow[]; onClose(): void; onDone?(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const projectName = useProjectName();
  const plan = useMemo(() => deletePlan(rows), [rows]);
  const count = plan.going.length;
  const kept = keptLine(plan.kept);
  const trash = trashName();
  const one = count === 1 ? plan.going[0]! : null;

  return (
    <ConfirmDialog
      title={one ? `Move “${one.title.length > 60 ? `${one.title.slice(0, 59)}…` : one.title}” to the ${trash}?` : `Move ${sessionsText(count)} to the ${trash}?`}
      danger
      confirmLabel={count === 1 ? `Move to ${trash}` : `Move ${count.toLocaleString()} to ${trash}`}
      blockedReason={count === 0 ? 'Nothing to move: every picked session is kept.' : null}
      data={{ 'data-move-to-trash-dialog': true }}
      body={
        <>
          Frees {formatBytes(plan.bytes)}. You can put {count === 1 ? 'it' : 'them'} back from the {trash}.
        </>
      }
      details={
        <>
          {plan.byProject.length > 1 && (
            <ul className="grid gap-1 rounded-lg border border-edge px-3 py-2 text-ui" data-trash-breakdown>
              {plan.byProject.map((p) => (
                <li key={p.root} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4">
                  <span className="truncate text-muted">{projectName(p.root)}</span>
                  <span className="tabular-nums">{sessionsText(p.count)}</span>
                  <span className="w-16 text-right font-mono text-meta tabular-nums text-muted">{formatBytes(p.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
          {kept && (
            <p className="text-ui text-muted" data-trash-kept>
              <span className="font-semibold text-text">Kept:</span> {kept}
            </p>
          )}
        </>
      }
      onConfirm={async () => {
        if (!client) throw new Error('Not connected to the engine');
        const { deleted, skipped } = await client.call('sessions.deleteMany', { sessionIds: plan.going.map((row) => row.id) });
        // Two panes: the other one takes the full width; none left, Home shows.
        useSessions.getState().closeSessions(deleted.map((d) => d.id));
        const failed = skipped.find((s) => s.reason === 'failed');
        toast(
          deleted.length === 0
            ? `Nothing was moved to the ${trash}`
            : `Moved ${sessionsText(deleted.length)} to the ${trash}${skipped.length ? `. Kept ${skipped.length.toLocaleString()}` : ''}`,
          failed?.error ? { body: failed.error } : {},
        );
        onDone?.();
      }}
      onClose={onClose}
    />
  );
}

/**
 * Turning deleting on, or making its days shorter so that more go at once: says how many sessions (and how much)
 * go today and how many follow, with Review to see exactly those in the overview first.
 */
export function DeleteArchivedDialog({
  mode,
  afterDays,
  deleteDays,
  due,
  pace,
  onReview,
  onConfirm,
  onClose,
}: {
  /** Turning deleting on, fewer delete days, or fewer archive days (archived sooner, so deleted sooner). */
  mode: 'turn-on' | 'shorter' | 'archive';
  afterDays: number;
  /** The delete setting's days (in archive mode, `afterDays` are the archive days). */
  deleteDays: number;
  due: readonly ManagerRow[];
  pace: string;
  onReview(): void;
  onConfirm(): void;
  onClose(): void;
}) {
  const bytes = due.reduce((sum, row) => sum + row.fileSize, 0);
  const trash = trashName();
  const dayText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const days = dayText(afterDays);
  const archived = mode === 'archive' ? dayText(deleteDays) : days;
  return (
    <ConfirmDialog
      title={mode === 'turn-on' ? `Turn on deleting after ${days}?` : mode === 'archive' ? `Archive after ${days}?` : `Delete after ${days}?`}
      confirmLabel={mode === 'turn-on' ? 'Turn on' : 'Change'}
      data={{ 'data-delete-archived-dialog': mode }}
      body={
        due.length === 0 ? (
          <>No session has been archived for more than {archived}. After that, {pace}.</>
        ) : (
          <>
            {due.length === 1 ? '1 session has' : `${due.length.toLocaleString()} sessions have`} been archived for more than {archived} ({formatBytes(bytes)}).{' '}
            {due.length === 1 ? 'It goes' : 'They go'} to the {trash} today. After that, {pace}.
          </>
        )
      }
      start={
        due.length > 0 && (
          <Button variant="quiet" className="text-link" onClick={onReview} data-review-due>
            Review the {due.length.toLocaleString()}
          </Button>
        )
      }
      onConfirm={async () => onConfirm()}
      onClose={onClose}
    />
  );
}

/** The days Claude Code's clean-up can be set to here; a value set by hand stays in the list too. */
const CLEANUP_DAYS = [7, 14, 30, 60, 90, 180, 365, 730, 3650];
const DEFAULT_CHOICE = 'default';
const daysLabel = (days: number) => (days === 3650 ? '10 years' : days === 730 ? '2 years' : days === 365 ? '1 year' : `${days} days`);

/** Each profile's `cleanupPeriodDays`, as the engine read it from the profile's settings.json. */
export interface ProfileCleanup {
  profileId: string;
  settingsPath: string;
  days: number | null;
  error: string | null;
}

/** Claude Code deletes transcripts after this many days when the key is missing. */
export const CLAUDE_CLEANUP_DEFAULT = 30;

/**
 * Claude Code's own clean-up, one row per profile (each has its own settings.json): its colour, name, file and days.
 * Saving writes only `cleanupPeriodDays` in the files that changed. Nothing is written before Save.
 */
export function CleanupPeriodDialog({
  periods,
  deleteAfter,
  onClose,
  onSaved,
}: {
  periods: readonly ProfileCleanup[];
  /** When Seshboard deletes a session, in days after its last activity (archive days plus delete days); null while deleting is off. */
  deleteAfter: number | null;
  onClose(): void;
  onSaved(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const profiles = useProfiles((s) => s.profiles);
  const [choice, setChoice] = useState<Record<string, number | null>>(() => Object.fromEntries(periods.map((p) => [p.profileId, p.days])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const home = useHomeFolder();
  const changed = periods.filter((p) => !p.error && choice[p.profileId] !== p.days);
  const profileOf = (id: string): ClaudeProfile | undefined => profiles.find((p) => p.id === id);
  useEffect(() => setError(null), [choice]);

  const save = async () => {
    if (!client) return;
    setBusy(true);
    try {
      for (const p of changed) await client.call('profiles.setCleanupPeriod', { profileId: p.profileId, days: choice[p.profileId] ?? null });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Claude Code's own cleanup"
      subtitle={
        <>
          Claude Code deletes transcripts that have been quiet this long, for every app that uses the profile. It's <code className="font-mono">cleanupPeriodDays</code> in the
          profile's <code className="font-mono">settings.json</code>.
        </>
      }
      width="md"
      onClose={onClose}
      onSubmit={changed.length ? () => void save() : undefined}
      data-cleanup-dialog
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="⌘↵" disabled={busy || changed.length === 0} onClick={() => void save()} data-cleanup-save>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <ul className="grid">
        {periods.map((p) => {
          const profile = profileOf(p.profileId);
          const value = choice[p.profileId] ?? null;
          const effective = value ?? CLAUDE_CLEANUP_DEFAULT;
          const options: Array<SelectOption<string>> = [
            { value: DEFAULT_CHOICE, label: `${CLAUDE_CLEANUP_DEFAULT} days (default)` },
            ...[...new Set([...CLEANUP_DAYS, ...(p.days !== null ? [p.days] : [])])].sort((a, b) => a - b).map((days) => ({ value: String(days), label: daysLabel(days) })),
          ];
          const note = p.error
            ? `Seshboard can't read this file, so it won't change it: ${p.error}`
            : deleteAfter !== null && effective < deleteAfter
              ? `Shorter than Seshboard's delete setting (${deleteAfter} days after the last activity): Claude Code deletes these sessions first.`
              : value === null
                ? "The default. Applies even when Seshboard's deleting is off."
                : null;
          return (
            <li key={p.profileId} className="flex items-start gap-3 border-t border-border py-3 first:border-t-0 first:pt-0" data-cleanup-profile={p.profileId}>
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${PROFILE_DOT[profile?.color ?? 'gray']}`} aria-hidden />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-ui font-semibold text-text">{profile?.name ?? p.profileId}</span>
                <span className="truncate font-mono text-meta text-muted" data-tooltip={p.settingsPath}>
                  {tildify(p.settingsPath, home)}
                </span>
                {note && <span className={`text-meta ${p.error ? 'text-error' : 'text-warn'}`}>{note}</span>}
              </span>
              <Select
                label={`Days before Claude Code deletes ${profile?.name ?? 'this profile'}'s transcripts`}
                value={value === null ? DEFAULT_CHOICE : String(value)}
                options={options}
                disabled={!!p.error}
                onChange={(next) => setChoice((c) => ({ ...c, [p.profileId]: next === DEFAULT_CHOICE ? null : Number(next) }))}
                className="h-7 shrink-0 rounded-md border border-edge px-2.5 text-ui"
                dataAttrs={{ 'data-cleanup-days': p.profileId }}
              />
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-ui text-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
