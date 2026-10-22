import type { MouseEvent } from 'react';

/** Where a menu opened from a button goes: at the pointer, or under the button when opened from the keyboard (no pointer position). */
export const menuPoint = (event: MouseEvent<HTMLElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.detail ? { x: event.clientX, y: event.clientY } : { x: rect.left, y: rect.bottom + 4 };
};
