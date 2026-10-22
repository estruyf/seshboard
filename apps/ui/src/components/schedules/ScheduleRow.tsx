import { Check, MoreHorizontal, Pause, Play, Repeat } from 'lucide-react';
import { describe, type Schedule } from '@switchboard/protocol/client';
import { useHosts } from '../../state/hostsStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { lastRunLine, nextRunLine, scheduleLabel, type LastRunState } from '../../state/schedules.ts';
import { runScheduleNow, useSchedules } from '../../state/schedulesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import type { ScheduleMenus } from './scheduleMenu.tsx';

const TONE = { muted: 'text-muted', caution: 'text-caution' } as const;

/**
 * One schedule, on Home and in a project's Sessions tab: its project and name, the rule in words with the repeat icon,
 * how the last run went (linked to its session), the next run or Paused, Run now and ⋯. A paused schedule keeps its
 * place, dimmed.
 */
export function ScheduleRow({ schedule, now, menus, project = true }: { schedule: Schedule; now: number; menus: ScheduleMenus; project?: boolean }) {
  const projectInfo = useProjects((s) => s.projects.get(schedule.draft.cwd));
  const lastSession = schedule.lastRun?.sessionId ?? null;
  const lastState = useHosts((s): LastRunState => {
    const state = lastSession ? s.hosts.get(lastSession)?.state : undefined;
    return state === 'needs-you' ? 'waiting' : state === 'running' || state === 'starting' ? 'working' : null;
  });
  const last = lastRunLine(schedule, now);
  const next = nextRunLine(schedule, now);
  const openMenuBelow = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    menus.openMenu({ x: rect.right - 220, y: rect.bottom + 4 }, schedule);
  };
  return (
    <li
      tabIndex={0}
      aria-label={scheduleLabel(schedule, now, lastState)}
      className={`group/schedule flex min-w-0 items-center gap-2.5 rounded-lg py-2 pr-2 pl-2 hover:bg-border/45 ${schedule.paused ? 'opacity-60' : ''}`}
      data-schedule-row={schedule.id}
      data-schedule-paused={schedule.paused || undefined}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!menus.onKeyDown(e, schedule) && e.key === 'Enter') useSchedules.getState().edit(schedule);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        menus.openMenu({ x: e.clientX, y: e.clientY }, schedule);
      }}
    >
      {project ? <ProjectIcon project={projectInfo} root={schedule.draft.cwd} size={22} /> : <Repeat size={14} className="shrink-0 text-muted" aria-hidden />}
      <div className="grid min-w-0 flex-1 gap-px">
        <span className="truncate text-body text-text">{schedule.name}</span>
        <span className="flex min-w-0 items-center gap-1 text-meta text-faint">
          {project && <Repeat size={11} className="shrink-0" aria-hidden />}
          <span className="shrink-0">{describe(schedule.rule)}</span>
          {last && (
            <>
              <span aria-hidden>·</span>
              {last.sessionId && last.check ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => useSessions.getState().select(last.sessionId!)}
                  className="flex min-w-0 items-center gap-1 text-link hover:underline"
                  data-schedule-last={schedule.id}
                >
                  <span className="truncate">{last.text}</span>
                  <Check size={11} className="shrink-0 text-ok" aria-hidden />
                </button>
              ) : (
                <span className={`min-w-0 truncate ${TONE[last.tone]}`} data-schedule-last={schedule.id}>
                  {last.text}
                </span>
              )}
            </>
          )}
          {!project && next && (
            <>
              <span aria-hidden>·</span>
              <span className={`shrink-0 ${TONE[next.tone]}`}>{next.text}</span>
            </>
          )}
        </span>
      </div>
      {project && next && (
        <span className={`flex shrink-0 items-center gap-1 text-meta tabular-nums @max-[640px]:hidden ${next.tone === 'caution' ? 'text-caution' : 'text-muted'}`} data-schedule-next={schedule.id}>
          {schedule.paused && <Pause size={11} aria-hidden />}
          {next.text.startsWith('Next: ') ? (
            <>
              Next: <span className="text-text">{next.text.slice(6)}</span>
            </>
          ) : (
            next.text
          )}
        </span>
      )}
      <Button size="md" tabIndex={-1} icon={<Play size={11} fill="currentColor" aria-hidden />} onClick={() => void runScheduleNow(schedule)} className="shrink-0" data-schedule-run={schedule.id}>
        Run now
      </Button>
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        tabIndex={-1}
        icon={<MoreHorizontal size={15} aria-hidden />}
        aria-label={`More for ${schedule.name}`}
        onClick={(e) => openMenuBelow(e.currentTarget)}
        data-schedule-more={schedule.id}
      />
    </li>
  );
}
