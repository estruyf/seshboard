/** The room the pills row measures: each pill's width (with its preview button), and the pills that end the row. */
export interface PillRoom {
  /** The width the row has. */
  available: number;
  /** The space between two pills. */
  gap: number;
  /** The "N more" pill, at its widest. */
  more: number;
  /** The + pill that ends the row when every action has a pill. */
  end: number;
}

/**
 * How many actions get a pill above the message box: every one when they all fit (with the + after them), else as
 * many as fit before the "N more" pill, in order. Zero when not even one fits next to it.
 */
export function fitActionPills(widths: readonly number[], room: PillRoom): number {
  if (widths.length === 0) return 0;
  const all = widths.reduce((sum, w) => sum + w + room.gap, 0) + room.end;
  if (all <= room.available) return widths.length;
  let used = room.more;
  let count = 0;
  for (const width of widths) {
    used += width + room.gap;
    if (used > room.available) break;
    count++;
  }
  return count;
}

/** Splits the project's actions into the first `count`, shown as pills, and the rest, behind the "N more" pill. */
export function splitActionPills<T>(actions: readonly T[], count: number): { pills: T[]; more: T[] } {
  return { pills: actions.slice(0, count), more: actions.slice(count) };
}

/** The ids with `id` moved to index `to` of the list without it (what `dropIndex` and `moveTarget` give). */
export function moveActionId(ids: readonly string[], id: string, to: number): string[] {
  const rest = ids.filter((other) => other !== id);
  if (rest.length === ids.length) return [...ids];
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
  return rest;
}

export type ActionCommand = 'run' | 'edit' | 'delete';

/** One choice in a project action's context menu. */
export interface ActionContextItem {
  command: ActionCommand;
  label: string;
  danger?: boolean;
}

/** What right-clicking a project action offers: Run, Edit… and Delete…. */
export function actionContextItems(): ActionContextItem[] {
  return [
    { command: 'run', label: 'Run' },
    { command: 'edit', label: 'Edit…' },
    { command: 'delete', label: 'Delete…', danger: true },
  ];
}
