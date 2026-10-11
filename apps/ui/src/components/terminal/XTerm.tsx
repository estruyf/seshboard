import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useThemes } from '../../state/themeStore.ts';
import { appKeyInTerminal, matches } from '../../lib/shortcuts.ts';
import { currentPlatform } from '../../lib/platform.ts';

/** Fallbacks after the user's own terminal font: system monospace, then common Nerd Fonts for prompt glyphs. */
const FALLBACK_FONTS = '"SF Mono", ui-monospace, Menlo, "Symbols Nerd Font Mono", "MesloLGS NF", "Hack Nerd Font Mono", "JetBrainsMono Nerd Font Mono", monospace';

let userFont: Promise<string | null> | undefined;

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * Terminal colours from the active theme's dark mode (the panel is always dark, in light mode too):
 * its `terminal` colours where it has them, otherwise the panel's background, the dark text and
 * accent, and Demo Time's ANSI palette (see `resolveTerminal`).
 */
function terminalTheme(): ITheme {
  const { background, foreground, cursor, selection, ansi } = useThemes.getState().active.resolved.terminal;
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = ansi;
  return {
    background,
    foreground,
    cursor,
    cursorAccent: background,
    selectionBackground: selection,
    ...{ black, red, green, yellow, blue, magenta, cyan, white },
    ...{ brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite },
  };
}

/**
 * One terminal view. Attaching replays the terminal's recent output, so
 * switching tabs or sessions (or an engine reconnect) never loses history.
 */
export function XTerm({ id, active, exited, onClose }: { id: string; active: boolean; exited: boolean; onClose: () => void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Read from xterm's handlers, which are set up once per terminal.
  const exitedRef = useRef(exited);
  exitedRef.current = exited;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !client) return;
    const term = new Terminal({
      fontFamily: FALLBACK_FONTS,
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')));
    term.open(host);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // The DOM renderer is fine; WebGL is just faster.
    }
    termRef.current = term;
    fitRef.current = fit;

    // Use the font from the user's own terminal when we can find it (asked once per window).
    userFont ??= client.call('terminal.font', {}).then((r) => r.fontFamily, () => null);
    void userFont.then((font) => {
      if (!font || termRef.current !== term) return;
      term.options.fontFamily = `"${font.replace(/"/g, '')}", ${FALLBACK_FONTS}`;
      fit.fit();
    });

    // App shortcuts (⌘J, ⌘N, ⌘O…) must reach the window instead of the shell.
    term.attachCustomKeyEventHandler((event) => {
      // Nothing runs any more, so Escape closes the tab (as its × does).
      if (exitedRef.current && event.key === 'Escape') {
        if (event.type === 'keydown') onCloseRef.current();
        return false;
      }
      // ⌘K clears the screen and scrollback, as in Terminal and iTerm; the palette opens with ⌘⇧P here.
      // `data-cleared` counts the clears, for the smoke test (the WebGL renderer keeps the text out of the DOM).
      if (matches(event, 'terminal.clear')) {
        if (event.type === 'keydown') {
          term.clear();
          host.dataset.cleared = String(Number(host.dataset.cleared ?? 0) + 1);
        }
        return false;
      }
      // ⌃⇥ and ⌃⇧⇥ move between sessions, as everywhere else in the window; ⌃` hides the terminal, as in VS Code.
      if (matches(event, 'session.next') || matches(event, 'session.previous') || matches(event, 'terminal.toggle')) return false;
      if (currentPlatform() !== 'darwin') {
        // As in Windows Terminal: Ctrl+C copies what is selected (and stops the program when nothing is), Ctrl+V
        // and Ctrl+Shift+V paste through the browser (the shell would get ^V), Ctrl+Shift+C copies.
        const key = event.key.toLowerCase();
        const plainCtrl = event.ctrlKey && !event.altKey && !event.metaKey;
        if (plainCtrl && key === 'c' && (event.shiftKey || term.hasSelection())) {
          if (event.type === 'keydown') void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        if (plainCtrl && key === 'v') return false;
      }
      // The rest of the app's keys (⌘ on macOS, Ctrl+Shift elsewhere) go to the window; ⌘C, ⌘V and ⌘A stay here.
      return !(appKeyInTerminal(event) && !(currentPlatform() === 'darwin' && ['c', 'v', 'a'].includes(event.key.toLowerCase())));
    });

    let disposed = false;
    const offData = client.on('terminal.data', (message) => {
      if (message.id === id) term.write(message.data);
    });
    void client
      .call('terminal.attach', { id })
      .then(({ replay }) => {
        if (disposed) return;
        term.write(replay);
        // The replay may show the cursor again (a shell prompt does).
        if (exitedRef.current) term.write(HIDE_CURSOR);
        fit.fit();
        void client.call('terminal.resize', { id, cols: term.cols, rows: term.rows }).catch(() => {});
      })
      .catch((error: Error) => term.write(`\r\n\x1b[31m${error.message}\x1b[0m\r\n`));
    const input = term.onData((data) => void client.call('terminal.write', { id, data }).catch(() => {}));

    // Follow the panel's size; tell the process its new dimensions (debounced while dragging).
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (!host.offsetParent) return;
      fit.fit();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => void client.call('terminal.resize', { id, cols: term.cols, rows: term.rows }).catch(() => {}), 80);
    });
    observer.observe(host);

    // A new theme (or an edit to its file) recolours open terminals.
    const offTheme = useThemes.subscribe((state, previous) => {
      if (state.active !== previous.active) term.options.theme = terminalTheme();
    });

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      offTheme();
      input.dispose();
      offData();
      void client.call('terminal.detach', { id }).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [client, id]);

  // An exited terminal takes no input: hide the cursor so it doesn't look like it does. Restart shows it again.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.disableStdin = exited;
    term.write(exited ? HIDE_CURSOR : SHOW_CURSOR);
  }, [exited, client, id]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
  }, [active]);

  // The padding sits on a wrapper: the fit addon sizes the terminal to its parent's box and would count padding there as room.
  // `isolate`: xterm stacks its own layers with z-index (the WebGL addon's full-size link canvas is z-index 2); kept
  // inside the terminal, they can't cover anything the panel puts next to it.
  return (
    <div className="isolate h-full w-full px-4 py-2.5">
      <div ref={hostRef} className="h-full w-full" data-terminal={id} />
    </div>
  );
}
