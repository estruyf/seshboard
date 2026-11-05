import { useState } from 'react';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { activityCsv, activityMarkdown, dayShort, dayTitle, exportFileName, plural, statsOf, type ActivityRow } from './activityModel.ts';

type Span = 'day' | 'week';
type Format = 'md' | 'csv';

/** Export…: the day or the week on screen as Markdown or CSV (a project picked in the week's bars stays picked). */
export function ActivityExportDialog({ day, first, last, dayRows, weekRows, onClose }: { day: string; first: string; last: string; dayRows: readonly ActivityRow[]; weekRows: readonly ActivityRow[]; onClose(): void }) {
  const [span, setSpan] = useState<Span>('day');
  const [format, setFormat] = useState<Format>('csv');
  const [saving, setSaving] = useState(false);
  const rows = span === 'day' ? dayRows : weekRows;
  const count = statsOf(rows).sessions;

  const save = async () => {
    if (saving || rows.length === 0) return;
    setSaving(true);
    try {
      const fileName = span === 'day' ? exportFileName(day, day, format) : exportFileName(first, last, format);
      const path = await window.seshboard!.saveTextFile({ fileName, content: format === 'csv' ? activityCsv(rows) : activityMarkdown(rows) });
      if (path === null) {
        setSaving(false);
        return;
      }
      toast(`Saved ${fileName}.`);
      onClose();
    } catch (error) {
      setSaving(false);
      toast(`Couldn’t save it: ${error instanceof Error ? error.message : String(error)}`, { tone: 'error' });
    }
  };

  return (
    <Dialog
      width="sm"
      title="Export"
      subtitle={`${span === 'day' ? dayTitle(day) : `${dayShort(first)} to ${dayShort(last)}`}: ${plural(count, 'session')}.`}
      onClose={onClose}
      onSubmit={() => void save()}
      data-activity-export-dialog
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="↵" aria-busy={saving} disabled={saving || rows.length === 0} onClick={() => void save()} data-activity-export-save>
            {saving ? 'Saving…' : 'Save…'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-ui">
        <SegmentedControl
          mode="radio"
          label="What to export"
          value={span}
          onChange={(value: Span) => setSpan(value)}
          segments={[
            { value: 'day', label: 'This day', data: { 'data-activity-export-span': 'day' } },
            { value: 'week', label: 'The week', data: { 'data-activity-export-span': 'week' } },
          ]}
        />
        <SegmentedControl
          mode="radio"
          label="Format"
          value={format}
          onChange={(value: Format) => setFormat(value)}
          segments={[
            { value: 'csv', label: 'CSV', data: { 'data-activity-export-format': 'csv' } },
            { value: 'md', label: 'Markdown', data: { 'data-activity-export-format': 'md' } },
          ]}
        />
        <p className="text-meta text-muted">{format === 'csv' ? 'A line per session per day, for a timesheet.' : 'Day by day and project by project, with what each session did.'}</p>
      </div>
    </Dialog>
  );
}
