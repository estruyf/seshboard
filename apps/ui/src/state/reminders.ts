import { DAY_SHORT, formatRun } from '@seshboard/protocol/client';
import { dayDiff, runClock } from './upcoming.ts';

/**
 * Remind me later (session triage): the presets the dialog offers, and how a reminder's time reads. Pure, so a fake
 * clock can test it.
 */

/** A reminder this late was missed (closed, asleep): the engine's `MISSED_AFTER_MS`. */
const MISSED_AFTER_MS = 2 * 60_000;

export interface ReminderPreset {
  id: 'hour' | 'evening' | 'tomorrow' | 'monday';
  label: string;
  /** When, in short: "15:30", "Tue 09:00". */
  hint: string;
  at: number;
}

const at = (base: Date, days: number, hours: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d.getTime();
};

/**
 * In 1 hour; This evening (18:00, only while it is at least an hour away); Tomorrow 09:00; Monday 09:00 (next week's on
 * a Monday, and left out on a Sunday, when it is tomorrow).
 */
export function reminderPresets(now: number): ReminderPreset[] {
  const today = new Date(now);
  const presets: ReminderPreset[] = [{ id: 'hour', label: 'In 1 hour', hint: runClock(now + 60 * 60_000), at: now + 60 * 60_000 }];
  const evening = at(today, 0, 18);
  if (evening - now >= 60 * 60_000) presets.push({ id: 'evening', label: 'This evening', hint: runClock(evening), at: evening });
  const tomorrow = at(today, 1, 9);
  presets.push({ id: 'tomorrow', label: 'Tomorrow', hint: `${DAY_SHORT[new Date(tomorrow).getDay()]} ${runClock(tomorrow)}`, at: tomorrow });
  const toMonday = (8 - today.getDay()) % 7 || 7;
  if (toMonday !== 1) {
    const monday = at(today, toMonday, 9);
    presets.push({ id: 'monday', label: 'Monday', hint: formatRun(monday), at: monday });
  }
  return presets;
}

/** When a reminder is for, in a few words: "Today 18:00", "Tomorrow 09:00", "Mon 09:00", or the date further out. */
export function reminderWhen(remindAt: number, now: number): string {
  const diff = dayDiff(remindAt, now);
  if (diff === 0) return `Today ${runClock(remindAt)}`;
  if (diff === 1) return `Tomorrow ${runClock(remindAt)}`;
  if (diff > 1 && diff < 7) return `${DAY_SHORT[new Date(remindAt).getDay()]} ${runClock(remindAt)}`;
  return formatRun(remindAt);
}

/** A due reminder on its row: "Reminder", or "Reminder (from 09:00)" for one that came late (missed). */
export const reminderLabel = (remindAt: number, remindedAt: number): string => (remindedAt - remindAt > MISSED_AFTER_MS ? `Reminder (from ${runClock(remindAt)})` : 'Reminder');

/** The `datetime-local` field's value for a time (local), and back. */
export function toLocalInput(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
