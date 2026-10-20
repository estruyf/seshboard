import type { Pipeline } from '@switchboard/protocol/client';
import { ListTree } from 'lucide-react';
import { pipelinesFor } from '../../state/pipelines.ts';
import { openPipelinesSettings, runPipeline } from '../../state/pipelinesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast, useToasts } from '../../state/toastStore.ts';
import type { MenuEntry, SubmenuItem } from '../Menu.tsx';

// Run pipeline › (#179): the same entries in a session's ⋯ menu, its row's context menu and New session's Start ▾.

/** The pipeline icon beside a label, in the pipeline colour. */
export const PipelineIcon = ({ size = 13 }: { size?: number }) => <ListTree size={size} className="text-pipeline" aria-hidden />;

/** The entries of Run pipeline ›: the pipelines, a separator, then Edit pipelines…. */
export function pipelineEntries(pipelines: readonly Pipeline[], onPick: (pipeline: Pipeline) => void): MenuEntry[] {
  return [
    ...pipelines.map((pipeline): MenuEntry => ({ label: pipeline.name, onSelect: () => onPick(pipeline), data: { 'data-run-pipeline': pipeline.id } })),
    ...(pipelines.length ? ['separator' as const] : []),
    { label: 'Edit pipelines…', onSelect: () => openPipelinesSettings(null), data: { 'data-edit-pipelines': true } },
  ];
}

/** Run pipeline › for a session: the pipelines its project can run. Picking one runs it with the session as the parent. */
export function runPipelineSubmenu(pipelines: readonly Pipeline[], session: { id: string; projectRoot: string | null }): SubmenuItem {
  return {
    label: 'Run pipeline',
    icon: <PipelineIcon />,
    submenu: pipelineEntries(pipelinesFor(pipelines, session.projectRoot), (pipeline) => void runPipelineFrom(pipeline, session.id)),
    data: { 'data-run-pipeline-menu': true },
  };
}

/** Runs being started from a session, so a second pick of the same one does nothing while the first works. */
const starting = new Set<string>();

/**
 * Runs a pipeline with a session as the parent. Making the worktree can take seconds, so a toast says it is starting,
 * then that it started (with Open when the session isn't on screen). A failure is `runPipeline`'s toast.
 */
export async function runPipelineFrom(pipeline: Pick<Pipeline, 'id' | 'name'>, sessionId: string): Promise<void> {
  const key = `${pipeline.id}\n${sessionId}`;
  if (starting.has(key)) return;
  starting.add(key);
  const pending = toast(`Starting ${pipeline.name}…`, { durationMs: 120_000, data: { 'data-pipeline-starting-toast': true } });
  try {
    const state = await runPipeline({ pipelineId: pipeline.id, parentSessionId: sessionId });
    useToasts.getState().dismiss(pending);
    if (!state) return;
    const onScreen = useSessions.getState().selectedId === sessionId;
    toast(`Started ${pipeline.name}`, {
      tone: 'ok',
      actions: onScreen ? undefined : [{ label: 'Open', onSelect: () => useSessions.getState().select(sessionId) }],
      data: { 'data-pipeline-started-toast': true },
    });
  } finally {
    starting.delete(key);
    useToasts.getState().dismiss(pending);
  }
}
