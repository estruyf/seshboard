import { ChevronDown, ChevronRight, Folder, Maximize2, Minimize2, PanelBottom, PanelRight, Plus, RotateCcw, Sparkles, Square, SquareTerminal, Timer, X } from 'lucide-react';
import { useEffect, useId, useMemo, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { TerminalInfo, TerminalKind } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, tildify } from '../../lib/format.ts';
import { ENGINE_RESTARTED, openTerminal, restartTerminal, useTerminals } from '../../state/terminalsStore.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { useTicker } from '../transcript/ActivityGroup.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { APP_TERMINAL } from './appTerminal.ts';
import { maxBottomHeight, maxRightWidth, PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, PANEL_MAX_HEIGHT_SHARE, PANEL_MAX_WIDTH_SHARE, panelSizeForKey, type RightBlocked, type TerminalDock } from './terminalLayout.ts';
import { actionCommand, elapsedLabel, runStatus, tabStatus, type RunTimes } from './terminalStatus.ts';
import { XTerm } from './XTerm.tsx';
import { formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';

/**
 * Terminals for one session: login shells in its folder, project actions, and the Claude Code TUI
 * (opened from the ⋯ menu). Toggle with ⌘J, maximize with ⌘⇧J; opening it on a session without
 * terminals starts a shell. Docked below the conversation, or on the right (`dock`, already resolved
 * by the caller). On the right next to Changes, Ask or Agents it is one of their tabs (`tabs`) and shares their width.
 *
 * Without a session it is the window's own terminal, the one ⌘J opens on Home, a project's page and the
 * other views: shells only, each tab named after its folder since they can start in different ones.
 */
export function TerminalPanel({
  sessionId,
  cwd,
  projectRoot,
  home,
  dock,
  rightBlocked,
  viewWidth,
  viewHeight = null,
  tabs,
  shared,
}: {
  /** Null: the window's own terminal. */
  sessionId: string | null;
  /** Where a new tab starts. For the window's terminal, null is the home folder. */
  cwd: string | null;
  projectRoot: string | null;
  home: string | null;
  dock: TerminalDock;
  /** Why the panel can't dock on the right now (the Changes panel is there, or the view is too narrow). */
  rightBlocked: RightBlocked;
  /** The session view's width: docked right, the conversation keeps its minimum next to the panel. */
  viewWidth: number | null;
  /** The session view's height: docked below, the conversation keeps its minimum next to the panel. */
  viewHeight?: number | null;
  /** Another panel is open on the right too: this row of tabs stands in for the panel's top, with its buttons on the right. */
  tabs?: (actions: ReactNode) => ReactNode;
  /** As a tab, the width of the right side, which all its tabs share. */
  shared?: { width: number; setWidth(width: number): void };
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  // The store keeps each panel under its owner: the session, or the window.
  const app = sessionId === null;
  const owner = sessionId ?? APP_TERMINAL;
  const canOpen = app || cwd !== null;
  const all = useTerminals((s) => s.terminals);
  const runs = useTerminals((s) => s.runs);
  // Docked below in a short view (a stacked pane), the conversation keeps its minimum height: the same limit as the width.
  const maxHeight = Math.min(maxBottomHeight(viewHeight), Math.floor(window.innerHeight * PANEL_MAX_HEIGHT_SHARE));
  const height = Math.min(useTerminals((s) => s.panelHeight), maxHeight);
  const storeHeight = useTerminals((s) => s.setPanelHeight);
  const setHeight = (next: number) => storeHeight(Math.min(next, maxHeight));
  // A width dragged out in a wider window is kept, and shown as wide as this view allows.
  const maxWidth = Math.min(maxRightWidth(viewWidth), Math.floor(window.innerWidth * PANEL_MAX_WIDTH_SHARE));
  const ownWidth = Math.min(useTerminals((s) => s.panelWidth), maxWidth);
  const storeWidth = useTerminals((s) => s.setPanelWidth);
  const width = shared ? Math.min(shared.width, maxWidth) : ownWidth;
  const setWidth = (next: number) => (shared ? shared.setWidth : storeWidth)(Math.min(next, maxWidth));
  const setDock = useTerminals((s) => s.setDock);
  const maximized = useTerminals((s) => s.maximizedFor.has(owner));
  const setMaximized = (next?: boolean) => useTerminals.getState().setMaximized(owner, next);
  const activeId = useTerminals((s) => s.active.get(owner));
  const setActive = useTerminals((s) => s.setActive);
  const togglePanel = (open?: boolean) => useTerminals.getState().togglePanel(owner, open);
  const loaded = useTerminals((s) => s.loaded);
  const shellWanted = useTerminals((s) => s.shellWanted === owner);
  const notice = useTerminals((s) => s.notices.get(owner) ?? null);
  const setNotice = useTerminals((s) => s.setNotice);
  const setError = (message: string) => setNotice(owner, { code: null, message });
  const blocked = notice?.code === 'SESSION_RUNNING_HERE' || notice?.code === 'SESSION_BUSY_ELSEWHERE' ? notice : null;
  const idPrefix = useId();
  const tabId = (t: TerminalInfo) => `${idPrefix}-tab-${t.id}`;
  const panelId = (t: TerminalInfo) => `${idPrefix}-panel-${t.id}`;
  const right = dock === 'right';

  const terminals = useMemo(() => [...all.values()].filter((t) => t.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt), [all, sessionId]);
  const active = terminals.find((t) => t.id === activeId) ?? terminals.at(-1);

  // The run strip shows the action's command from its definition; look again whenever another action tab comes up (it may have been edited).
  const { actions, reload: reloadActions } = useProjectActionList(projectRoot);
  const activeAction = active?.kind === 'action' ? active.id : null;
  useEffect(() => {
    if (activeAction) reloadActions();
  }, [activeAction, reloadActions]);

  const open = async (kind: TerminalKind, extra: { fork?: boolean } = {}) => {
    if (client && canOpen) await openTerminal(client, owner, cwd, kind, extra.fork ?? false);
  };

  // Opening the panel (Terminal button, ⌘J) on a session without terminals starts a shell right away.
  // The flag is read from the store, not the render: StrictMode runs this effect twice before the reset re-renders, and the second run must not open another shell.
  useEffect(() => {
    if (!shellWanted || !loaded || !client) return;
    const store = useTerminals.getState();
    if (store.shellWanted !== owner) return;
    store.clearShellWanted();
    if (terminals.length === 0 && canOpen) void openTerminal(client, owner, cwd, 'shell');
  }, [shellWanted, loaded, client, terminals.length, cwd, canOpen, owner]);

  const stopAndOpen = async () => {
    if (!client || !sessionId) return;
    await client.call('session.close', { sessionId });
    // Let the process leave before Claude Code opens the session again.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await open('claude');
  };

  /** Closing the last tab hides the panel too; the next ⌘J starts a fresh shell. */
  const closeTab = (terminal: TerminalInfo) => {
    void client?.call('terminal.close', { id: terminal.id });
    if (terminals.length === 1) togglePanel(false);
  };

  const stop = (terminal: TerminalInfo) => client?.call('terminal.stop', { id: terminal.id }).catch((e: Error) => setError(`Couldn't stop it: ${e.message}`));

  /** Runs an action again in its own tab (the engine checks it is still approved). A running one is stopped first. */
  const restart = async (terminal: TerminalInfo) => {
    if (!client) return;
    setNotice(owner, null);
    try {
      await restartTerminal(client, terminal);
    } catch (e) {
      setError(`Couldn't restart it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Drag the handle to resize: the top edge below the conversation, the left edge on the right.
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const start = right ? event.clientX : event.clientY;
    const startSize = right ? width : height;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => (right ? setWidth(startSize + (start - e.clientX)) : setHeight(startSize + (start - e.clientY)));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  // The same from the keyboard: ↑ ↓ below, ← → on the right.
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = panelSizeForKey(dock, event.key, right ? width : height, { width: window.innerWidth, height: window.innerHeight });
    if (next === null) return;
    event.preventDefault();
    if (right) setWidth(next);
    else setHeight(next);
  };

  // ← → Home End move between tabs and show the one they land on, as in any tab bar.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = terminals.findIndex((t) => t.id === active?.id);
    if (index < 0) return;
    const next =
      event.key === 'ArrowRight' ? (index + 1) % terminals.length : event.key === 'ArrowLeft' ? (index - 1 + terminals.length) % terminals.length : event.key === 'Home' ? 0 : event.key === 'End' ? terminals.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = terminals[next]!;
    setActive(owner, target.id);
    document.getElementById(tabId(target))?.focus();
  };

  // Esc restores a maximized panel from its tabs, strip and buttons. Inside a terminal, Esc belongs to the program
  // running there (Claude Code, vim); an exited one closes its tab on Esc instead.
  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!matches(event.nativeEvent, 'terminal.restore') || !maximized || event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest('.xterm')) return;
    event.preventDefault();
    setMaximized(false);
  };

  // Dock, maximize and hide: at the end of the panel's top row, or as a tab, in the right side's row of tabs.
  const buttons = (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon={right ? <PanelBottom size={13} aria-hidden /> : <PanelRight size={13} aria-hidden />}
        onClick={() => {
          setDock(right ? 'bottom' : 'right');
          setMaximized(false);
        }}
        // While the right side isn't free the terminal waits below; the tooltip says why.
        disabled={!right && rightBlocked !== null}
        aria-label={right ? 'Dock below' : 'Dock right'}
        data-tooltip={
          right ? 'Dock below' : rightBlocked === 'changes' ? 'Close Changes to dock the terminal on the right' : rightBlocked === 'ask' ? 'Close Ask to dock the terminal on the right' : rightBlocked === 'agents' ? 'Close Agents to dock the terminal on the right' : rightBlocked === 'narrow' ? 'Too narrow to dock on the right: widen the window' : 'Dock right'
        }
        data-terminal-dock={dock}
      />
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon={maximized ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
        shortcut="terminal.maximize"
        selected={maximized}
        aria-pressed={maximized}
        onClick={() => setMaximized()}
        aria-label={maximized ? 'Restore terminal' : 'Maximize terminal'}
        data-terminal-maximize
      />
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon={right ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        shortcut="terminal.toggle"
        onClick={() => togglePanel(false)}
        aria-label="Hide terminal"
        data-terminal-hide
      />
    </div>
  );

  const size = maximized ? undefined : right ? { width } : { height };
  return (
    <section
      aria-label="Terminal"
      onKeyDown={onPanelKey}
      className={`relative flex min-h-0 min-w-0 flex-col ${tabs ? 'bg-bg' : 'theme-dark @container/terminal bg-terminal text-text'} ${
        maximized ? 'flex-1' : tabs ? 'shrink-0 border-l border-border' : right ? 'shrink-0 border-l border-border terminal-edge-left' : 'shrink-0 border-t border-border terminal-edge-top'
      }`}
      style={size}
      data-terminal-panel
      data-terminal-owner={app ? 'app' : 'session'}
      data-terminal-dock-side={dock}
      data-terminal-maximized={maximized || undefined}
    >
      {!maximized && (
        // A wide strip to grab, with a visible pill in the middle of the edge.
        <div
          role="separator"
          aria-orientation={right ? 'vertical' : 'horizontal'}
          aria-label={right ? 'Terminal width' : 'Terminal height'}
          aria-valuenow={right ? width : height}
          aria-valuemin={right ? PANEL_MIN_WIDTH : PANEL_MIN_HEIGHT}
          aria-valuemax={right ? maxWidth : maxHeight}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          className={`group absolute z-10 flex items-center justify-center outline-none ${right ? 'inset-y-0 -left-1 w-2.5 cursor-col-resize' : 'inset-x-0 -top-1 h-2.5 cursor-row-resize'}`}
          data-tooltip={right ? 'Drag (or use ← →) to resize' : 'Drag (or use ↑ ↓) to resize'}
          data-terminal-resize
        >
          <span
            aria-hidden
            className={`rounded-full bg-faint/60 transition-colors group-hover:bg-muted group-focus-visible:bg-accent-ink ${right ? 'h-9 w-1' : 'h-1 w-9'}`}
          />
        </div>
      )}

      {tabs?.(buttons)}
      {/* As a tab, the terminal's own part stays dark under the right side's row of tabs. */}
      <div className={tabs ? 'theme-dark @container/terminal flex min-h-0 flex-1 flex-col bg-terminal text-text' : 'contents'}>
        <div className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-2">
          {/* Tabs, then + right after the last one; they scroll sideways when there are many. */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {terminals.length > 0 && (
              <div role="tablist" aria-label="Terminal tabs" onKeyDown={onTabKey} className="flex shrink-0 items-center gap-0.5">
                {terminals.map((t) => {
                  const selected = t.id === active?.id;
                  const status = tabStatus(t);
                  const label = app ? folderLabel(t.cwd, home) : t.title;
                  return (
                    <div
                      key={t.id}
                      className={`group flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2.5 text-ui ${selected ? 'bg-selected text-text' : 'text-muted hover:bg-border/45 hover:text-text'}`}
                      data-terminal-tab={t.kind}
                    >
                      <button
                        type="button"
                        role="tab"
                        id={tabId(t)}
                        aria-selected={selected}
                        aria-controls={panelId(t)}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setActive(owner, t.id)}
                        className="flex max-w-56 min-w-0 items-center gap-1.5 outline-none"
                        data-tooltip={t.exitCode !== null ? `Exited with code ${t.exitCode}. Esc in the terminal closes it.` : app ? tildify(t.cwd, home) : undefined}
                      >
                        {t.kind === 'claude' ? <Sparkles size={12} className="shrink-0 text-accent-ink" aria-hidden /> : <SquareTerminal size={12} className="shrink-0" aria-hidden />}
                        <span className="truncate">{label}</span>
                        {status.dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${status.dot === 'running' ? 'bg-accent-ink' : 'bg-error'}`} data-terminal-tab-dot={status.dot} />}
                        {status.note && (
                          <span className={`shrink-0 text-meta ${status.dot === 'failed' ? 'text-error' : 'text-faint'}`}>
                            <span aria-hidden>{status.note}</span>
                            <span className="sr-only">, exited with code {t.exitCode}</span>
                          </span>
                        )}
                        {status.dot === 'running' && <span className="sr-only">, running</span>}
                      </button>
                      {/* Always on the selected tab (so the keyboard reaches it with Tab), on hover or focus for the others. */}
                      <button
                        type="button"
                        onClick={() => closeTab(t)}
                        tabIndex={selected ? 0 : -1}
                        className={`flex size-5 items-center justify-center rounded text-muted hover:bg-border/50 hover:text-text focus-visible:opacity-100 group-hover:opacity-100 ${selected ? '' : 'opacity-0'}`}
                        aria-label={`Close ${label}`}
                        data-tooltip={`Close ${label}`}
                        data-terminal-tab-close
                      >
                        <X size={11} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <Button variant="quiet" size="sm" iconOnly icon={<Plus size={13} />} data-new-terminal onClick={() => void open('shell')} disabled={!canOpen} aria-label="New terminal tab" className="shrink-0" />
          </div>
          {!tabs && buttons}
        </div>

        {notice && (
          // An engine restart closing the terminals is news, not something that needs you.
          <Notice
            tone={notice.code === ENGINE_RESTARTED ? 'info' : 'warn'}
            role={notice.code === ENGINE_RESTARTED ? 'status' : 'alert'}
            className="mx-2 mb-1"
            data-terminal-notice={notice.code ?? true}
            onDismiss={() => setNotice(owner, null)}
            actions={
              <>
                {blocked?.code === 'SESSION_RUNNING_HERE' && (
                  <Button size="sm" onClick={() => void stopAndOpen()}>
                    Stop it here and open
                  </Button>
                )}
                {blocked && (
                  <Button size="sm" onClick={() => void open('claude', { fork: true })}>
                    Open a fork
                  </Button>
                )}
              </>
            }
          >
            {notice.message}
          </Notice>
        )}

        {/* Before the terminal, so Tab reaches Stop and Restart: inside xterm, Tab goes to the shell. */}
        {active?.kind === 'action' && (
          <RunStrip
            terminal={active}
            run={runs.get(active.id) ?? null}
            command={actionCommand(active.title, actions)}
            folder={tildify(active.cwd, home)}
            onStop={() => void stop(active)}
            onRestart={() => void restart(active)}
          />
        )}

        <div className="relative min-h-0 flex-1">
          {terminals.length === 0 ? (
            // Opening the panel starts a shell, so this shows only for a session switched to with the panel open, or without a folder.
            <div className="flex h-full items-center justify-center text-ui text-muted">
              {canOpen ? <Button onClick={() => void open('shell')}>New terminal</Button> : <p>This session has no folder to open a terminal in.</p>}
            </div>
          ) : (
            terminals.map((t) => (
              <div key={t.id} id={panelId(t)} role="tabpanel" aria-labelledby={tabId(t)} className={t.id === active?.id ? 'absolute inset-0' : 'hidden'}>
                <XTerm id={t.id} active={t.id === active?.id} exited={t.exitCode !== null} onClose={() => closeTab(t)} />
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/** A tab of the window's terminal: its folder's name, `~` for the home folder. */
function folderLabel(cwd: string, home: string | null): string {
  return home !== null && cwd === home ? '~' : basename(cwd);
}

/**
 * What an action's tab is doing, between the tabs and the terminal: its status, command, how long it has
 * run and where, with Restart and Stop. It sits in the panel's layout, not over xterm, so the terminal's
 * layers can't take its clicks.
 */
function RunStrip({
  terminal,
  run,
  command,
  folder,
  onStop,
  onRestart,
}: {
  terminal: TerminalInfo;
  run: RunTimes | null;
  command: string;
  folder: string;
  onStop(): void;
  onRestart(): void;
}) {
  const running = terminal.exitCode === null;
  const now = useTicker(running);
  const status = runStatus(terminal.exitCode);
  // A run that ended before this window saw it has no end time: leave the clock out rather than guess.
  const end = running ? now : (run?.endedAt ?? null);
  const elapsed = run && end !== null ? elapsedLabel(end - run.startedAt) : null;
  return (
    <div className="flex h-8.5 shrink-0 items-center gap-3 border-y border-border px-4 text-meta text-muted" data-terminal-run-strip data-terminal-run-state={status.state}>
      <span role="status" className="flex shrink-0 items-center gap-1.5" data-terminal-exited={running ? undefined : terminal.exitCode}>
        <span aria-hidden className={`size-1.5 rounded-full ${status.state === 'running' ? 'animate-pulse bg-accent-ink' : status.state === 'failed' ? 'bg-error' : 'bg-faint'}`} />
        <span className={status.state === 'running' ? 'text-text' : status.state === 'failed' ? 'text-error' : ''} data-terminal-run-status>
          {status.label}
        </span>
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-ui text-text" data-tooltip={command} data-terminal-run-command>
        {command}
      </code>
      {elapsed && (
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          <Timer size={11} aria-hidden />
          <span className="sr-only">{running ? 'Running for' : 'Ran for'} </span>
          <span data-terminal-run-elapsed>{elapsed}</span>
        </span>
      )}
      <span className="flex max-w-[30%] min-w-0 items-center gap-1 @max-[560px]/terminal:hidden" data-tooltip={terminal.cwd}>
        <Folder size={11} className="shrink-0" aria-hidden />
        <span className="sr-only">in </span>
        <span className="truncate font-mono">{folder}</span>
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" icon={<RotateCcw size={11} aria-hidden />} onClick={onRestart} data-tooltip={running ? 'Stop it and run it again' : 'Run it again'} data-terminal-restart>
          Restart
        </Button>
        {running && (
          <Button variant="danger" size="sm" icon={<Square size={9} className="fill-current" aria-hidden />} shortcut="terminal.stop-action" onClick={onStop} data-tooltip={`Stop the command (${formatKeys(keysFor('terminal.stop-action'))} in the terminal)`} data-terminal-stop>
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
