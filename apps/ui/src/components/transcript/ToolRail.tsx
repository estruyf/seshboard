import { PanelRight } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { matches } from '../../lib/shortcuts.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { RAIL_ORDER } from '@seshboard/protocol/bridge';
import { usePreferences } from '../../state/preferencesStore.ts';
import { AppIcon } from '../AppIcon.tsx';
import { GitHubIcon } from '../GitHubIcon.tsx';
import { useRightPanel } from '../../state/rightPanelStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { Badged } from '../ui/Badged.tsx';
import { moveRailButton, RAIL_GITHUB, RAIL_MENU, railGroup, sameRailGroup, stepRailButton, toggleRailApp, toggleRailTool, type RailAppId, type RailToolId, type RailToolState } from './toolRail.ts';

/** One of the rail's buttons, as the session view resolves it. */
export interface RailButton {
  id: RailToolId | RailAppId;
  icon: ReactNode;
  /** The tooltip: the name and what is there ("Changes · 3 files"). */
  label: string;
  /** The accessible name, with the badge in words ("Changes, 3 files"). */
  ariaLabel: string;
  /** The shortcut, as `formatKeys` writes it. */
  kbd?: string;
  count?: number;
  /** Something to look at without a count: an answer in Ask, a server running for the browser. */
  dot?: boolean;
  state: RailToolState;
  data: Record<`data-${string}`, boolean>;
  onClick(): void;
}

export type RailItem = RailButton | 'divider';

/**
 * The session's tools as a vertical toolbar at the right edge of its view (Changes, Terminal, Browser, Preview, Ask,
 * Agents, Commands and mods' panes). The tool in front has the selected fill and an accent mark on its left edge; an
 * open one behind it has an accent dot under its icon. Apps pinned from its menu (VS Code, Finder) come last, by their own
 * icons, and open the session's folder. Hide panel at the bottom closes whatever the side shows. A right-click picks
 * which tools and apps show. ↑ ↓ move between the buttons. Drag a button (or ⌥↑ ⌥↓ on it) to move it inside its group.
 */
