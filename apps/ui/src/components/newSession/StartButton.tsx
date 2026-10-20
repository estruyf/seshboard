import type { Pipeline } from '@switchboard/protocol/client';
import { ListEnd, Repeat, Zap } from 'lucide-react';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import type { MenuEntry } from '../Menu.tsx';
import { SplitButton } from '../ui/SplitButton.tsx';
import { pipelineEntries, PipelineIcon } from '../pipelines/pipelineMenu.tsx';
import type { StartAction, StartButtonState } from './startMenu.ts';

type DataHooks = Record<`data-${string}`, string | boolean>;

const ITEM_DATA: Record<StartAction, DataHooks> = {
  start: { 'data-start-session': true },
  queue: { 'data-queue-add': true },
  schedule: { 'data-schedule-add': true },
  trigger: { 'data-trigger-add': true },
  pipeline: { 'data-run-pipeline-menu': true },
  'start-worktree': { 'data-start-worktree': true },
};

/**
 * Start with its menu, in New session and the palette's prompt step: the main part starts (⌘↵), the ▾
 * offers Start session, Add to queue (⌘⇧↵), Schedule…, Start when…, Run pipeline › and Start in a new worktree. The keys work
 * without the menu; the message box (or the prompt step) handles them. `pipelines`: what Run pipeline › lists, and what
 * picking one does.
 */
export function StartButton({
  state,
  onAction,
  data,
  itemData,
  pipelines,
}: {
  state: StartButtonState;
  onAction(action: StartAction): void;
  data?: DataHooks;
  itemData?: Partial<Record<StartAction, DataHooks>>;
  pipelines?: { list: readonly Pipeline[]; onRun(pipeline: Pipeline): void };
}) {
  const entryOf = (item: StartButtonState['items'][number]): MenuEntry => ({
    label: item.label,
    icon: item.action === 'queue' ? <ListEnd size={14} /> : item.action === 'schedule' ? <Repeat size={14} /> : item.action === 'trigger' ? <Zap size={14} /> : undefined,
    hint: item.shortcut ? formatKeys(keysFor(item.shortcut)) : undefined,
    disabled: item.disabled,
    onSelect: () => onAction(item.action),
    data: { ...ITEM_DATA[item.action], ...itemData?.[item.action] },
  });
  const entries: MenuEntry[] = state.items.flatMap((item): MenuEntry[] => {
    if (item.action !== 'pipeline') return [entryOf(item)];
    if (!pipelines) return [];
    const data = { ...ITEM_DATA.pipeline, ...itemData?.pipeline };
    // Without a task it can't run: the item says why rather than opening the list.
    if (item.disabled) return [{ label: item.label, icon: <PipelineIcon size={14} />, disabled: true, disabledReason: item.reason, onSelect: () => {}, data }];
    return [{ label: item.label, icon: <PipelineIcon size={14} />, submenu: pipelineEntries(pipelines.list, pipelines.onRun), data }];
  });
  // Starting is blocked but queueing isn't (the focus limit): the menu says why.
  if (state.disabled && !state.menuDisabled && state.reason) entries.push({ note: state.reason });
  return (
    <SplitButton
      onClick={() => onAction(state.main)}
      shortcut={state.sending ? undefined : (state.shortcut ?? undefined)}
      icon={state.main === 'queue' ? <ListEnd size={14} aria-hidden /> : state.main === 'schedule' ? <Repeat size={14} aria-hidden /> : undefined}
      disabled={state.disabled}
      reason={state.reason}
      entries={entries}
      menuDisabled={state.menuDisabled}
      menuLabel="More ways to start"
      data={data}
      menuData={{ 'data-start-menu': true }}
    >
      {state.label}
    </SplitButton>
  );
}
