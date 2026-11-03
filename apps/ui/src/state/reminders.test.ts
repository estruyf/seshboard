import { describe, expect, it } from 'vitest';
import { fromLocalInput, reminderLabel, reminderPresets, reminderWhen, toLocalInput } from './reminders.ts';

// A Wednesday, 14:30 local time.
const WED = new Date(2026, 10, 4, 14, 30).getTime();
const local = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0, 0).getTime();

describe('reminder presets', () => {
  it('offers in an hour, this evening, tomorrow morning and Monday morning', () => {
    expect(reminderPresets(WED).map((p) => [p.id, p.at])).toEqual([
      ['hour', WED + 60 * 60_000],
      ['evening', local(4, 18)],
      ['tomorrow', local(5, 9)],
      ['monday', local(9, 9)],
    ]);
  });

  it('leaves out this evening once it is less than an hour away, and Monday on a Sunday', () => {
    expect(reminderPresets(new Date(2026, 10, 4, 17, 30).getTime()).map((p) => p.id)).toEqual(['hour', 'tomorrow', 'monday']);
    expect(reminderPresets(new Date(2026, 10, 8, 10, 0).getTime()).map((p) => p.id)).toEqual(['hour', 'evening', 'tomorrow']);
    // On a Monday, Monday is next week's.
    expect(reminderPresets(new Date(2026, 10, 9, 10, 0).getTime()).find((p) => p.id === 'monday')!.at).toBe(local(16, 9));
  });

  it('says when, and whether it came late', () => {
    expect(reminderWhen(local(4, 18), WED)).toBe('Today 18:00');
    expect(reminderWhen(local(5, 9), WED)).toBe('Tomorrow 09:00');
    expect(reminderWhen(local(9, 9), WED)).toBe('Mon 09:00');
    expect(reminderLabel(local(5, 9), local(5, 9) + 30_000)).toBe('Reminder');
    expect(reminderLabel(local(5, 9), local(5, 11))).toBe('Reminder (from 09:00)');
    expect(fromLocalInput(toLocalInput(local(5, 9)))).toBe(local(5, 9));
  });
});