export function ToolRail({ items, onHide }: { items: readonly RailItem[]; onHide: (() => void) | null }) {
  const hidden = usePreferences((s) => s.prefs.railHidden);
  const apps = usePreferences((s) => s.prefs.railApps);
  const editors = useHosts((s) => s.editors);
  const sizing = useRightPanel((s) => s.sizing);
  const update = usePreferences((s) => s.update);
  const order = usePreferences((s) => s.prefs.railOrder);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState(0);
  const buttons = items.filter((item): item is RailButton => item !== 'divider');
  const tabStop = Math.min(focus, buttons.length);
  const ids = useRef<RailButton['id'][]>([]);
  ids.current = buttons.map((b) => b.id);
  const move = (id: RailButton['id'], to: number) => update(moveRailButton(ids.current, id, to, { railOrder: order, railApps: apps }));
  const drag = useQueueDrag({
    ids: () => ids.current,
    move,
    mime: 'application/x-seshboard-rail-button',
    canDrop: (dragged, target) => sameRailGroup(dragged as RailButton['id'], target as RailButton['id']),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-rail-button]')];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const focused = (document.activeElement as HTMLElement | null)?.dataset.railTool as RailButton['id'] | undefined;
    if (matches(event.nativeEvent, 'rail.move')) {
      event.preventDefault();
      const to = focused ? stepRailButton(ids.current, focused, event.key === 'ArrowUp' ? -1 : 1) : null;
      if (focused && to !== null) {
        move(focused, to);
        // React moves the button in the DOM, which can drop focus: keep it on the button.
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tool-rail] [data-rail-tool="${CSS.escape(focused)}"]`)?.focus());
      }
      return;
    }
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      const rect = (document.activeElement as HTMLElement | null)?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
      setMenu({ x: rect.left - 236, y: rect.top });
      return;
    }
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : null;
    if (next === null || at === -1) return;
    event.preventDefault();
    const index = (next + all.length) % all.length;
    setFocus(index);
    all[index]?.focus();
  };
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenu({ x: Math.max(8, event.clientX - 236), y: event.clientY });
  };

  const entries: MenuEntry[] = [
    { heading: 'Tools' },
    ...RAIL_MENU.map(
      ({ tool, label }): MenuEntry => ({ label, checkbox: true, checked: !hidden.includes(tool), data: { 'data-rail-menu-tool': tool }, onSelect: () => update({ railHidden: toggleRailTool(hidden, tool) }) }),
    ),
    'separator',
    { heading: 'Open in' },
    ...editors.map(
      (editor): MenuEntry => ({
        label: editor.name,
        icon: <AppIcon editor={editor} size={14} />,
        checkbox: true,
        checked: apps.includes(editor.id),
        data: { 'data-rail-menu-app': editor.id },
        onSelect: () => update({ railApps: toggleRailApp(apps, editor.id) }),
      }),
    ),
    {
      label: 'GitHub',
      icon: <GitHubIcon size={13} />,
      checkbox: true,
      checked: apps.includes(RAIL_GITHUB),
      data: { 'data-rail-menu-app': RAIL_GITHUB, 'data-tooltip': "The folder's page on GitHub. It shows on the rail where the folder has a GitHub remote" },
      onSelect: () => update({ railApps: toggleRailApp(apps, RAIL_GITHUB) }),
    },
    'separator',
    // Every panel on the right at half the session area, kept as the window resizes; dragging its edge is Side again.
    { label: 'Panels at half width', checkbox: true, checked: sizing === 'half', data: { 'data-rail-menu-half': true }, onSelect: () => useRightPanel.getState().setSizing(sizing === 'half' ? 'side' : 'half') },
    'separator',
    { label: 'Reset', data: { 'data-rail-menu-reset': true }, onSelect: () => update({ railHidden: [], railApps: [], railOrder: [...RAIL_ORDER] }) },
  ];

  const button = (key: string, index: number, props: { label: string; ariaLabel: string; kbd?: string; pressed?: boolean; state?: RailToolState; icon: ReactNode; data?: Record<`data-${string}`, boolean | string>; onClick(): void; movable?: boolean }) => (
    <button
      {...(props.movable ? drag.props(key) : {})}
      key={key}
      type="button"
      tabIndex={index === tabStop ? 0 : -1}
      aria-label={props.kbd ? `${props.ariaLabel} (${props.kbd})` : props.ariaLabel}
      aria-pressed={props.pressed}
      data-tooltip={props.label}
      data-tooltip-kbd={props.kbd}
      data-tooltip-placement="left"
      data-rail-button
      data-rail-state={props.state}
      onFocus={() => setFocus(index)}
      onClick={props.onClick}
      className={`relative flex size-9 shrink-0 items-center justify-center rounded-[9px] ${props.state === 'front' ? 'bg-selected text-text' : 'text-muted hover:bg-border/50 hover:text-text'} ${drag.dragging === key ? 'opacity-50' : ''}`}
      {...props.data}
    >
      {drag.markFor(key) && <span aria-hidden className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent-ink ${drag.markFor(key) === 'before' ? '-top-[3px]' : '-bottom-[3px]'}`} data-rail-drop={drag.markFor(key)} />}
      {props.state === 'front' && <span aria-hidden className="absolute inset-y-[9px] -left-1.5 w-0.5 rounded-full bg-accent-ink" />}
      {props.icon}
      {props.state === 'behind' && <span aria-hidden className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent-ink" data-rail-behind />}
    </button>
  );

  let index = -1;
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-l border-border/40 bg-bg py-2.5"
      data-tool-rail
    >
      {items.map((item, i) => {
        if (item === 'divider') return <span key={`divider-${i}`} aria-hidden className="my-1 h-px w-5.5 shrink-0 bg-border" data-rail-divider />;
        index++;
        return button(item.id, index, {
          label: item.label,
          ariaLabel: item.ariaLabel,
          kbd: item.kbd,
          // An app opens elsewhere: a plain button, not a toggle.
          pressed: item.id.startsWith('app:') ? undefined : item.state === 'front',
          state: item.state,
          icon: <Badged icon={item.icon} count={item.count} dot={item.dot ? 'link' : false} ring="bg" data={{ 'data-rail-badge': true }} />,
          data: { ...item.data, 'data-rail-tool': item.id },
          onClick: item.onClick,
          movable: railGroup(item.id) !== null,
        });
      })}
      {onHide && (
        <>
          <span className="flex-1" aria-hidden />
          {button('hide', ++index, { label: 'Hide panel', ariaLabel: 'Hide panel', icon: <PanelRight size={17} aria-hidden />, data: { 'data-rail-hide': true }, onClick: onHide })}
        </>
      )}
      {menu && <Menu x={menu.x} y={menu.y} width={230} label="Tools" entries={entries} onClose={() => setMenu(null)} />}
    </div>
  );
}
