import { AlertTriangle, CalendarDays, Repeat } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { describe, formatRun, nameFromPrompt, nextRuns, ruleProblem, WEEK_ORDER, DAY_NAMES, type LaterDraft, type Schedule } from '@switchboard/protocol/client';
import { modelLabel } from '../../lib/autoModel.ts';
import { basename } from '../../lib/format.ts';
import { MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { formOf, formProblem, newForm, REPEAT_LABELS, ruleOf, toggleDay, type RepeatKind, type ScheduleForm } from '../../state/schedules.ts';
import { saveSchedule } from '../../state/schedulesStore.ts';
import { EFFORT_LABEL } from '../newSession/route.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';

const REPEATS: RepeatKind[] = ['daily', 'weekdays', 'weekly', 'monthly'];
/** The day toggles' letters, Monday first. */
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const FIELD = 'h-7 rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';

/** One row of the dialog: the label on the left, the control on the right. */
function Row({ label, htmlFor, children, labelId }: { label: string; htmlFor?: string; labelId?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="pt-1.5 text-ui text-muted">
          {label}
        </label>
      ) : (
        <span id={labelId} className="pt-1.5 text-ui text-muted">
          {label}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * "Schedule a session": New session's prompt, with its choices, at set times. Name, Repeat (every day, Monday to
 * Friday, the picked days of the week, a day of the month), At, If missed, the next three runs (live), and what each
 * run starts with. With the mode on Default it says Claude will stop at its first permission; it doesn't change the
 * mode. Editing a schedule (`schedule`) keeps its other values.
 */
export function ScheduleDialog({ draft, schedule, onClose, onSaved }: { draft: LaterDraft; schedule: Schedule | null; onClose(): void; onSaved(schedule: Schedule): void }) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [now] = useState(() => Date.now());
  const [form, setForm] = useState<ScheduleForm>(() => (schedule ? { ...formOf(schedule, now), name: schedule.name } : newForm(nameFromPrompt(draft.typed || draft.prompt), now)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const update = (patch: Partial<ScheduleForm>) => setForm((current) => ({ ...current, ...patch }));

  const rule = ruleOf(form);
  const problem = formProblem(form);
  const runs = useMemo(() => (ruleProblem(rule) ? [] : nextRuns(rule, now, 3)), [JSON.stringify(rule), now]);

  const models = useHosts((s) => s.models);
  const project = useProjects((s) => s.projects.get(draft.cwd));
  const profile = useProfiles((s) => s.profiles.find((p) => p.id === (draft.profileId ?? project?.profileId ?? s.defaultId)));
  const multipleProfiles = useProfiles((s) => s.profiles.length > 1);
  const mode = draft.permissionMode ?? 'default';
  const asks = mode === 'default';
  const runsWith = [
    draft.workspace === 'worktree' ? 'New worktree' : draft.branch ? `On ${draft.branch}` : 'Current checkout',
    modelLabel(models, draft.model ?? ''),
    draft.effort ? `${EFFORT_LABEL[draft.effort]} effort` : null,
  ].filter(Boolean);

  const save = async () => {
    setTried(true);
    if (problem || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveSchedule({ ...(schedule ? { id: schedule.id, paused: schedule.paused } : { paused: false }), name: form.name.trim(), draft, rule, missed: form.missed });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={schedule ? 'Save schedule' : 'Schedule a session'}
      icon={<Repeat size={16} className="text-accent-ink" aria-hidden />}
      width="md"
      onClose={onClose}
      onSubmit={() => void save()}
      initialFocus={nameRef}
      footerStart={<span className="text-meta text-muted">Each run is a new session.</span>}
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={saving || (tried && !!problem)} onClick={() => void save()} data-schedule-save>
            {schedule ? 'Save' : 'Schedule'}
          </Button>
        </>
      }
      data-schedule-dialog
    >
      <div className="grid gap-4">
        <Row label="Name" htmlFor={`${id}-name`}>
          <input
            ref={nameRef}
            id={`${id}-name`}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            maxLength={200}
            className={`w-full ${FIELD} ${tried && !form.name.trim() ? 'border-error' : 'border-edge'}`}
            data-schedule-name
          />
        </Row>

        <Row label="Repeat" labelId={`${id}-repeat`}>
          <div className="grid gap-2">
            <SegmentedControl
              mode="radio"
              label="Repeat"
              value={form.repeat}
              onChange={(repeat) => update({ repeat })}
              segments={REPEATS.map((value) => ({ value, label: REPEAT_LABELS[value], data: { 'data-schedule-repeat': value } }))}
              className="w-fit"
            />
            {form.repeat === 'weekly' && (
              <div role="group" aria-label="Days" className="flex gap-1.5" data-schedule-days>
                {WEEK_ORDER.map((day) => {
                  const on = form.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[day]}
                      onClick={() => update({ days: toggleDay(form.days, day) })}
                      className={`size-7 rounded-md border text-ui font-semibold ${on ? 'border-accent bg-accent text-on-accent' : 'border-edge text-muted hover:bg-border/45 hover:text-text'}`}
                      data-schedule-day={day}
                    >
                      {DAY_LETTER[day]}
                    </button>
                  );
                })}
              </div>
            )}
            {form.repeat === 'monthly' && (
              <div className="flex items-center gap-2">
                <label htmlFor={`${id}-day`} className="text-ui text-muted">
                  Day
                </label>
                <input
                  id={`${id}-day`}
                  type="number"
                  min={1}
                  max={31}
                  value={form.monthDay}
                  onChange={(e) => update({ monthDay: e.target.value })}
                  className={`w-16 ${FIELD} ${tried && problem?.startsWith('Pick a day') ? 'border-error' : 'border-edge'}`}
                  data-schedule-month-day
                />
                <span className="text-meta text-muted">Shorter months use their last day.</span>
              </div>
            )}
          </div>
        </Row>

        <Row label="At" htmlFor={`${id}-time`}>
          <div className="flex items-center gap-3">
            {/* A time field shows the time the way this computer does (24-hour or AM/PM); its value is HH:MM. */}
            <input id={`${id}-time`} type="time" value={form.time} onChange={(e) => update({ time: e.target.value })} required className={`w-32 ${FIELD} border-edge`} data-schedule-time />
            {!ruleProblem(rule) && (
              <span className="min-w-0 truncate text-meta text-muted" data-schedule-describe>
                {describe(rule)}
              </span>
            )}
          </div>
        </Row>

        <Row label="If missed" labelId={`${id}-missed`}>
          <RadioGroup label="If missed" className="grid gap-1.5">
            <Radio checked={form.missed === 'run'} onSelect={() => update({ missed: 'run' })} className="text-ui" dataAttrs={{ 'data-schedule-missed': 'run' }}>
              Run when Switchboard starts
            </Radio>
            <Radio checked={form.missed === 'skip'} onSelect={() => update({ missed: 'skip' })} className="text-ui" dataAttrs={{ 'data-schedule-missed': 'skip' }}>
              Skip it
            </Radio>
          </RadioGroup>
        </Row>

        <Row label="Next runs" labelId={`${id}-next`}>
          {runs.length > 0 ? (
            <ul aria-labelledby={`${id}-next`} className="flex flex-wrap gap-1.5" aria-live="polite" data-schedule-next-runs>
              {runs.map((run) => (
                <li key={run.getTime()} className="flex h-7 items-center gap-1.5 rounded-md border border-edge px-2 text-ui text-text tabular-nums">
                  <CalendarDays size={13} className="text-muted" aria-hidden />
                  {formatRun(run)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="pt-1.5 text-ui text-error" role="alert">
              {problem}
            </p>
          )}
        </Row>

        <Row label="Runs with" labelId={`${id}-with`}>
          <div className="grid gap-0.5 pt-1">
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui text-text" data-schedule-runs-with>
              <ProjectIcon project={project} root={draft.cwd} size={16} />
              <span>{project?.name ?? basename(draft.cwd)}</span>
              {runsWith.map((part) => (
                <span key={part}>· {part}</span>
              ))}
              <span>
                · <span className={asks ? 'text-caution' : ''}>{MODE_LABEL[mode]}</span>
              </span>
              {multipleProfiles && profile && <span>· {profile.name}</span>}
            </p>
            <p className="text-meta text-muted">From New session, with its prompt. {schedule ? 'Change them there.' : 'Edit changes them there.'}</p>
          </div>
        </Row>

        {asks && (
          <Notice tone="caution" icon={<AlertTriangle size={14} aria-hidden />} data-schedule-mode-warning>
            Claude stops at the first permission it needs and waits for you. Pick Accept edits or Auto to let it work on.
          </Notice>
        )}

        {tried && problem && runs.length > 0 && (
          <p className="text-ui text-error" role="alert">
            {problem}
          </p>
        )}
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
