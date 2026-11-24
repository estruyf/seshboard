import type { Pipeline } from '@seshboard/protocol/client';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { lastPipelineIn } from '../../state/lastPipeline.ts';
import { pipelineMeta, runAsOrder } from '../../state/pipelines.ts';
import { openPipelinesSettings } from '../../state/pipelinesStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { OrchestratorIcon } from '../orchestrator/OrchestratorOverview.tsx';
import { PipelineIcon } from '../pipelines/pipelineMenu.tsx';
import { CHOICE_PILL } from './ChoiceMenu.tsx';

const MENU_WIDTH = 320;

/** What Run as lists of a pipeline: this computer's, or one another computer can run (`RemotePipeline`). */
export type RunAsPipeline = Pick<Pipeline, 'id' | 'name' | 'builtIn' | 'steps'>;

/**
 * Run as, before New session's Start (#179): one session, or a pipeline with the prompt as its task. A picked pipeline
 * tints the chip, Start becomes Run pipeline, and its steps show under the box. `openRequest`: the steps line's Change
 * opens the menu from here. The pipeline last run in the project (`root`, or another computer's `remoteProjectKey`) is
 * listed first. Another computer's pipelines (`editable` false) are edited there, so the menu has no Edit pipelines.
 */
export function RunAsChip({
  pipelines,
  value,
  onChange,
  root,
  openRequest,
  disabled,
  editable = true,
  orchestrator,
  noPipelines,
}: {
  pipelines: readonly RunAsPipeline[];
  value: RunAsPipeline | null;
  onChange(pipelineId: string | null): void;
  root: string | null;
  openRequest: number;
  disabled?: boolean;
  editable?: boolean;
  /**
   * Orchestrator (docs/orchestrator.md) as a third choice: the session hands the tasks to sessions it starts. Left out
   * where it can't be one (a question, another computer without `REMOTE_FEATURE_ORCHESTRATOR`).
   */
  orchestrator?: { on: boolean; onChange(on: boolean): void };
  /** Why no pipeline can be picked (another provider has none yet); Orchestrator and One session still can. */
  noPipelines?: string;
}) {
  const menu = useMenu();
  const [above, setAbove] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  /** Said once a choice changes what Start does; empty until then, so nothing is read out on load. */
  const [announce, setAnnounce] = useState('');

  const open = () => {
    const el = button.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Opens upward when the chip sits near the bottom of the window, lined up with the chip's right edge.
    const up = window.innerHeight - rect.bottom < 300;
    setAbove(up);
    menu.openAt(Math.max(8, rect.right - MENU_WIDTH), up ? rect.top - 6 : rect.bottom + 6);
  };
  const handled = useRef(openRequest);
  useEffect(() => {
    if (openRequest === handled.current) return;
    handled.current = openRequest;
    open();
  }, [openRequest]);

  const pick = (id: string | null) => {
    orchestrator?.onChange(false);
    onChange(id);
    setAnnounce(`Start button: ${id ? 'Run pipeline' : 'Start'}`);
  };
  const orchestrate = () => {
    onChange(null);
    orchestrator?.onChange(true);
    setAnnounce('Start button: Start orchestrator');
  };
  const orchestrating = orchestrator?.on === true;
  // Built only while the menu is open: the last used one is read then.
  const entries = (): MenuEntry[] => [
    { label: 'One session', hint: 'default', checked: value === null && !orchestrating, onSelect: () => pick(null), data: { 'data-run-as-option': 'one' } },
    ...(orchestrator
      ? ([{ label: 'Orchestrator', detail: 'Hands your tasks to sessions it starts and tracks them', checked: orchestrating, onSelect: orchestrate, data: { 'data-run-as-option': 'orchestrator' } }] satisfies MenuEntry[])
      : []),
    ...(pipelines.length
      ? ([
          'separator',
          { heading: 'Run as a pipeline' },
          ...runAsOrder(pipelines, lastPipelineIn(root)).map(
            (pipeline): MenuEntry => ({
              label: pipeline.name,
              detail: pipelineMeta(pipeline),
              checked: value?.id === pipeline.id,
              ...(noPipelines ? { disabledReason: noPipelines } : {}),
              onSelect: () => pick(pipeline.id),
              data: { 'data-run-as-option': pipeline.id },
            }),
          ),
        ] satisfies MenuEntry[])
      : []),
    ...(editable ? (['separator', { label: 'Edit pipelines…', onSelect: () => openPipelinesSettings(null), data: { 'data-edit-pipelines': true } }] satisfies MenuEntry[]) : []),
  ];
  const label = orchestrating ? 'Orchestrator' : (value?.name ?? 'One session');
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        aria-label={`Run as: ${label}`}
        data-tooltip={orchestrating ? 'Run as the project’s orchestrator' : value ? `Run as ${value.name}` : orchestrator ? 'Run as one session, an orchestrator or a pipeline' : 'Run as one session, or pick a pipeline'}
        data-run-as={orchestrating ? 'orchestrator' : (value?.id ?? 'one')}
        disabled={disabled}
        onClick={() => (menu.at ? menu.close() : open())}
        className={`${CHOICE_PILL} shrink-0 ${value || orchestrating ? 'border border-pipeline/40 bg-pipeline/10 text-text hover:bg-pipeline/15' : ''} ${menu.at ? 'bg-border/50 text-text' : ''}`}
      >
        {orchestrating ? <OrchestratorIcon /> : <PipelineIcon />}
        <span className="max-w-[150px] truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} above={above} width={MENU_WIDTH} entries={entries()} label="Run as" anchor={button} onClose={menu.close} />}
    </>
  );
}
