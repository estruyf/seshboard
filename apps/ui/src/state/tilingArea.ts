import { create } from 'zustand';
import type { Size } from './tilingGeometry.ts';

/**
 * The size of the area the panes fill, set by the split view as it is measured. The sessions store reads it to
 * decide whether another pane fits; before it is measured (and in tests) there is no limit.
 */
export const useTilingArea = create<{ size: Size | null; set(size: Size | null): void }>()((set) => ({
  size: null,
  set: (size) => set((s) => (s.size && size && s.size.width === size.width && s.size.height === size.height ? {} : { size })),
}));
