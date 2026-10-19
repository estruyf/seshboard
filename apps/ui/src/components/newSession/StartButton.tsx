import { ListEnd, Repeat } from 'lucide-react';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import type { MenuEntry } from '../Menu.tsx';
import { SplitButton } from '../ui/SplitButton.tsx';
import type { StartAction, StartButtonState } from './startMenu.ts';

type DataHooks = Record<`data-${string}`, string | boolean>;

const ITEM_DATA: Record<StartAction, DataHooks> = {
  start: { 'data-start-session': true },
  queue: { 'data-queue-add': true },
  schedule: { 'data-schedule-add': true },
  'start-worktree': { 'data-start-worktree': true },
};

/**
 * Start with its menu, in New session and the palette's prompt step: the main part starts (⌘↵), the ▾
 * offers Start session, Add to queue (⌘⇧↵), Schedule… and Start in a new worktree. The keys work without the menu;
 * the message box (or the prompt step) handles them.
 */
export function StartButton({ state, onAction, data, itemData }: { state: StartButtonState; onAction(action: StartAction): void; data?: DataHooks; itemData?: Partial<Record<StartAction, DataHooks>> }) {
  const entries: MenuEntry[] = state.items.map((item) => ({
    label: item.label,
    icon: item.action === 'queue' ? <ListEnd size={14} /> : item.action === 'schedule' ? <Repeat size={14} /> : undefined,
    hint: item.shortcut ? formatKeys(keysFor(item.shortcut)) : undefined,
    disabled: item.disabled,
    onSelect: () => onAction(item.action),
    data: { ...ITEM_DATA[item.action], ...itemData?.[item.action] },
  }));
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
