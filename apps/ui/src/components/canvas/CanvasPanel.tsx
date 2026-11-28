import { AppWindow, RotateCw, ScrollText, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CanvasListed, CanvasLogLine } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { PanelResizeEdge, PanelSize, sidePanelClass } from '../transcript/PanelSize.tsx';
import { useDark } from '../transcript/VisualBlock.tsx';
import { Button } from '../ui/Button.tsx';
import { canvasPageElement, canvasPageKey, dropCanvasPage, showCanvasPage } from './canvasPages.ts';
import { atLogEnd, canvasStartsItself, canvasView, composeHere, logTime, logTone } from './canvasPanel.ts';

interface CanvasPanelProps {
  sessionId: string;
  /** The session's title, which the canvas hears (`host.context()`). */
  sessionTitle: string;
  /** This session's pane is the active one: what a canvas composes goes to its message box. */
  active: boolean;
  /** The session's folder: the canvas runs in its checkout. */
  cwd: string;
  canvas: CanvasListed;
  width: number;
  onWidth(width: number): void;
  /** Full: the panel takes the whole session area (`useRightPanel().full`). */
  full?: boolean;
  onFull?(full: boolean): void;
  onClose(): void;
}

const TONE = { quiet: 'text-muted', plain: 'text-text', warn: 'text-caution', error: 'text-error' } as const;

/** The canvas's log: what it wrote and what Seshboard did with it, newest last. It stays at its end while you are there. */
function CanvasLog({ lines, tall }: { lines: CanvasLogLine[]; tall: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={box}
      role="log"
      aria-label="Canvas log"
      tabIndex={0}
      onScroll={(event) => (follow.current = atLogEnd(event.currentTarget.scrollTop, event.currentTarget.clientHeight, event.currentTarget.scrollHeight))}
      className={`shrink-0 overflow-y-auto border-t border-border bg-bg px-3 py-1.5 font-mono text-meta select-text ${tall ? 'min-h-24 flex-1' : 'h-40'}`}
      data-canvas-log
    >
      {lines.length === 0 ? (
        <p className="text-muted">Nothing in the log yet.</p>
      ) : (
        lines.map((line, index) => (
          <p key={`${line.at}-${index}`} className={`break-words whitespace-pre-wrap ${TONE[logTone(line)]}`} data-canvas-log-line={line.from}>
            <span className="text-muted">{logTime(line.at)}</span> {line.from === 'seshboard' ? <span className="text-muted">Seshboard: </span> : line.level !== 'info' ? `${line.level}: ` : ''}
            {line.text}
          </p>
        ))
      )}
    </div>
  );
}

/**
 * One of the project's canvases in the side panel (docs/canvases.md): a web app from `.seshboard/canvases`, which the
 * engine runs and whose page shows here, in a partition of its own. Before its first run (and after its file
 * changed) it asks, because a canvas is the project's code running with your rights. Its page lives outside the panel
 * (`canvasPages.ts`), so it is as you left it when the panel comes back to the front.
 */
