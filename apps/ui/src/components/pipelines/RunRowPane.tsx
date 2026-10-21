import { Ellipsis, ListTree } from 'lucide-react';
import { runProgress } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename } from '../../lib/format.ts';
import { runRowData } from '../../state/pipelineTree.ts';
import { usePipelines, writeInRun } from '../../state/pipelinesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Composer } from '../composer/Composer.tsx';
import { Button } from '../ui/Button.tsx';
import { paneHandle, paneHeader, type PaneProps } from '../computers/ComputerView.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { useSessionMenu } from '../sidebar/useSessionMenu.tsx';
import { PaneClose } from '../split/PaneClose.tsx';
import { TriggerOriginBar } from '../triggers/TriggerOriginBar.tsx';
import { StepTreeCard } from './StepTree.tsx';
import { PARENT_PLACEHOLDER } from './runView.ts';

const NO_COMMANDS: never[] = [];

/**
 * A run row's pane (#179): a run started from New session, which has no session of its own yet. Its header names the
 * run and where it is, then the step tree and a message box. What you write there starts the run's own session (with
 * the run's brief), which then opens in this pane.
 */
export function RunRowPane({ runId, pane }: { runId: string; pane: PaneProps }) {
  const state = usePipelines((s) => s.runs.get(runId) ?? null);
  const loaded = usePipelines((s) => s.loaded);
  const project = useProjects((s) => (state ? s.projects.get(state.run.projectRoot) : undefined));
  const connection = useEngineConnection();
  const handle = paneHandle(pane);
  const run = state?.run ?? null;
  const projectName = run ? (project?.name ?? basename(run.projectRoot)) : null;
  // The run row's menu, as in the sidebar: Open, Stop the run, Archive with its steps, Delete….
  const menus = useSessionMenu([]);
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-run-row={runId}>
      {menus.overlays}
      <header
        className={`drag flex h-13 shrink-0 items-center gap-3 overflow-hidden border-b border-border px-6 @max-[860px]:gap-2 @max-[860px]:px-4 ${pane.tiled && pane.active ? 'shadow-[inset_0_2px_0_var(--sb-accent)]' : ''}`}
        {...paneHeader(pane)}
      >
        {pane.leading && <SidebarToggle />}
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-pipeline/15 @max-[400px]:hidden">
          <ListTree size={14} className="text-pipeline" aria-hidden />
        </span>
        <div className={`min-w-24 flex-1 @max-[560px]:min-w-16 ${handle.className}`} data-pane-handle={handle['data-pane-handle']}>
          <h1 className="truncate text-body leading-snug font-semibold" data-tooltip={run?.title}>
            {run?.title ?? 'Pipeline run'}
          </h1>
          {run && (
            <p className="truncate text-meta text-muted" data-run-row-meta>
              Run · {runProgress(run)}
              {run.unattended && <span data-run-unattended> · without stopping for you</span>}
              <span className="@max-[860px]:hidden"> · {projectName}</span>
            </p>
          )}
        </div>
        {state && (
          <Button
            variant="quiet"
            iconOnly
            icon={<Ellipsis size={15} aria-hidden />}
            aria-label="Run options"
            data-tooltip="Run options"
            className="no-drag shrink-0"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              menus.openSessionMenu({ x: rect.left, y: rect.bottom + 4 }, runRowData(state));
            }}
            data-run-row-more
          />
        )}
        <PaneClose id={pane.id} tiled={pane.tiled} closeTooltip="Close and go Home (the run goes on)" />
      </header>
      {/* A trigger started it (#185): which, and the link to the run or issue. */}
      <TriggerOriginBar sessionId={runId} />
      {!state ? (
        <p className="p-8 text-center text-ui text-muted" role="status">
          {loaded ? 'This run is gone.' : 'Loading the run…'}
        </p>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-6 py-4 @max-[860px]:px-4">
              {state.run.task && (
                <div className="mb-3 flex justify-end">
                  <p className="max-w-[80%] rounded-xl border border-border bg-card px-3.5 py-2.5 text-body whitespace-pre-wrap [overflow-wrap:anywhere]" data-run-task>
                    {state.run.task}
                  </p>
                </div>
              )}
              <StepTreeCard state={state} />
            </div>
          </div>
          <div className="shrink-0 border-t border-border bg-bg">
            <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-2 px-6 pt-3 pb-3 @max-[860px]:px-4">
              {state.run.parentSessionId ? (
                // You wrote here already: the run has its own session now, where the conversation goes on.
                <p className="flex flex-wrap items-center justify-between gap-2 text-ui text-muted" data-run-row-adopted>
                  The run has its own session now.
                  <Button variant="primary" size="lg" onClick={() => useSessions.getState().select(state.run.parentSessionId!)}>
                    Open the session
                  </Button>
                </p>
              ) : (
              <Composer
                draftKey={runId}
                cwd={state.run.cwd}
                commands={NO_COMMANDS}
                placeholder={PARENT_PLACEHOLDER}
                links={{ sessionId: null, root: state.run.projectRoot }}
                disabledReason={connection.status !== 'connected' ? 'Connecting to the engine…' : null}
                onSubmit={async (text) => {
                  const sessionId = await writeInRun(runId, text);
                  if (!sessionId) return false;
                  useSessions.getState().select(sessionId);
                }}
              />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
