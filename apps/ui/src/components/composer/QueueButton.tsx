import { ListEnd, Navigation, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import type { MenuEntry } from '../Menu.tsx';
import { SplitButton } from '../ui/SplitButton.tsx';
import type { QueueAction, QueueButtonState } from './queueButton.ts';

const ITEM_DATA: Record<QueueAction, Record<`data-${string}`, boolean>> = {
  queue: { 'data-queue-message': true },
  steer: { 'data-steer-message': true },
  'send-now': { 'data-send-now': true },
};

const ICON: Record<QueueAction, ReactNode> = { queue: <ListEnd size={14} />, steer: <Navigation size={14} />, 'send-now': <Zap size={14} /> };

/**
 * The message box's send button with its menu while Claude is working: the main part does what Enter does (Queue
 * or Steer), the ▾ lists Queue, Steer and Send now. The keys work without the menu; the message box handles them.
 */
export function QueueButton({ state, onAction }: { state: QueueButtonState; onAction(action: QueueAction): void }) {
  const entries: MenuEntry[] = state.items.map((item) => ({
    label: item.label,
    icon: ICON[item.action],
    hint: formatKeys(keysFor(item.shortcut)),
    disabled: item.disabled,
    onSelect: () => onAction(item.action),
    data: ITEM_DATA[item.action],
  }));
  entries.push({ note: 'Queue holds it in Up next until Claude finishes. Steer gives it to Claude now, and Claude reads it at its next step. Send now stops Claude first.' });
  return (
    <SplitButton
      onClick={() => onAction(state.items[0]!.action)}
      disabled={state.disabled}
      reason={state.reason}
      entries={entries}
      menuDisabled={state.disabled}
      menuLabel="More ways to send"
      menuWidth={300}
      data={{ 'data-composer-submit': true }}
      menuData={{ 'data-send-menu': true }}
    >
      {state.label}
    </SplitButton>
  );
}
