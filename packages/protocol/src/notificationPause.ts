/**
 * Pause notifications (the menu bar's panel and its menu): no notifications or sounds for a while. The badge, the
 * Dock and the menu bar icon still show what needs you. Plain TypeScript, for main and the renderer.
 */

/** The choices, in the order the menus list them. */
export const NOTIFICATION_PAUSES = [
  { id: '1h', label: 'For 1 hour' },
  { id: '3h', label: 'For 3 hours' },
  { id: 'tomorrow', label: 'Until tomorrow' },
] as const;
export type NotificationPause = (typeof NOTIFICATION_PAUSES)[number]['id'];

/** The hour "Until tomorrow" ends at: the next morning. */
const MORNING_HOUR = 8;

/** When a pause picked at `now` ends (ms since epoch), in the computer's own time zone. */
export function pauseUntil(choice: NotificationPause, now: Date): number {
  if (choice === '1h') return now.getTime() + 3_600_000;
  if (choice === '3h') return now.getTime() + 3 * 3_600_000;
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, MORNING_HOUR);
  return morning.getTime();
}

/** Whether notifications are paused at `now`; a pause that ended counts as none. */
export const isPaused = (until: number | null, now: number): boolean => until !== null && until > now;
