import { Check, ListEnd } from 'lucide-react';
import type { LaterItem, QueueWaitFor } from '@switchboard/protocol/client';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { contextMenuPoint, isContextMenuKey } from '../../lib/contextMenu.ts';
import { formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';
import { moveInQueue, removeFromQueue, setAutoStart, setWaitFor, startQueued, useLater } from '../../state/laterStore.ts';
import { autoStartBlock, busyInProject, moveTarget, promptLabel, queueSession, sameWait, type QueueEntry } from '../../state/queue.ts';
import { rowStatus } from '../../state/sidebarRows.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';

const dot = (tone: string) => <span className={`size-1.5 rounded-full ${tone}`} aria-hidden />;
const checked = <Check size={13} className="text-accent-ink" aria-hidden />;

/**
 * "Wait for…": any session in the project (the default), each busy session there, the item above (when there is
 * one) and nothing. The current choice has a check. New session uses it before the item exists.
 */
export function waitForEntries(options: { current: QueueWaitFor; busy: readonly SessionRowData[]; above: LaterItem | null; onPick(waitFor: QueueWaitFor): void }): MenuEntry[] {
  const { current, busy, above, onPick } = options;
  const choice = (label: string, waitFor: QueueWaitFor, icon: ReactNode, data: string): MenuEntry => ({
    label,
    icon: sameWait(current, waitFor) ? checked : icon,
    hint: sameWait(current, waitFor) ? 'current' : undefined,
    data: { 'data-queue-wait': data },
    onSelect: () => onPick(waitFor),
  });
  return [
    { heading: 'Wait for' },
    choice('Any session in this project', { kind: 'project' }, dot('bg-accent-ink'), 'project'),
    ...busy.map((row) =>
      choice(promptLabel(row.title || 'Untitled session', 40), { kind: 'session', sessionId: row.id }, dot(rowStatus(row) === 'needs-you' ? 'bg-warn' : 'bg-accent-ink'), `session:${row.id}`),
    ),
    ...(above ? [choice('The item above it', { kind: 'item', itemId: above.id }, <ListEnd size={13} aria-hidden />, 'item')] : []),
    choice('Nothing (start it myself)', { kind: 'none' }, null, 'none'),
  ];
}

/**
 * "Start by itself", the check item under "Wait for…": the item starts once what it waits for has finished cleanly.
 * Disabled, with the reason, while it waits for nothing or for a session Switchboard doesn't run.
 */
export function startByItself(item: LaterItem, rows: readonly SessionRowData[]): MenuEntry {
  const blocked = autoStartBlock(item.waitFor, { cwd: item.cwd, sessions: rows.map(queueSession), started: useLater.getState().started });
  return {
    label: 'Start by itself',
    checkbox: true,
    checked: item.autoStart && !blocked,
    disabledReason: blocked ?? undefined,
    data: { 'data-queue-menu-autostart': true },
    onSelect: () => void setAutoStart(item, !item.autoStart).catch(() => {}),
  };
}

type MenuState = { x: number; y: number; above?: boolean; entries: MenuEntry[]; label: string } | null;

export interface QueueMenus {
  /** The item's menu (right-click, ⇧F10, ⋯). */
  openMenu(at: { x: number; y: number; above?: boolean }, entry: QueueEntry): void;
  /** Keys on a focused item: ⌘↩ starts, ⌘E edits, ⌥↑ ⌥↓ ⌥⇧↑ move, ⌫ removes, ⇧F10 opens the menu. True when handled. */
  onKeyDown(event: KeyboardEvent<HTMLElement>, entry: QueueEntry): boolean;
  /** The menu; render once. */
  overlay: ReactNode;
}

/** Focuses an item again after it moved, in the list it was moved from (the sidebar or Home): the list re-renders it in its new place. */
export function refocusItem(id: string): void {
  const scope: ParentNode = document.activeElement?.closest('[data-home-queue], [data-session-list]') ?? document;
  requestAnimationFrame(() => requestAnimationFrame(() => scope.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(id)}"]`)?.focus({ preventScroll: false })));
}

/** The queue item's menu and keys, shared by the sidebar and Home. `rows`: the sessions the sidebar lists. */
export function useQueueMenu(rows: readonly SessionRowData[]): QueueMenus {
  const [menu, setMenu] = useState<MenuState>(null);
  const move = (item: LaterItem, to: -1 | 1 | 'top') => void moveInQueue(item, to).then(() => refocusItem(item.id), () => {});

  const openMenu: QueueMenus['openMenu'] = (at, entry) => {
    const { item } = entry;
    const ids = useLater.getState().items.map((i) => i.id);
    const index = ids.indexOf(item.id);
    const above = index > 0 ? useLater.getState().items[index - 1]! : null;
    const waitFor = () =>
      setMenu({
        ...at,
        label: 'Wait for',
        entries: waitForEntries({ current: item.waitFor, busy: busyInProject(rows, item.cwd), above, onPick: (next) => void setWaitFor(item, next).catch(() => {}) }),
      });
    setMenu({
      ...at,
      label: `Queued: ${promptLabel(item.prompt, 60)}`,
      entries: [
        { label: 'Start now', hint: formatKeys(keysFor('queue.start')), data: { 'data-queue-menu-start': true }, onSelect: () => void startQueued(item) },
        { label: 'Edit in New session…', hint: formatKeys(keysFor('queue.edit')), data: { 'data-queue-menu-edit': true }, onSelect: () => useLater.getState().use(item) },
        // Opens its own list where this menu was, as a submenu would.
        { label: 'Wait for…', hint: '›', data: { 'data-queue-menu-wait': true }, onSelect: () => requestAnimationFrame(waitFor) },
        startByItself(item, rows),
        { label: 'Move to top', hint: formatKeys(keysFor('queue.move-top')), disabled: moveTarget(ids, item.id, 'top') === null, onSelect: () => move(item, 'top') },
        { label: 'Move up', hint: '⌥↑', disabled: moveTarget(ids, item.id, -1) === null, data: { 'data-queue-menu-up': true }, onSelect: () => move(item, -1) },
        { label: 'Move down', hint: '⌥↓', disabled: moveTarget(ids, item.id, 1) === null, data: { 'data-queue-menu-down': true }, onSelect: () => move(item, 1) },
        'separator',
        { label: 'Remove', hint: formatKeys(keysFor('queue.remove')), danger: true, data: { 'data-queue-menu-remove': true }, onSelect: () => void removeFromQueue(item).catch(() => {}) },
      ],
    });
  };

  const onKeyDown: QueueMenus['onKeyDown'] = (event, entry) => {
    const native = event.nativeEvent;
    const { item } = entry;
    const handle = (fn: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      fn();
      return true;
    };
    if (isContextMenuKey(event)) {
      const at = contextMenuPoint(null, event.currentTarget.getBoundingClientRect(), window.innerHeight);
      return handle(() => openMenu(at, entry));
    }
    if (matches(native, 'queue.start')) return handle(() => void startQueued(item));
    if (matches(native, 'queue.edit')) return handle(() => useLater.getState().use(item));
    if (matches(native, 'queue.move-top')) return handle(() => move(item, 'top'));
    if (matches(native, 'queue.move')) return handle(() => move(item, event.key === 'ArrowUp' ? -1 : 1));
    if (matches(native, 'queue.remove')) return handle(() => void removeFromQueue(item).catch(() => {}));
    return false;
  };

  const overlay = menu && <Menu x={menu.x} y={menu.y} above={menu.above} entries={menu.entries} label={menu.label} width={250} onClose={() => setMenu(null)} />;
  return { openMenu, onKeyDown, overlay };
}
