import { ACTIVITY_MAX_DAYS } from '@seshboard/protocol/client';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { useActivity } from '../../state/activityStore.ts';
import { Button } from '../ui/Button.tsx';
import { Popover } from '../ui/Popover.tsx';
import { addDays, addMonths, calendarWeeks, dayLabel, dayNumber, dayTitle, monthOf, monthTitle, pickFrom, pickTill, rangeDays, sameDayInMonth, weekdayShort, type DayRange } from './activityModel.ts';

const GRID_KEYS: Record<string, (day: string) => string> = {
  ArrowLeft: (day) => addDays(day, -1),
  ArrowRight: (day) => addDays(day, 1),
  ArrowUp: (day) => addDays(day, -7),
  ArrowDown: (day) => addDays(day, 7),
  PageUp: (day) => sameDayInMonth(day, -1),
  PageDown: (day) => sameDayInMonth(day, 1),
};

/** A month to pick a day from: the arrow keys move a day or a week, Page Up and Page Down a month. Days to come can't be picked. */
function Calendar({ value, from, to, today, tillToday, label, x, y, anchor, onPick, onToday, onClose }: { value: string; from: string; to: string; today: string; tillToday: boolean; label: string; x: number; y: number; anchor: RefObject<HTMLElement | null>; onPick(day: string): void; onToday?(): void; onClose(): void }) {
  const [month, setMonth] = useState(monthOf(value));
  const [focusDay, setFocusDay] = useState(value);
  const grid = useRef<HTMLDivElement>(null);
  const weeks = calendarWeeks(month);
  const inMonth = (day: string) => monthOf(day) === month;
  // One Tab stop in the grid: the day the keys are on, or this month's first that can be picked.
  const tabStop = inMonth(focusDay) && focusDay <= today ? focusDay : (weeks.flat().find((day) => inMonth(day) && day <= today) ?? null);

  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-activity-calendar-day="${focusDay}"]`)?.focus();
  }, [focusDay]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = GRID_KEYS[event.key];
    const current = (event.target as HTMLElement).dataset.activityCalendarDay;
    if (!step || !current) return;
    event.preventDefault();
    const next = step(current);
    const day = next > today ? today : next;
    setMonth(monthOf(day));
    setFocusDay(day);
  };

  return (
    <Popover x={x} y={y} width={272} anchor={anchor} onClose={onClose} role="dialog" aria-label={label} className="px-2.5 py-2" data-activity-calendar>
      <div className="flex items-center justify-between pb-1.5">
        <Button variant="quiet" iconOnly icon={<ChevronLeft size={14} aria-hidden />} aria-label="Earlier month" onClick={() => setMonth(addMonths(month, -1))} data-activity-calendar-earlier />
        <span className="text-ui font-semibold" aria-live="polite" data-activity-calendar-month>
          {monthTitle(month)}
        </span>
        <Button variant="quiet" iconOnly icon={<ChevronRight size={14} aria-hidden />} aria-label="Later month" disabled={month >= monthOf(today)} onClick={() => setMonth(addMonths(month, 1))} data-activity-calendar-later />
      </div>
      <div ref={grid} className="grid grid-cols-7 gap-y-0.5" role="group" aria-label={monthTitle(month)} onKeyDown={onKeyDown}>
        {weeks[0]!.map((day) => (
          <span key={day} className="pb-0.5 text-center text-meta text-muted" aria-hidden>
            {weekdayShort(day)}
          </span>
        ))}
        {weeks.flat().map((day) => {
          const selected = day === value;
          const covered = !selected && day >= from && day <= to;
          return (
            <button
              key={day}
              type="button"
              disabled={day > today}
              tabIndex={day === tabStop ? 0 : -1}
              onClick={() => onPick(day)}
              onFocus={() => setFocusDay(day)}
              aria-label={`${dayTitle(day)}${day === today ? ', today' : ''}`}
              aria-pressed={selected}
              className={`h-7 rounded-md text-ui tabular-nums disabled:opacity-40 ${selected ? 'bg-accent font-semibold text-on-accent' : `${covered ? 'bg-selected' : 'enabled:hover:bg-border/45'} ${inMonth(day) ? 'text-text' : 'text-faint'} ${day === today ? 'font-semibold' : ''}`}`}
              data-activity-calendar-day={day}
            >
              {dayNumber(day)}
            </button>
          );
        })}
      </div>
      {onToday && (
        <div className="grid pt-2">
          <Button selected={tillToday} onClick={onToday} data-activity-calendar-today>
            Today
          </Button>
        </div>
      )}
    </Popover>
  );
}

/** From a day till a day, or till today, which moves along with the days. */
export function RangePicker({ range, today }: { range: DayRange; today: string }) {
  const { from, to } = rangeDays(range, today);
  const tillToday = !range.to || range.to >= today;
  const [open, setOpen] = useState<{ end: 'from' | 'till'; x: number; y: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const toggle = (end: 'from' | 'till') => (event: MouseEvent<HTMLButtonElement>) => {
    if (open?.end === end) {
      setOpen(null);
      return;
    }
    opener.current = event.currentTarget;
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    setOpen({ end, x: left, y: bottom + 4 });
  };
  const close = () => {
    setOpen(null);
    opener.current?.focus();
  };
  const apply = (next: DayRange) => {
    useActivity.getState().setRange(next);
    close();
  };

  return (
    <div ref={wrapper} className="flex flex-wrap items-center gap-2 text-ui" data-activity-range>
      <span className="text-muted">From</span>
      <Button icon={<CalendarDays size={13} aria-hidden />} aria-haspopup="dialog" aria-expanded={open?.end === 'from'} onClick={toggle('from')} data-activity-range-from>
        {dayLabel(from, today)}
      </Button>
      <span className="text-muted">till</span>
      <Button icon={<CalendarDays size={13} aria-hidden />} aria-haspopup="dialog" aria-expanded={open?.end === 'till'} onClick={toggle('till')} data-activity-range-till>
        {tillToday ? 'Today' : dayLabel(to, today)}
      </Button>
      <span className="text-meta text-faint">At most {ACTIVITY_MAX_DAYS} days.</span>
      {open && (
        <Calendar
          key={open.end}
          value={open.end === 'from' ? from : to}
          from={from}
          to={to}
          today={today}
          tillToday={tillToday}
          label={open.end === 'from' ? 'Pick the first day' : 'Pick the last day'}
          x={open.x}
          y={open.y}
          anchor={wrapper}
          onPick={(day) => apply(open.end === 'from' ? pickFrom(range, day, today) : pickTill(range, day, today))}
          onToday={open.end === 'till' ? () => apply(pickTill(range, null, today)) : undefined}
          onClose={close}
        />
      )}
    </div>
  );
}
