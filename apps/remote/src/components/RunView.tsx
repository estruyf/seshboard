import { useEffect, useState, type ReactNode } from 'react';
import { ListTree, Send } from 'lucide-react';
import { PARENT_PLACEHOLDER, runProgress, type RemoteSessions } from '@seshboard/protocol/remote-client';
import { clearDraft, loadDraft, saveDraft, type DraftKey } from '../lib/drafts.ts';
import { useFinePointer } from '../lib/media.ts';
import type { Client } from './Connected.tsx';
import { MenuButton, type MenuItem } from './Menu.tsx';
import { StepTree, useRunActions } from './RunParts.tsx';
import { toast } from './Toasts.tsx';
import { Button, ComputerTag } from './ui.tsx';

/**
 * A run row (#179): a pipeline run started from New session, which has no session of its own yet. Its header names
 * the run and where it is, then the task you gave it, the step tree with its buttons and Push, and a message box. What
 * you write there starts the run's own session (with the run's brief first), which then takes this view's place.
 */
export function RunView({
  client,
  runId,
  sessions,
  banner,
  lead,
  onLeave,
  onOpenSession,
  computerName,
}: {
  client: Client;
  runId: string;
  /** The computer's list: the run, and which of its sub-sessions can be opened. */
  sessions: RemoteSessions;
  banner: ReactNode;
  lead: ReactNode;
  /** Back to the list (after Archive). */
  onLeave: () => void;
  /** Opens a session of this computer: a step's sub-session, or the run's own once you wrote. */
  onOpenSession: (sessionId: string, options?: { replace?: boolean }) => void;
  computerName?: string | undefined;
}) {
  const state = sessions.runs?.find((r) => r.run.id === runId) ?? null;
  const run = state?.run ?? null;
  const actions = useRunActions(client, runId);
  const listed = new Set(sessions.sessions.map((s) => s.id));
  const going = run?.status === 'running' || run?.status === 'waiting' || run?.status === 'paused';
  const steps = new Set(state?.steps.flatMap((s) => (s.sessionId ? [s.sessionId] : [])) ?? []).size;
  const archive = () =>
    void client
      ?.call('runs.archive', { runId, archived: true })
      .then(() => {
        toast(`Archived ${run?.title ?? 'the run'}`, { action: { label: 'Undo', run: () => void client.call('runs.archive', { runId, archived: false }).catch(() => {}) } });
        onLeave();
      })
      .catch((error: Error) => toast(error.message, { tone: 'error' }));
  const menu: MenuItem[] = [
    ...(going ? [{ label: 'Stop the run', disabled: !client || actions.busy, onSelect: () => void actions.stop() }] : []),
    { label: steps ? `Archive with ${steps === 1 ? 'its step' : `its ${steps} steps`}` : 'Archive', disabled: !client || going, onSelect: archive },
  ];
  return (
    <div className="flex h-full flex-col bg-bg" data-remote-run-view={runId}>
      <header className={`safe-top flex items-center gap-2 border-b border-border bg-bg pb-2 pointer-fine:pb-2.5 ${lead ? 'px-2' : 'px-5'}`}>
        {lead}
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-pipeline/15" aria-hidden>
          <ListTree className="size-4 text-pipeline" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title font-semibold">{run?.title ?? 'Pipeline run'}</h1>
          {run && (
            <p className="flex items-center gap-1.5 truncate text-meta text-muted" data-remote-run-meta>
              {computerName && <ComputerTag name={computerName} />}
              Run · {run.status === 'stopped' ? 'stopped' : runProgress(run)}
              {run.unattended && <span data-remote-run-unattended> · without stopping for you</span>} · {run.projectName}
            </p>
          )}
        </div>
        {state && <MenuButton label="Run actions" items={menu} />}
      </header>
      {banner}
      {!state ? (
        <p className="p-8 text-center text-ui text-muted" role="status">
          {client ? 'This run is gone.' : 'Waiting for your computer.'}
        </p>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {state.run.task && (
                <p className="ml-auto max-w-[85%] rounded-xl border border-border bg-card px-3.5 py-2.5 text-body whitespace-pre-wrap [overflow-wrap:anywhere]" data-remote-run-task>
                  {state.run.task}
                </p>
              )}
              <StepTree state={state} client={client} canOpen={(id) => listed.has(id)} onOpenStep={(id) => onOpenSession(id)} />
            </div>
          </main>
          {state.run.parentSessionId ? (
            // You wrote here already: the run has its own session now, where the conversation goes on.
            <footer className="safe-bottom border-t border-border px-4 pt-2 sm:px-6">
              <p className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 text-ui text-muted" data-remote-run-adopted>
                The run has its own session now.
                <Button variant="primary" onClick={() => onOpenSession(state.run.parentSessionId!, { replace: true })}>
                  Open the session
                </Button>
              </p>
            </footer>
          ) : (
            <RunComposer client={client} runId={runId} onSent={(sessionId) => onOpenSession(sessionId, { replace: true })} />
          )}
        </>
      )}
    </div>
  );
}

/** A run row's message box: what you write starts the run's own session, in its folder, with the run's brief first. */
function RunComposer({ client, runId, onSent }: { client: Client; runId: string; onSent: (sessionId: string) => void }) {
  const draft: DraftKey = { kind: 'session', sessionId: runId };
  const [text, setText] = useState(() => loadDraft(draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fine = useFinePointer();
  useEffect(() => saveDraft(draft, text), [runId, text]);
  const send = async () => {
    const message = text.trim();
    if (!client || !message || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionId } = await client.call('runs.write', { runId, text: message });
      clearDraft(draft);
      setText('');
      onSent(sessionId);
    } catch (e) {
      setError((e as { code?: string }).code === 'DISCONNECTED' ? "The message wasn't sent." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="safe-bottom border-t border-border px-3 pt-2 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {error && (
        <p role="alert" className="mx-auto mb-2 w-full max-w-3xl rounded-lg bg-error/10 px-3 py-2 text-ui text-error">
          {error}
        </p>
      )}
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border border-edge bg-card p-1.5 pl-3 transition-[border-color,box-shadow] focus-within:border-accent-ink focus-within:ring-4 focus-within:ring-accent/20">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // With a keyboard, Enter sends and Shift+Enter starts a new line, as in a session.
            if (fine && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={client ? PARENT_PLACEHOLDER : 'Sending waits for the connection'}
          aria-label="Message"
          data-remote-run-message
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-2 text-body text-text outline-none [field-sizing:content] placeholder:text-faint pointer-fine:min-h-7 pointer-fine:py-1"
        />
        <Button type="submit" variant="primary" size="md" disabled={!client || busy || !text.trim()} aria-busy={busy || undefined} aria-label="Send" className="px-3!">
          <Send className="size-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}
