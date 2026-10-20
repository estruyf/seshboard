import { useMemo } from 'react';
import { currentRuns, useRuns } from './pipelinesStore.ts';
import { withPipelines } from './pipelineRows.ts';
import type { SessionRowData } from './sessionsStore.ts';

/** The rows with pipelines applied: sub-sessions under their parents, and the rows of runs without a session. */
export function usePipelineRows(rows: SessionRowData[]): SessionRowData[] {
  const runs = useRuns();
  return useMemo(() => withPipelines(rows, runs), [rows, runs]);
}

/** The same, read once (for keys and palette commands). */
export const currentPipelineRows = (rows: SessionRowData[]): SessionRowData[] => withPipelines(rows, currentRuns());
