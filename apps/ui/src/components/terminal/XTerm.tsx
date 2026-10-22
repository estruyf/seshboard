import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Clipboard, Copy, MessageSquareText, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useThemes } from '../../state/themeStore.ts';
import { appKeyInTerminal, matches } from '../../lib/shortcuts.ts';
import { currentPlatform } from '../../lib/platform.ts';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { terminalPrompt } from './terminalPrompt.ts';
import { releaseWebglContexts } from './releaseWebgl.ts';
import { terminalFontFamily, type DetectedFont } from './terminalFont.ts';
import { mayUseWebgl, NO_LOSSES, recordLoss } from './webglPolicy.ts';

/** Fallbacks after the user's own terminal font: system monospace, then common Nerd Fonts for prompt glyphs. */
const FALLBACK_FONTS = '"SF Mono", ui-monospace, Menlo, "Symbols Nerd Font Mono", "MesloLGS NF", "Hack Nerd Font Mono", "JetBrainsMono Nerd Font Mono", monospace';

let userFont: Promise<DetectedFont> | undefined;

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
export function XTerm({ id, sessionId, active, exited, onClose }: { id: string; /** The session whose message box the Claude items fill; null for the window's own terminal. */ sessionId: string | null; active: boolean; exited: boolean; onClose: () => void }) {
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
  const [menu, setMenu] = useState<(ContextMenuPoint & { selection: string }) | null>(null);

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
      // A right-click keeps the selection it opens the menu on.
      rightClickSelectsWord: false,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')));
    term.open(host);
    host.dataset.renderer = 'dom';

    // WebGL only while the terminal is on screen. Every tab stays mounted, and each WebGL context counts against
    // Chromium's limit of 16 live ones: past it the oldest is dropped and that terminal would stay on the slower DOM
    // renderer for good. A hidden terminal draws nothing, so it gives its context back and asks for a new one when it shows.
    let webgl: WebglAddon | null = null;
    let webglHistory = NO_LOSSES;
    const unloadWebgl = () => {
      if (!webgl) return;
      const addon = webgl;
      webgl = null;
      // Disposing takes the canvases out of the host but leaves their contexts alive until garbage collection; free
      // them right after (the canvases are collected first, they are gone from the host afterwards).
      const canvases = [...host.querySelectorAll('canvas')];
      addon.dispose();
      releaseWebglContexts(canvases);
      host.dataset.renderer = 'dom';
    };
    const loadWebgl = () => {
      if (webgl || !mayUseWebgl(webglHistory)) return;
      let addon: WebglAddon | undefined;
      try {
        addon = new WebglAddon();
        const loaded = addon;
        // After a loss the terminal draws with the DOM renderer until it shows again, then tries once more (a few times at most).
        loaded.onContextLoss(() => {
          if (webgl !== loaded) return;
          webglHistory = recordLoss(webglHistory, Date.now());
          unloadWebgl();
        });
        term.loadAddon(loaded);
        webgl = loaded;
        host.dataset.renderer = 'webgl';
      } catch {
        // The DOM renderer is fine; WebGL is just faster. Counted like a loss, so a failing driver isn't tried on every show.
        webglHistory = recordLoss(webglHistory, Date.now());
        addon?.dispose();
      }
    };
    // A terminal that is on screen now loads WebGL right away; one that mounts hidden waits for the size observer below.
    let hidden = !host.offsetParent;
    if (!hidden) loadWebgl();
    termRef.current = term;
    fitRef.current = fit;

    // Use the font from the user's own terminal when we can find it (asked once per window).
    userFont ??= client.call('terminal.font', {}).then((r): DetectedFont => r, () => ({ fontFamily: null }));
    void userFont.then((font) => {
      if (termRef.current !== term || (!font.fontFamily && !font.fontFamilies?.length)) return;
      term.options.fontFamily = terminalFontFamily(font, FALLBACK_FONTS);
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
      // Shift+F10 and the menu key open the same menu as a right-click, at the terminal's top left.
      if (isContextMenuKey(event)) {
        if (event.type === 'keydown') setMenu({ ...contextMenuPoint(null, host.getBoundingClientRect(), window.innerHeight), selection: term.getSelection() });
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
    // The replay holds queries (background color, cursor position) that programs asked long ago. xterm answers them again,
    // and those answers must not reach the shell, which would show them as typed text.
    let replaying = false;
    const offData = client.on('terminal.data', (message) => {
      if (message.id === id) term.write(message.data);
    });
    void client
      .call('terminal.attach', { id })
      .then(({ replay }) => {
        if (disposed) return;
        replaying = true;
        term.write(replay, () => (replaying = false));
        // The replay may show the cursor again (a shell prompt does).
        if (exitedRef.current) term.write(HIDE_CURSOR);
        fit.fit();
        void client.call('terminal.resize', { id, cols: term.cols, rows: term.rows }).catch(() => {});
      })
      .catch((error: Error) => term.write(`\r\n\x1b[31m${error.message}\x1b[0m\r\n`));
    const input = term.onData((data) => {
      if (!replaying) void client.call('terminal.write', { id, data }).catch(() => {});
    });

    // Follow the panel's size; tell the process its new dimensions (debounced while dragging).
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (!host.offsetParent) {
        hidden = true;
        unloadWebgl();
        return;
      }
      fit.fit();
      // Without WebGL (it was given up, or its context was lost), xterm draws rows as text, spaced to fit each letter's
      // measured width. Rows drawn while the terminal was hidden (another tab, the panel closed) measured 0px letters
      // and came out spread wide; draw them all again now that letters measure. WebGL comes back first, after the fit.
      if (hidden) {
        hidden = false;
        loadWebgl();
        term.refresh(0, term.rows - 1);
      }
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
      // Disposing takes the WebGL canvas out of the host but leaves its context alive until garbage collection;
      // free it right after, or toggling the terminal fast runs into Chromium's limit on live contexts.
      const canvases = [...host.querySelectorAll('canvas')];
      webgl = null;
      term.dispose();
      releaseWebglContexts(canvases);
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

  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => {});
  const paste = () => void navigator.clipboard.readText().then((text) => text && termRef.current?.paste(text), () => {});
  const askClaude = (ask: 'explain' | 'fix', selection: string) => {
    if (sessionId) useDrafts.getState().requestQuote(sessionId, terminalPrompt(ask, selection), { plain: true });
  };
  const entries = (selection: string): MenuEntry[] => {
    const has = selection.trim().length > 0;
    return [
      { label: 'Copy', icon: <Copy size={14} />, disabled: !has, onSelect: () => copy(selection) },
      { label: 'Paste', icon: <Clipboard size={14} />, disabled: exited, onSelect: paste },
      { label: 'Select all', onSelect: () => termRef.current?.selectAll() },
      ...(sessionId
        ? ([
            'separator',
            { label: 'Explain with Claude', icon: <MessageSquareText size={14} />, disabled: !has, onSelect: () => askClaude('explain', selection) },
            { label: 'Fix with Claude', icon: <Wrench size={14} />, disabled: !has, onSelect: () => askClaude('fix', selection) },
          ] satisfies MenuEntry[])
        : []),
    ];
  };

  // The padding sits on a wrapper: the fit addon sizes the terminal to its parent's box and would count padding there as room.
  // `isolate`: xterm stacks its own layers with z-index (the WebGL addon's full-size link canvas is z-index 2); kept
  // inside the terminal, they can't cover anything the panel puts next to it.
  return (
    <>
      <div
        className="isolate h-full w-full px-4 py-2.5"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, above: event.clientY > window.innerHeight / 2, selection: termRef.current?.getSelection() ?? '' });
        }}
      >
        <div ref={hostRef} className="h-full w-full" data-terminal={id} />
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          above={menu.above}
          label="Terminal"
          entries={entries(menu.selection)}
          onClose={() => {
            setMenu(null);
            termRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
