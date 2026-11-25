import { Check, ChevronDown, Globe, Pencil, Play, Plus, Settings2, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { shortUrl, type ListedAction } from '@seshboard/protocol/client';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { actionContextItems, fitActionPills, splitActionPills, type ActionCommand } from './actionPills.ts';
import { matches } from '../../lib/shortcuts.ts';
import { moveTarget } from '../../state/queue.ts';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { ACTION_ICON, formatShortcut } from './useActions.ts';
import type { ActionsMenu } from './useActionsMenu.tsx';
import { useTerminals } from '../../state/terminalsStore.ts';
import { usePreviewAllowed, useWebPreview } from '../../state/webPreviewStore.ts';
import { terminalOffer } from '../webPreview/serverOffers.ts';

const MENU_WIDTH = 240;

/** What an action runs, for its tooltip. */
const whatItRuns = (action: ListedAction) => `${action.type === 'prompt' ? 'Ask Claude: ' : ''}${action.command}`;

const COMMAND_ICON: Record<ActionCommand, typeof Play> = { run: Play, edit: Pencil, delete: Trash2 };

/**
 * The project's actions as small pills above the message box, one click away: as many as fit in the row, in the order
 * you gave them, then "N more ▾" for the rest. With none yet, an "Add action" pill opens the editor. The same actions
 * are in the session header's ⋯ menu. In a narrow pane the pills show only their icon, so more of them fit.
 * Drag a pill, or press ⌥← ⌥→ on it, to move it; the order is kept for the project.
 * Right-click (or Shift+F10) on a pill, or on an action in "N more", opens Run, Edit… and Delete….
 */
export function ActionPills({ actions: menu }: { actions: ActionsMenu }) {
  const more = useMenu();
  /** The action whose context menu is open, and where. */
  const [context, setContext] = useState<{ action: ListedAction; at: ContextMenuPoint } | null>(null);
  const { openEditor, sessionId } = menu;
  const terminals = useTerminals((s) => s.terminals);
  // Settings › General › New sessions › Allow browser previews (or the browser) off: no Open preview.
  const allowed = usePreviewAllowed();
  /** The address of the server an action started in this session, while it runs. */
  const offerOf = (action: ListedAction) => {
    for (const terminal of terminals.values()) {
      const url = terminal.sessionId === sessionId && terminal.actionId === action.id ? terminalOffer(terminal) : null;
      if (url) return url;
    }
    return null;
  };
  const ids = menu.actions.map((a) => a.id);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const drag = useQueueDrag({ ids: () => idsRef.current, move: menu.move, mime: 'application/x-seshboard-action-pill', axis: 'x' });

  // How many pills fit: every pill is drawn once more, out of sight, to measure it (in this pane, so a narrow one
  // measures them icon only), and the row's width decides. Measured before paint, so the row never jumps.
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const offers = menu.actions.map((a) => (allowed ? offerOf(a) : null));
  const measured = menu.actions.map((a, i) => `${a.id}\0${a.name}\0${a.icon}\0${a.shortcut ?? ''}\0${offers[i] ? 1 : 0}`).join('\n');
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const widthOf = (el: Element | null) => el?.getBoundingClientRect().width ?? 0;
    const refit = () => {
      const widths = [...measure.querySelectorAll('[data-measure-pill]')].map(widthOf);
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      setFit(fitActionPills(widths, { available: row.clientWidth, gap, more: widthOf(measure.querySelector('[data-measure-more]')), end: widthOf(measure.querySelector('[data-measure-end]')) }));
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [measured]);

  // A session without a known project folder can't keep actions.
  if (!openEditor) return null;
  const { pills, more: rest } = splitActionPills(menu.actions, fit ?? menu.actions.length);

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
    if (matches(event.nativeEvent, 'actions.move') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const to = moveTarget(ids, action.id, event.key === 'ArrowLeft' ? -1 : 1);
      if (to === null) return;
      menu.move(action.id, to);
      // React moves the pill in the DOM, which can drop focus: keep it on the pill, or on "N more" when it went there.
      const row = event.currentTarget.closest('[data-action-pills]');
      requestAnimationFrame(() => (row?.querySelector<HTMLElement>(`[data-action-pill="${CSS.escape(action.id)}"]`) ?? row?.querySelector<HTMLElement>('[data-more-actions]'))?.focus());
      return;
    }
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

  /** A pill as the row draws it; the measuring copy leaves out the hooks and handlers. */
  const pillOf = (action: ListedAction, offer: string | null, live: boolean): ReactNode => {
    const Icon = ACTION_ICON[action.icon];
    const shortcut = action.shortcut ? formatShortcut(action.shortcut) : null;
    const mark = live ? drag.markFor(action.id) : null;
    return (
      <span key={action.id} className="relative flex min-w-0 items-center gap-0.5" {...(live ? {} : { 'data-measure-pill': action.id })}>
        <Pill
          icon={<Icon size={12} className="shrink-0" aria-hidden />}
          kbd={action.shortcut ?? undefined}
          onClick={live ? () => menu.run(action) : () => {}}
          {...(live
            ? {
                ...drag.props(action.id),
                onContextMenu: onPillContextMenu(action),
                onKeyDown: onPillKey(action),
                'data-action-pill': action.id,
                'data-tooltip': `${whatItRuns(action)}${shortcut ? ` (${shortcut})` : ''}`,
                'aria-label': action.name,
              }
            : { tabIndex: -1 })}
          // In a narrow pane only the icon shows.
          className={`max-w-44 @max-[860px]:px-2 ${live && drag.dragging === action.id ? 'opacity-50' : ''}`}
        >
          <span className="truncate @max-[860px]:sr-only">{action.name}</span>
        </Pill>
        {/* The action started a dev server: one click shows it beside the conversation. */}
        {offer && (
          <Pill
            ghost
            icon={<Globe size={12} aria-hidden />}
            onClick={live ? () => useWebPreview.getState().open(sessionId, offer) : () => {}}
            {...(live ? { 'data-tooltip': `Open preview of ${shortUrl(offer)}`, 'aria-label': `Open preview of ${shortUrl(offer)}`, 'data-action-preview': action.id } : { tabIndex: -1 })}
            className="px-1.5!"
          />
        )}
        {mark && <span aria-hidden className={`pointer-events-none absolute inset-y-0.5 w-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-left-[4px]' : '-right-[4px]'}`} data-action-pill-drop={mark} />}
      </span>
    );
  };

  return (
    <div ref={rowRef} role="group" aria-label="Project actions" className="relative flex min-w-24 flex-1 flex-wrap items-center gap-1.5" data-action-pills>
      {/* Every pill, "N more" at its widest and the +, out of sight: what `fitActionPills` measures. */}
      {/* Clipped to nothing, so the copy never makes the composer scroll sideways. */}
      <div aria-hidden inert className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={measureRef} className="flex w-max items-center gap-1.5">
          {menu.actions.map((action, i) => pillOf(action, offers[i] ?? null, false))}
          <Pill tone="muted" data-measure-more tabIndex={-1} onClick={() => {}}>
            {menu.actions.length} more
            <ChevronDown size={11} aria-hidden />
          </Pill>
          <Pill ghost data-measure-end tabIndex={-1} onClick={() => {}} className="px-1.5!">
            <Plus size={12} aria-hidden />
          </Pill>
        </div>
      </div>
      {/* Not `data-add-action`: the editor's own Add button has that hook. */}
      {menu.actions.length === 0 && (
        // Quiet until the composer area is hovered or focused: it is there when you look for it, not before.
        <Pill ghost icon={<Plus size={12} aria-hidden />} onClick={openEditor} data-tooltip="Add a command or prompt you run often" className="opacity-60 transition-opacity group-focus-within/composer:opacity-100 group-hover/composer:opacity-100 focus-visible:opacity-100" data-add-action-pill>
          Add action
        </Pill>
      )}
      {pills.map((action) => pillOf(action, offers[menu.actions.indexOf(action)] ?? null, true))}
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
          <Pill ghost onClick={openEditor} data-tooltip="Edit project actions" aria-label="Edit project actions" className="px-1.5!" data-edit-action-pills>
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
