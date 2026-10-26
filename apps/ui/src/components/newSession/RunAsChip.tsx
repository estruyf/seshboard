import type { Pipeline } from '@seshboard/protocol/client';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { lastPipelineIn } from '../../state/lastPipeline.ts';
import { pipelineMeta, runAsOrder } from '../../state/pipelines.ts';
import { openPipelinesSettings } from '../../state/pipelinesStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { PipelineIcon } from '../pipelines/pipelineMenu.tsx';
import { CHOICE_PILL } from './ChoiceMenu.tsx';

const MENU_WIDTH = 320;

/**
 * Run as, before New session's Start (#179): one session, or a pipeline with the prompt as its task. A picked pipeline
 * tints the chip, Start becomes Run pipeline, and its steps show under the box. `openRequest`: the steps line's Change
 * opens the menu from here. The pipeline last run in the project (`root`) is listed first.
 */
export function RunAsChip({
  pipelines,
  value,
  onChange,
  root,
  openRequest,
  disabled,
}: {
  pipelines: readonly Pipeline[];
  value: Pipeline | null;
  onChange(pipelineId: string | null): void;
  root: string | null;
  openRequest: number;
  disabled?: boolean;
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
    onChange(id);
    setAnnounce(`Start button: ${id ? 'Run pipeline' : 'Start'}`);
  };
  // Built only while the menu is open: the last used one is read then.
  const entries = (): MenuEntry[] => [
    { label: 'One session', hint: 'default', checked: value === null, onSelect: () => pick(null), data: { 'data-run-as-option': 'one' } },
    'separator',
    { heading: 'Run as a pipeline' },
    ...runAsOrder(pipelines, lastPipelineIn(root)).map(
      (pipeline): MenuEntry => ({ label: pipeline.name, detail: pipelineMeta(pipeline), checked: value?.id === pipeline.id, onSelect: () => pick(pipeline.id), data: { 'data-run-as-option': pipeline.id } }),
    ),
    'separator',
    { label: 'Edit pipelines…', onSelect: () => openPipelinesSettings(null), data: { 'data-edit-pipelines': true } },
  ];
  const label = value?.name ?? 'One session';
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        aria-label={`Run as: ${label}`}
        data-tooltip={value ? `Run as ${value.name}` : 'Run as one session, or pick a pipeline'}
        data-run-as={value?.id ?? 'one'}
        disabled={disabled}
        onClick={() => (menu.at ? menu.close() : open())}
        className={`${CHOICE_PILL} shrink-0 ${value ? 'border border-pipeline/40 bg-pipeline/10 text-text hover:bg-pipeline/15' : ''} ${menu.at ? 'bg-border/50 text-text' : ''}`}
      >
        <PipelineIcon />
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
