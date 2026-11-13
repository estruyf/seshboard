import { PanelRight } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Badged } from '../ui/Badged.tsx';
import { RAIL_MENU, toggleRailTool, type RailToolId, type RailToolState } from './toolRail.ts';

/** One of the rail's buttons, as the session view resolves it. */
export interface RailButton {
  id: RailToolId;
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
 * open one behind it has an accent dot under its icon. Hide panel at the bottom closes whatever the side shows. A
 * right-click picks which tools show. ↑ ↓ move between the buttons.
 */
export function ToolRail({ items, onHide }: { items: readonly RailItem[]; onHide: (() => void) | null }) {
  const hidden = usePreferences((s) => s.prefs.railHidden);
  const update = usePreferences((s) => s.update);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState(0);
  const buttons = items.filter((item): item is RailButton => item !== 'divider');
  const tabStop = Math.min(focus, buttons.length);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-rail-button]')];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
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
    { label: 'Reset', data: { 'data-rail-menu-reset': true }, onSelect: () => update({ railHidden: [] }) },
  ];

  const button = (key: string, index: number, props: { label: string; ariaLabel: string; kbd?: string; pressed?: boolean; state?: RailToolState; icon: ReactNode; data?: Record<`data-${string}`, boolean | string>; onClick(): void }) => (
    <button
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
      className={`relative flex size-9 shrink-0 items-center justify-center rounded-[9px] ${props.state === 'front' ? 'bg-selected text-text' : 'text-muted hover:bg-border/50 hover:text-text'}`}
      {...props.data}
    >
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
          pressed: item.state === 'front',
          state: item.state,
          icon: <Badged icon={item.icon} count={item.count} dot={item.dot ? 'link' : false} ring="bg" data={{ 'data-rail-badge': true }} />,
          data: { ...item.data, 'data-rail-tool': item.id },
          onClick: item.onClick,
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
