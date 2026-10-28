import { Check, ChevronDown, Pencil, Play, Plus, Settings2, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ListedAction } from '@seshboard/protocol/client';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { actionContextItems, splitActionPills, type ActionCommand } from './actionPills.ts';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { ACTION_ICON, formatShortcut } from './useActions.ts';
import type { ActionsMenu } from './useActionsMenu.tsx';

const MENU_WIDTH = 240;

/** What an action runs, for its tooltip. */
const whatItRuns = (action: ListedAction) => `${action.type === 'prompt' ? 'Ask Claude: ' : ''}${action.command}`;

const COMMAND_ICON: Record<ActionCommand, typeof Play> = { run: Play, edit: Pencil, delete: Trash2 };

/**
 * The project's actions as small pills above the message box, one click away: up to three, then
 * "N more ▾" for the rest. With none yet, an "Add action" pill opens the editor. The same actions
 * are in the session header's ⋯ menu. In a narrow pane the pills show only their icon.
 * Right-click (or Shift+F10) on a pill, or on an action in "N more", opens Run, Edit… and Delete….
 */
export function ActionPills({ actions: menu }: { actions: ActionsMenu }) {
  const more = useMenu();
  /** The action whose context menu is open, and where. */
  const [context, setContext] = useState<{ action: ListedAction; at: ContextMenuPoint } | null>(null);
  const { openEditor } = menu;
  // A session without a known project folder can't keep actions.
  if (!openEditor) return null;
  const { pills, more: rest } = splitActionPills(menu.actions);

  const openContext = (action: ListedAction, at: ContextMenuPoint) => {
    more.close();
    setContext({ action, at });
  };
  const onPillContextMenu = (action: ListedAction) => (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    // A context menu opened from the keyboard reports no pointer position: open it at the pill.
    const pointer = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null;
    openContext(action, contextMenuPoint(pointer, event.currentTarget.getBoundingClientRect(), window.innerHeight));
  };
  const onPillKey = (action: ListedAction) => (event: KeyboardEvent<HTMLElement>) => {
    if (!isContextMenuKey(event)) return;
    event.preventDefault();
    openContext(action, contextMenuPoint(null, event.currentTarget.getBoundingClientRect(), window.innerHeight));
  };

  const contextEntries = (action: ListedAction): MenuEntry[] => {
    const handlers: Record<ActionCommand, () => void> = { run: () => menu.run(action), edit: () => menu.edit(action), delete: () => menu.askDelete(action) };
    return [
      { title: action.name, detail: whatItRuns(action) },
      ...actionContextItems().map((item) => {
        const Icon = COMMAND_ICON[item.command];
        return {
          label: item.label,
          icon: <Icon size={13} />,
          ...(item.danger ? { danger: true } : {}),
          onSelect: handlers[item.command],
          data: { 'data-action-menu-item': item.command },
        } satisfies MenuEntry;
      }),
    ];
  };

  const moreEntries: MenuEntry[] = [
    ...rest.map((a) => {
      const Icon = ACTION_ICON[a.icon];
      return {
        label: a.name,
        icon: <Icon size={13} />,
        ...(a.shortcut ? { hint: formatShortcut(a.shortcut) } : {}),
        onSelect: () => menu.run(a),
        contextMenu: (at) => openContext(a, at),
        data: { 'data-action': a.id, 'data-tooltip': whatItRuns(a) },
      } satisfies MenuEntry;
    }),
    'separator',
    { label: 'Edit actions…', icon: <Settings2 size={13} />, onSelect: openEditor, data: { 'data-edit-actions': true } },
  ];

  return (
    <div role="group" aria-label="Project actions" className="flex min-w-0 flex-wrap items-center gap-1.5" data-action-pills>
      {/* Not `data-add-action`: the editor's own Add button has that hook. */}
      {pills.length === 0 && (
        <Pill dashed icon={<Plus size={12} aria-hidden />} onClick={openEditor} data-tooltip="Add a command or prompt you run often" data-add-action-pill>
          Add action
        </Pill>
      )}
      {pills.map((action) => {
        const Icon = ACTION_ICON[action.icon];
        const shortcut = action.shortcut ? formatShortcut(action.shortcut) : null;
        return (
          <Pill
            key={action.id}
            icon={<Icon size={12} className="shrink-0" aria-hidden />}
            kbd={action.shortcut ?? undefined}
            onClick={() => menu.run(action)}
            onContextMenu={onPillContextMenu(action)}
            onKeyDown={onPillKey(action)}
            data-action-pill={action.id}
            data-tooltip={`${whatItRuns(action)}${shortcut ? ` (${shortcut})` : ''}`}
            aria-label={action.name}
            // In a narrow pane only the icon shows.
            className="max-w-44 @max-[860px]:px-2"
          >
            <span className="truncate @max-[860px]:sr-only">{action.name}</span>
          </Pill>
        );
      })}
      {rest.length > 0 ? (
        <Pill
          tone="muted"
          selected={more.at !== null}
          onClick={(e) => (more.at ? more.close() : more.openAbove(e.currentTarget))}
          data-more-actions
          aria-haspopup="menu"
          aria-expanded={more.at !== null}
          aria-label={`${rest.length} more project actions`}
        >
          {rest.length} more
          <ChevronDown size={11} aria-hidden />
        </Pill>
      ) : (
        pills.length > 0 && (
          <Pill dashed onClick={openEditor} data-tooltip="Edit project actions" aria-label="Edit project actions" className="px-1.5!" data-edit-action-pills>
            <Plus size={12} aria-hidden />
          </Pill>
        )
      )}
      {menu.status && (
        <Notice inline tone="success" icon={<Check size={12} aria-hidden />} data-action-status>
          {menu.status}
        </Notice>
      )}
      {more.at && <Menu x={more.at.x} y={more.at.y} width={MENU_WIDTH} above entries={moreEntries} onClose={more.close} label="More project actions" />}
      {context && (
        <Menu
          x={context.at.x}
          y={context.at.y}
          above={context.at.above}
          width={MENU_WIDTH}
          entries={contextEntries(context.action)}
          onClose={() => setContext(null)}
          label={context.action.name}
        />
      )}
    </div>
  );
}
