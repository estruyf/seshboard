import type { RowStatus } from '../../state/sidebarRows.ts';

export const RAIL_TONE: Partial<Record<Exclude<RowStatus, null>, string>> = { 'needs-you': 'bg-warn', running: 'bg-accent-ink', unread: 'bg-unread' };

// On a filled row the rail is the fill's left edge, following its rounded corners. Without a fill
// those corners curve into nothing, so the rail is a short rounded bar of its own.
export function railShape(onFill: boolean): string {
  return onFill ? 'absolute inset-0 rounded-[inherit] [clip-path:inset(0_calc(100%-3px)_0_0)]' : 'absolute inset-y-[22%] left-0 w-[3px] rounded-full';
}
