import { useSyncExternalStore } from 'react';

/** True while a media query matches, and kept up to date as the window or the device changes. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Wide enough for the sessions next to the open one, as on the computer (a tablet, a computer's browser). */
export const useWide = () => useMedia('(min-width: 768px)');

/** A mouse or trackpad: Enter sends, as in the desktop's message box. On a touch keyboard Enter starts a new line. */
export const useFinePointer = () => useMedia('(pointer: fine)');
