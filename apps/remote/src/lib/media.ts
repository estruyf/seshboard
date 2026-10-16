import { useSyncExternalStore } from 'react';
import { FOLDABLE_QUERY, WIDE_QUERY } from './layout.ts';

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

/**
 * Wide enough, and tall enough, for the sessions next to the open one, as on the computer (a tablet, a computer's
 * browser). A phone in landscape is not (`lib/layout.ts`).
 */
export const useWide = () => useMedia(WIDE_QUERY);

/** Wide, but narrow enough that the sidebar can fold away into the drawer (an iPad in portrait). */
export const useFoldable = () => useMedia(FOLDABLE_QUERY);

/** A mouse or trackpad: Enter sends, as in the desktop's message box. On a touch keyboard Enter starts a new line. */
export const useFinePointer = () => useMedia('(pointer: fine)');

/** The reader asked for less motion: drawers and rows jump instead of sliding. */
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');
