import { useEffect, useMemo, useState } from 'react';
import type { CompanionProject, CompanionSessions } from '@seshboard/protocol/companion-client';
import { connect, type Connection, type ConnectionState } from '../lib/connection.ts';
import { activePage, consoleErrors } from '../lib/page.ts';
import { TargetPicker } from './TargetPicker.tsx';
import { consoleItem, defaultTarget, pageItems, screenshotImage, shortTitle, targetOptions, waitingSessions, type ConsoleEntry, type PageInfo } from '../lib/payload.ts';

type Send = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; message: string };

/** The page the popup works on: the tab on screen. */
/** The visible part of the tab, as a JPEG (smaller than PNG, so it fits a message). */
async function captureTab(): Promise<string | null> {
  try {
    return await browser.tabs.captureVisibleTab(undefined as unknown as number, { format: 'jpeg', quality: 80 });
  } catch {
    return null;
  }
}

async function loadPage(): Promise<{ page: (PageInfo & { tabId?: number }) | null }> {
  return { page: await activePage().catch(() => null) };
}

/**
 * The popup: the sessions waiting on you, and the page (its selection, its address) to send to a session or to New
 * session in a project. Nothing goes to Claude: it lands as chips in Seshboard's message box.
 */
export function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [state, setState] = useState<ConnectionState>({ kind: 'connecting' });
  const [sessions, setSessions] = useState<CompanionSessions | null>(null);
  const [projects, setProjects] = useState<{ projects: CompanionProject[]; matched: string | null } | null>(null);
  const [page, setPage] = useState<(PageInfo & { tabId?: number }) | null>(null);
  const [include, setInclude] = useState({ selection: true, page: false, console: true, screenshot: false });
  const [errors, setErrors] = useState<ConsoleEntry[] | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [send, setSend] = useState<Send>({ kind: 'idle' });

  useEffect(() => {
    const conn = connect();
    setConnection(conn);
    const stop = conn.onState(setState);
    void loadPage().then(({ page }) => {
      setPage(page);
      // A page without a selection is sent as its address; starting a session sends both.
      setInclude((current) => ({ ...current, selection: true, page: !page?.selection.trim() }));
      if (page?.tabId) void consoleErrors(page.tabId).then(setErrors);
    });
    return () => {
      stop();
      conn.close();
    };
  }, []);

  useEffect(() => {
    if (!connection || state.kind !== 'connected' || !page) return;
    let live = true;
    void Promise.all([connection.client.call('sessions.list', { folders: [] }), connection.client.call('projects.list', { url: page.url })]).then(
      ([list, found]) => {
        if (!live) return;
        setSessions(list);
        setProjects(found);
      },
      (error: unknown) => live && setSend({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [connection, state.kind, page]);

  const options = useMemo(() => (sessions && projects ? targetOptions(sessions.sessions, sessions.focused, projects.projects, projects.matched) : []), [sessions, projects]);
  useEffect(() => {
    if (target === null && options.length > 0) setTarget(defaultTarget(options, sessions?.focused ?? null, projects?.matched ?? null));
  }, [options, sessions, projects, target]);

  const errorsItem = page && errors && include.console ? consoleItem(errors, page) : null;
  const items = page ? [...pageItems(page, include), ...(errorsItem ? [errorsItem] : [])] : [];
  const image = page && shot && include.screenshot ? screenshotImage(shot, page) : null;

  // The screenshot is taken when it is ticked, so the preview shows what goes.
  const toggleScreenshot = (on: boolean) => {
    setInclude((current) => ({ ...current, screenshot: on }));
    if (on && !shot) void captureTab().then((url) => (url ? setShot(url) : setSend({ kind: 'failed', message: "This page can't be captured." })));
  };
  const chosen = options.find((o) => o.value === target) ?? null;

  const add = () => {
    if (!connection || !chosen || (items.length === 0 && !image) || send.kind === 'sending') return;
    setSend({ kind: 'sending' });
    connection.client.call('context.add', { target: chosen.target, items, ...(image ? { images: [image] } : {}), reveal: true }).then(
      () => {
        setSend({ kind: 'sent' });
        setTimeout(() => window.close(), 900);
      },
      (error: unknown) => setSend({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
  };

  const waiting = sessions ? waitingSessions(sessions.sessions) : [];
  const hasSelection = !!page?.selection.trim();

  return (
    <main className="grid gap-3 p-3 text-ui" data-popup>
      <header className="flex items-center gap-2">
        <img src="/images/icon-32.png" alt="" className="size-5" />
        <h1 className="text-title font-semibold">Seshboard</h1>
        <StatusDot state={state} />
      </header>

      {state.kind !== 'connected' ? (
        <Offline state={state} onLaunch={() => connection?.launch()} />
      ) : (
        <>
          {waiting.length > 0 && (
            <section className="grid gap-1" aria-label="Waiting for you">
              <h2 className="text-meta text-muted">Waiting for you</h2>
              {waiting.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-text/10"
                  onClick={() => void connection?.client.call('session.reveal', { sessionId: s.id }).then(() => window.close(), () => {})}
                  data-waiting={s.id}
                >
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="text-meta text-muted">Open</span>
                </button>
              ))}
            </section>
          )}

          <section className="grid gap-2" aria-label="Send">
            <h2 className="text-meta text-muted">Send</h2>
            {page ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {hasSelection && <Toggle label="Selection" on={include.selection} onChange={(selection) => setInclude({ ...include, selection })} />}
                  <Toggle label="Page address" on={include.page} onChange={(next) => setInclude({ ...include, page: next })} />
                  <Toggle label="Screenshot" on={include.screenshot} onChange={toggleScreenshot} />
                  {errors && errors.length > 0 && <Toggle label={`Console errors (${errors.length})`} on={include.console} onChange={(next) => setInclude({ ...include, console: next })} />}
                </div>
                {hasSelection && include.selection && <blockquote className="line-clamp-3 border-l-2 border-accent-ink pl-2 text-muted">{page.selection.trim()}</blockquote>}
                {include.page && <p className="truncate text-meta text-muted">{shortTitle(page.title, 80) || page.url}</p>}
                {include.screenshot && shot && <img src={shot} alt="Screenshot of the page" className="max-h-28 w-full rounded border border-border object-cover object-top" />}
                {errors && errors.length === 0 && <p className="text-meta text-faint">No console errors on this page.</p>}
              </>
            ) : (
              <p className="text-muted">This page can't be read.</p>
            )}
          </section>

          <section className="grid gap-1" aria-label="To">
            <h2 className="text-meta text-muted">To</h2>
            <TargetPicker options={options} value={target} onChange={setTarget} />
          </section>

          <button
            type="button"
            className="h-8 rounded-md bg-accent font-semibold text-on-accent disabled:opacity-50"
            disabled={!chosen || (items.length === 0 && !image) || send.kind === 'sending' || send.kind === 'sent'}
            aria-busy={send.kind === 'sending'}
            onClick={add}
            data-add
          >
            {send.kind === 'sending' ? 'Adding…' : send.kind === 'sent' ? 'Added' : 'Add to Seshboard'}
          </button>
          {send.kind === 'sent' && <p className="text-meta text-muted">It is in the message box. Nothing goes to Claude until you send.</p>}
          {send.kind === 'failed' && (
            <p className="text-meta text-error" role="alert">
              {send.message}
            </p>
          )}
        </>
      )}
    </main>
  );
}

function StatusDot({ state }: { state: ConnectionState }) {
  const colour = state.kind === 'connected' ? 'bg-ok' : state.kind === 'connecting' ? 'bg-faint' : 'bg-error';
  const label = state.kind === 'connected' ? 'Connected' : state.kind === 'connecting' ? 'Connecting' : 'Not connected';
  return (
    <span className="ml-auto flex items-center gap-1.5 text-meta text-muted" role="status">
      <span aria-hidden className={`size-2 rounded-full ${colour}`} />
      {label}
    </span>
  );
}

function Offline({ state, onLaunch }: { state: ConnectionState; onLaunch(): void }) {
  if (state.kind === 'connecting') return <p className="text-muted">Looking for Seshboard…</p>;
  if (state.kind === 'not-running')
    return (
      <div className="grid gap-2">
        <p>Seshboard is not running.</p>
        {state.canLaunch && (
          <button type="button" className="h-8 rounded-md bg-accent font-semibold text-on-accent" onClick={onLaunch}>
            Open Seshboard
          </button>
        )}
      </div>
    );
  if (state.kind === 'incompatible') return <p>{state.detail}</p>;
  if (state.kind === 'no-host')
    return (
      <div className="grid gap-1.5">
        <p>This browser can't reach Seshboard yet.</p>
        <p className="text-muted">In Seshboard, open Settings › Browser extension and press Connect browsers. Then open this again.</p>
      </div>
    );
  return null;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <button type="button" aria-pressed={on} className={`h-6 rounded-full border px-2.5 text-ui ${on ? 'border-accent-ink bg-accent/15 text-text' : 'border-border text-muted hover:text-text'}`} onClick={() => onChange(!on)}>
      {label}
    </button>
  );
}
