import { create } from 'zustand';

/**
 * The nav rail's Customize menu, opened from a right-click on the rail, from the title bar's More menu or from the
 * palette. `at` is where it shows; null while closed.
 */
export const useNavRailMenu = create<{ at: { x: number; y: number } | null; open(at?: { x: number; y: number }): void; close(): void }>()((set) => ({
  at: null,
  // From the title bar or the palette: beside the rail, near its top.
  open: (at) => set({ at: at ?? { x: 60, y: 52 } }),
  close: () => set({ at: null }),
}));
