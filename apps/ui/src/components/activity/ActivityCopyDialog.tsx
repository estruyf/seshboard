import { useMemo, useState } from 'react';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { addDays, countsByDay, inProject, lastActiveDay, lastDayLabel, LOOK_BACK_DAYS, mondayOf, standupText, type ActivityRow, type StandupFormat } from './activityModel.ts';
import { useActivityRange } from './useActivity.ts';

type Pick = 'last' | 'today' | 'week' | 'range';

/**
 * Copy for standup: the last day you worked (Yesterday, or Friday on a Monday), today or this week, one line per session.
 * A project picked on the page stays picked: only its sessions, and the last day you worked on it. With a range on the page, that too.
 */
export function ActivityCopyDialog({ today, project, initial, rangeRows, onClose }: { today: string; project: { key: string; name: string } | null; initial: Pick; rangeRows: readonly ActivityRow[] | null; onClose(): void }) {
  const { rows: everything, loading } = useActivityRange(addDays(today, -LOOK_BACK_DAYS), today);
  const [pick, setPick] = useState<Pick>(initial);
  const [format, setFormat] = useState<StandupFormat>('markdown');

  const rows = useMemo(() => inProject(everything, project?.key ?? null), [everything, project]);
  const counts = useMemo(() => countsByDay(rows), [rows]);
  const lastDay = useMemo(() => lastActiveDay(today, counts) ?? addDays(today, -1), [today, counts]);
  const text = useMemo(() => {
    if (pick === 'range') return standupText(rangeRows ?? [], format);
    const picked = pick === 'week' ? rows.filter((row) => row.day >= mondayOf(today)) : rows.filter((row) => row.day === (pick === 'today' ? today : lastDay));
    return standupText(picked, format);
  }, [rows, rangeRows, pick, format, today, lastDay]);

  const copy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => {
        toast('Copied for standup.');
        onClose();
      },
      () => toast('Couldn’t copy it.', { tone: 'error' }),
    );
  };

  return (
    <Dialog
      width="sm"
      title="Copy for standup"
      subtitle={project ? `Only ${project.name}.` : undefined}
      onClose={onClose}
      onSubmit={copy}
      data-activity-copy-dialog
      footerStart={<span className="text-meta text-muted">{format === 'markdown' ? 'Markdown' : 'Plain text'} · one line per session</span>}
      footer={
        <>
          <Button onClick={() => setFormat(format === 'markdown' ? 'plain' : 'markdown')} data-activity-copy-format>
            {format === 'markdown' ? 'Plain text' : 'Markdown'}
          </Button>
          <Button variant="primary" kbd="↵" disabled={!text} onClick={copy} data-activity-copy-now>
            Copy
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <SegmentedControl
          mode="radio"
          label="Which days"
          value={pick}
          onChange={(value: Pick) => setPick(value)}
          segments={[
            { value: 'last', label: lastDayLabel(lastDay, today), data: { 'data-activity-copy-pick': 'last' } },
            { value: 'today', label: 'Today', data: { 'data-activity-copy-pick': 'today' } },
            { value: 'week', label: 'This week', data: { 'data-activity-copy-pick': 'week' } },
            ...(rangeRows ? [{ value: 'range' as const, label: 'This range', data: { 'data-activity-copy-pick': 'range' } }] : []),
          ]}
        />
        <pre className="max-h-72 min-h-16 overflow-auto rounded-lg bg-code px-3 py-2.5 font-mono text-ui leading-relaxed whitespace-pre-wrap text-text" data-activity-copy-text>
          {text || (loading ? 'Reading your days…' : 'No sessions then.')}
        </pre>
      </div>
    </Dialog>
  );
}
