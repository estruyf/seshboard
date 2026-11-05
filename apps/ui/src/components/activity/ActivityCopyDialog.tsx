import { useMemo, useState } from 'react';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { addDays, countsByDay, lastActiveDay, lastDayLabel, standupText, stripDays, type StandupFormat } from './activityModel.ts';
import { useActivityRange } from './useActivity.ts';

type Pick = 'last' | 'today' | 'week';

/** Copy for standup: the last day you worked (Yesterday, or Friday on a Monday), today or this week, one line per session. */
export function ActivityCopyDialog({ today, onClose }: { today: string; onClose(): void }) {
  const days = useMemo(() => stripDays(today), [today]);
  const { rows, loading } = useActivityRange(days[0]!, today);
  const [pick, setPick] = useState<Pick>('last');
  const [format, setFormat] = useState<StandupFormat>('markdown');

  const counts = useMemo(() => countsByDay(rows), [rows]);
  const lastDay = useMemo(() => lastActiveDay(today, counts) ?? addDays(today, -1), [today, counts]);
  const text = useMemo(() => {
    const picked = pick === 'week' ? rows : rows.filter((row) => row.day === (pick === 'today' ? today : lastDay));
    return standupText(picked, format);
  }, [rows, pick, format, today, lastDay]);

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
          ]}
        />
        <pre className="max-h-72 min-h-16 overflow-auto rounded-lg bg-code px-3 py-2.5 font-mono text-ui leading-relaxed whitespace-pre-wrap text-text" data-activity-copy-text>
          {text || (loading ? 'Reading your days…' : 'No sessions then.')}
        </pre>
      </div>
    </Dialog>
  );
}
