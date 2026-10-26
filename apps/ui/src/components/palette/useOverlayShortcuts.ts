import { useEffect } from 'react';
import { matches } from '../../lib/shortcuts.ts';
import { otherModalOpen } from '../../lib/modalGuards.ts';
import { useOverlay } from '../../state/overlayStore.ts';

/**
 * The keys that open the command palette and the shortcuts sheet, and the menu bar's Help › Keyboard Shortcuts. The
 * main window and a pop-out both use it, so they open in the window the key was pressed in, with the same guards.
 */
export function useOverlayShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (matches(event, 'shortcuts')) {
        // From anywhere, the terminal and the message box included; a shortcut recorder that took the key
        // keeps it, and another dialog keeps the window until it closes.
        if (event.defaultPrevented || otherModalOpen()) return;
        event.preventDefault();
        useOverlay.getState().toggleShortcuts();
      } else if (matches(event, 'palette.commands')) {
        // In the terminal, ⌘K clears the screen as usual; ⌘⇧P (as in VS Code) is the way to the palette there.
        if (matches(event, 'terminal.clear') && (event.target as HTMLElement | null)?.closest?.('.xterm')) return;
        if (otherModalOpen()) return;
        event.preventDefault();
        useOverlay.getState().togglePalette('commands');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Help › Keyboard Shortcuts (⌘/) in the menu bar: it reaches the window in front.
  useEffect(() => window.seshboard?.onToggleShortcuts(() => !otherModalOpen() && useOverlay.getState().toggleShortcuts()), []);
}
