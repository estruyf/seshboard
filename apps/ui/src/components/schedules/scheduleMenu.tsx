import { Pause, Play, SkipForward } from 'lucide-react';
import type { Schedule } from '@seshboard/protocol/client';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { contextMenuPoint, isContextMenuKey } from '../../lib/contextMenu.ts';
import { deleteSchedule, nextRunToSkip, runScheduleNow, setSchedulePaused, skipRun, useSchedules } from '../../state/schedulesStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';

/**
 * A schedule's menu: Run now, Skip next run, Edit…, Pause (Resume when paused), then Delete, which shows Undo. Home, a
 * project's Sessions tab, Upcoming and the palette share it.
 */
export function scheduleEntries(schedule: Schedule): MenuEntry[] {
  const next = nextRunToSkip(schedule);
  return [
    { label: 'Run now', icon: <Play size={13} aria-hidden />, data: { 'data-schedule-menu-run': true }, onSelect: () => void runScheduleNow(schedule) },
    {
      label: 'Skip next run',
      icon: <SkipForward size={13} aria-hidden />,
      disabled: next === null,
      data: { 'data-schedule-menu-skip': true },
      onSelect: () => {
        if (next !== null) void skipRun(schedule, next);
      },
    },
    { label: 'Edit…', data: { 'data-schedule-menu-edit': true }, onSelect: () => useSchedules.getState().edit(schedule) },
    schedule.paused
      ? { label: 'Resume', icon: <Play size={13} aria-hidden />, data: { 'data-schedule-menu-pause': 'resume' }, onSelect: () => void setSchedulePaused(schedule, false).catch(() => {}) }
      : { label: 'Pause', icon: <Pause size={13} aria-hidden />, data: { 'data-schedule-menu-pause': 'pause' }, onSelect: () => void setSchedulePaused(schedule, true).catch(() => {}) },
    'separator',
    { label: 'Delete', danger: true, data: { 'data-schedule-menu-delete': true }, onSelect: () => void deleteSchedule(schedule).catch(() => {}) },
  ];
}

/** A run's menu in Upcoming's timeline: Run now, Skip this run, then the schedule's Edit schedule… and Pause schedule. */
export function runEntries(schedule: Schedule, at: number): MenuEntry[] {
  return [
    { label: 'Run now', icon: <Play size={13} aria-hidden />, data: { 'data-run-menu-run': true }, onSelect: () => void runScheduleNow(schedule) },
    { label: 'Skip this run', icon: <SkipForward size={13} aria-hidden />, data: { 'data-run-menu-skip': true }, onSelect: () => void skipRun(schedule, at) },
    'separator',
    { label: 'Edit schedule…', data: { 'data-run-menu-edit': true }, onSelect: () => useSchedules.getState().edit(schedule) },
    schedule.paused
      ? { label: 'Resume schedule', icon: <Play size={13} aria-hidden />, data: { 'data-run-menu-pause': 'resume' }, onSelect: () => void setSchedulePaused(schedule, false).catch(() => {}) }
      : { label: 'Pause schedule', icon: <Pause size={13} aria-hidden />, data: { 'data-run-menu-pause': 'pause' }, onSelect: () => void setSchedulePaused(schedule, true).catch(() => {}) },
  ];
}

export interface ScheduleMenus {
  openMenu(at: { x: number; y: number }, schedule: Schedule): void;
  /** ⇧F10 and the menu key on a focused row. True when handled. */
  onKeyDown(event: KeyboardEvent<HTMLElement>, schedule: Schedule): boolean;
  /** The menu; render once. */
  overlay: ReactNode;
}

/** The row menu and its keys. */
export function useScheduleMenu(): ScheduleMenus {
  const [menu, setMenu] = useState<{ x: number; y: number; schedule: Schedule } | null>(null);
  const openMenu: ScheduleMenus['openMenu'] = (at, schedule) => setMenu({ ...at, schedule });
  const onKeyDown: ScheduleMenus['onKeyDown'] = (event, schedule) => {
    if (!isContextMenuKey(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    openMenu(contextMenuPoint(null, event.currentTarget.getBoundingClientRect(), window.innerHeight), schedule);
    return true;
  };
  const overlay = menu && <Menu x={menu.x} y={menu.y} entries={scheduleEntries(menu.schedule)} label={`Schedule: ${menu.schedule.name}`} width={220} onClose={() => setMenu(null)} />;
  return { openMenu, onKeyDown, overlay };
}
