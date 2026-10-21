import { create } from 'zustand';
import type { PipelineRunState } from '@switchboard/protocol/client';

// The sidebar's tree (#179) in this window: which parents are open (closed by default, not saved), and where the runs
// come from for code that orders the sidebar without React (⌃⇥, ⌘P). The rules are in `pipelineTree.ts`.

interface PipelineTreeState {
  /** Parents (sessions and run rows) whose sub-sessions show under them. */
  open: ReadonlySet<string>;
  setOpen(id: string, open: boolean): void;
  toggle(id: string): void;
}

export const usePipelineTree = create<PipelineTreeState>()((set) => ({
  open: new Set(),
  setOpen: (id, open) =>
    set((s) => {
      if (s.open.has(id) === open) return {};
      const next = new Set(s.open);
      if (open) next.add(id);
      else next.delete(id);
      return { open: next };
    }),
  toggle: (id) => usePipelineTree.getState().setOpen(id, !usePipelineTree.getState().open.has(id)),
}));

let source: () => Iterable<PipelineRunState> = () => [];

/** The runs the sidebar's order nests sub-sessions under. The pipelines store registers itself (`SidebarShell`). */
export const treeRuns = (): PipelineRunState[] => [...source()];

/** Where `treeRuns` reads from: kept apart so the ordering code stays free of the engine connection. */
export function provideTreeRuns(read: () => Iterable<PipelineRunState>): void {
  source = read;
}