export function CanvasPanel({ sessionId, sessionTitle, active, cwd, canvas, width, onWidth, full = false, onFull, onClose }: CanvasPanelProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<CanvasLogLine[]>([]);
  const slot = useRef<HTMLDivElement>(null);
  const view = canvasView(canvas, opening, error);
  const title = canvas.title ?? canvas.name;
  const pageKey = canvasPageKey(sessionId, canvas.id);

  const open = useCallback(async () => {
    if (!client) return;
    setOpening(true);
    setError(null);
    try {
      await client.call('canvases.open', { cwd, id: canvas.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }, [client, cwd, canvas.id]);

  // Trusted and not running: the panel starts it. A failure waits for Try again, a canvas you stopped for Start.
  const startsItself = canvasStartsItself(canvas, error) && !opening && client !== null;
  useEffect(() => {
    if (startsItself) void open();
  }, [startsItself, open]);

  const trust = async () => {
    if (!client) return;
    setError(null);
    try {
      await client.call('canvases.trust', { cwd, id: canvas.id, hash: canvas.hash });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // Stop clears a failure and ends the process: the panel then starts it fresh.
  const restart = async () => {
    if (!client) return;
    setError(null);
    await client.call('canvases.stop', { cwd, id: canvas.id }).catch(() => {});
  };
  // Stop from the header: it stays stopped, here and in every other session, until Start.
  const stop = () => void client?.call('canvases.stop', { cwd, id: canvas.id, hold: true }).catch(() => {});

  // The page, over this panel's slot while it runs. Stopped, failed or changed, the page goes.
  const url = view === 'page' ? canvas.url : null;
  useEffect(() => {
    if (url && slot.current) return showCanvasPage(pageKey, canvas.id, url, canvas.partition, slot.current);
    if (view !== 'starting') dropCanvasPage(pageKey);
  }, [url, view, pageKey, canvas.partition, canvas.id]);

  // The log: read while it shows (the header's button, or under a failure), and again when the engine says it grew.
  const logShows = showLog || view === 'failed';
  const readLog = useCallback(() => {
    if (client) void client.call('canvases.log', { cwd, id: canvas.id }).then((r) => setLog(r.lines), () => {});
  }, [client, cwd, canvas.id]);
  const dir = canvas.dir;
  useEffect(() => {
    if (!logShows || !client) return;
    readLog();
    return client.on('canvases.logged', (event) => event.id === canvas.id && dir.startsWith(event.folder) && readLog());
  }, [logShows, client, readLog, canvas.id, dir, canvas.state]);

  // The canvas hears which session shows it, and the look (`host.context()`), once it runs and when either changes.
  const dark = useDark();
  const running = view === 'page';
  useEffect(() => {
    if (client && running) void client.call('canvases.shown', { cwd, id: canvas.id, sessionId, title: sessionTitle.slice(0, 300), theme: dark ? 'dark' : 'light' }).catch(() => {});
  }, [client, running, cwd, canvas.id, sessionId, sessionTitle, dark]);

  // `host.compose`: text and chips for this session's message box, when the canvas is used here. Nothing is sent.
  useEffect(
    () =>
      client?.on('canvases.compose', (event) => {
        if (event.id !== canvas.id || !dir.startsWith(event.folder)) return;
        if (!composeHere(document.activeElement, canvasPageElement(pageKey), active)) return;
        if (event.items.length) useDrafts.getState().addContext(sessionId, event.items);
        if (event.text.trim()) useDrafts.getState().requestQuote(sessionId, event.text, { plain: true });
        else useDrafts.getState().requestFocus(sessionId);
      }),
    [client, canvas.id, dir, sessionId, active, pageKey],
  );

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || view === 'page') return;
    if (event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
    event.preventDefault();
    onClose();
  };

  return (
    <aside aria-label={title} tabIndex={-1} onKeyDown={onKey} className={sidePanelClass(full)} style={full ? undefined : { width }} data-canvas-panel={canvas.id} data-canvas-view={view}>
      {!full && <PanelResizeEdge width={width} onWidth={onWidth} label={`${title} panel width`} />}
      <header className="@container/toolbar flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
        <AppWindow size={14} aria-hidden className="mr-1 shrink-0 text-muted" />
        <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-text">{title}</h2>
        {view === 'page' && <Button variant="quiet" size="sm" iconOnly icon={<RotateCw size={14} aria-hidden />} aria-label="Reload the page" data-tooltip="Reload the page" onClick={() => canvasPageElement(pageKey)?.reload()} data-canvas-reload />}
        {canvas.trusted && <Button variant="quiet" size="sm" iconOnly icon={<ScrollText size={14} aria-hidden />} aria-label="Log" aria-pressed={showLog} data-tooltip={showLog ? 'Hide the log' : 'Show the log'} onClick={() => setShowLog((on) => !on)} data-canvas-log-toggle />}
        {(view === 'page' || view === 'starting') && <Button variant="quiet" size="sm" iconOnly icon={<Square size={13} aria-hidden />} aria-label={`Stop ${canvas.name}`} data-tooltip="Stop the canvas" onClick={stop} disabled={!client} data-canvas-stop />}
        {onFull && <PanelSize full={full} onChange={onFull} />}
        <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label={`Close ${title}`} onClick={onClose} data-canvas-close />
      </header>
      {view === 'page' ? (
        <div ref={slot} className="min-h-0 flex-1 bg-white" data-canvas-slot />
      ) : (
        <div className={`flex flex-col gap-3 overflow-y-auto px-4 py-4 text-body ${view === 'failed' ? 'shrink-0' : 'min-h-0 flex-1'}`}>
          {view === 'trust' && (
            <>
              <h3 className="text-ui font-semibold text-text">Run this canvas?</h3>
              <p className="text-muted">A canvas is code from this project. It runs on your computer with your rights, like a script you start in a terminal. Seshboard asks again when its file changes.</p>
              <p className="rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-meta break-all text-text select-text" data-canvas-dir>
                {canvas.dir}
              </p>
              {error && (
                <p role="alert" className="text-meta text-error">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button variant="primary" size="md" onClick={() => void trust()} disabled={!client} data-canvas-trust>
                  Trust and run
                </Button>
                <Button size="md" onClick={onClose}>
                  Not now
                </Button>
              </div>
            </>
          )}
          {view === 'starting' && (
            <p role="status" className="text-muted">
              Starting {canvas.name}…
            </p>
          )}
          {view === 'failed' && (
            <>
              <p role="alert" className="text-error" data-canvas-error>
                {`${canvas.name} didn't start: ${error ?? canvas.error ?? 'it stopped.'}`}
              </p>
              <div>
                <Button size="md" onClick={() => void restart()} disabled={!client} data-canvas-retry>
                  Try again
                </Button>
              </div>
            </>
          )}
          {view === 'stopped' && (
            <>
              <p role="status" className="text-muted" data-canvas-stopped>
                {canvas.held ? `${canvas.name} is stopped. It uses nothing until you start it.` : `${canvas.name} is not running.`}
              </p>
              <div>
                <Button variant="primary" size="md" onClick={() => void open()} disabled={!client} data-canvas-start>
                  Start
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {logShows && <CanvasLog lines={log} tall={view === 'failed'} />}
    </aside>
  );
}
