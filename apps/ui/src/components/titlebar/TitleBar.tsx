import { ArrowLeft, ArrowRight, MoreHorizontal, PanelLeft, PanelRight, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { currentPlatform } from '../../lib/platform.ts';
import { ariaKeysFor, formatKeys, keysFor, keysIfAny } from '../../lib/shortcuts.ts';
import { useLayout } from '../../state/layoutStore.ts';
import { goInHistory, useCanGoInHistory } from '../../state/navHistoryStore.ts';
import { useNavRailMenu } from '../../state/navRailStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useShownSidebar, useSidebar } from '../../state/sidebarStore.ts';
import { Menu } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { FIELD } from '../ui/fieldStyles.ts';
import { panelButton } from '../transcript/panelLauncher.ts';
import { openGoTo } from './windowActions.ts';

/** The quiet 28px icon buttons of the bar. */
const ICON = 'no-drag size-7!';

/**
 * The main window's title bar, 40px across the whole window: the traffic lights (macOS, out of full screen), Back and
 * Forward, a search field that opens Go to (⌘P), and the layout's buttons (the panel, the session's tools panel and
 * More). The bar drags the window; its controls don't. Pop-outs and the Quick start have none.
 */
export function TitleBar({ inert = false }: { inert?: boolean }) {
  const mac = currentPlatform() === 'darwin';
  const canBack = useCanGoInHistory(-1);
  const canForward = useCanGoInHistory(1);
  const panel = useShownSidebar().state;
  const toolsPanel = useLayout((s) => s.toolsPanel);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const backKeys = keysIfAny('nav.back');
  const forwardKeys = keysIfAny('nav.forward');
  const gotoKeys = formatKeys(keysFor('palette.goto'));
  const tools = toolsPanel ? panelButton(toolsPanel.shows) : null;

  return (
    <header className="drag flex h-10 shrink-0 items-center border-b border-border bg-chrome px-2 forced-colors:border-b" inert={inert} data-title-bar>
      <div className="flex w-60 shrink-0 items-center gap-0.5">
        {/* The traffic lights sit here (centred in the bar, `WINDOW_BUTTONS` in main); full screen hides them. */}
        {mac && <span aria-hidden className="w-[68px] shrink-0 full-screen:hidden" data-title-lights />}
        <Button variant="quiet" iconOnly icon={<ArrowLeft size={15} aria-hidden />} aria-label="Back" kbd={backKeys} disabled={!canBack} onClick={() => goInHistory(-1)} className={ICON} data-title-back />
        <Button variant="quiet" iconOnly icon={<ArrowRight size={15} aria-hidden />} aria-label="Forward" kbd={forwardKeys} disabled={!canForward} onClick={() => goInHistory(1)} className={ICON} data-title-forward />
      </div>
      {/* Looks like a field, works as a button: Go to is where you type. */}
      <button
        type="button"
        onClick={openGoTo}
        aria-label="Go to a session or project"
        aria-keyshortcuts={ariaKeysFor('palette.goto')}
        className={`${FIELD} no-drag mx-auto flex h-6.5 min-w-0 items-center gap-2 px-2.5 text-ui text-muted! hover:text-text!`}
        style={{ flex: '0 1 460px' }}
        data-title-search
      >
        <Search size={13} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">Search sessions and projects</span>
        <span aria-hidden className="shrink-0 text-meta text-faint">
          {gotoKeys}
        </span>
      </button>
      <div className="flex w-60 shrink-0 items-center justify-end gap-0.5">
        <Button
          variant="quiet"
          iconOnly
          icon={<PanelLeft size={15} aria-hidden />}
          aria-label="Panel"
          aria-pressed={panel === 'open'}
          selected={panel === 'open'}
          shortcut="sidebar.toggle"
          data-tooltip={`Panel (${formatKeys(keysFor('sidebar.toggle'))})`}
          onClick={() => useSidebar.getState().toggle()}
          className={ICON}
          data-sidebar-toggle={panel}
        />
        <Button
          variant="quiet"
          iconOnly
          icon={<PanelRight size={15} aria-hidden />}
          aria-label={tools?.label ?? 'Show panel'}
          aria-pressed={toolsPanel ? toolsPanel.shows : undefined}
          selected={toolsPanel?.shows ?? false}
          disabled={!toolsPanel}
          data-tooltip={tools?.label ?? 'No panel here'}
          onClick={() => useLayout.getState().toolsPanel?.toggle()}
          className={ICON}
          data-title-tools-panel={tools?.action ?? 'none'}
        />
        <Button
          ref={moreRef}
          variant="quiet"
          iconOnly
          icon={<MoreHorizontal size={15} aria-hidden />}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={more !== null}
          onClick={(event) => {
            if (more) return setMore(null);
            const rect = event.currentTarget.getBoundingClientRect();
            setMore({ x: rect.right - 220, y: rect.bottom + 4 });
          }}
          className={ICON}
          data-title-more
        />
      </div>
      {more && (
        <Menu
          x={more.x}
          y={more.y}
          label="More"
          anchor={moreRef}
          onClose={() => setMore(null)}
          entries={[
            { label: 'Customize the rail…', data: { 'data-title-customize-rail': true }, onSelect: () => useNavRailMenu.getState().open() },
            { label: 'Settings', hint: formatKeys(keysFor('settings')), onSelect: () => useSessions.getState().openSettings() },
          ]}
        />
      )}
    </header>
  );
}
