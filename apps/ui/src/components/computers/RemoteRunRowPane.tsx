import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Ellipsis, ListTree } from 'lucide-react';
import { PARENT_PLACEHOLDER, runIsActive, runProgress, triggerOriginOf, type Computer, type Contract, type RemoteRunState, type RpcClient } from '@seshboard/protocol/client';
import { matches } from '../../lib/shortcuts.ts';
import { useComputers } from '../../state/computersStore.ts';
import { clearRemoteDraft, loadRemoteDraft, remoteSessionDraftKey, saveRemoteDraft } from '../../state/remoteDrafts.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { PaneClose } from '../split/PaneClose.tsx';
import { RemoteTriggerOriginBar } from '../triggers/TriggerOriginBar.tsx';
import { Button } from '../ui/Button.tsx';
import { PANE_HEADER } from '../ui/paneHeader.ts';
import { useScrollEdge } from '../ui/useScrollEdge.ts';
import { callComputer } from './callComputer.ts';
import { ComputerChip } from './ComputerChip.tsx';
import { computerTint } from './computerColor.ts';
import { paneHandle, paneHeader, remoteLine, type PaneProps } from './ComputerView.tsx';
import { remoteSessionEntries } from './remoteActions.ts';
import { RemoteRunCard } from './RemoteRunCard.tsx';

/** Ticks every few seconds while `active`, for the run's "for 4m". */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * A run row on another computer (docs/remote-access.md, Other computers): a pipeline run started from New session
 * there, which has no session of its own yet. As a run row here (`RunRowPane`): its header names the run and where it
 * is, with the computer's chip and the `remote` line, then the task, the run's card (its steps and buttons, Push) and a
 * message box. What you write there starts the run's own session on that computer (`runs.write`, with the run's brief
 * first), which then opens in this pane.
 */
export function RemoteRunRowPane({ client, computer, state, pane }: { client: RpcClient<Contract>; computer: Computer; state: RemoteRunState; pane: PaneProps }) {
  const { run } = state;
  const name = computer.name;
  const connected = computer.state === 'connected';
  const scroller = useRef<HTMLDivElement>(null);
  const edge = useScrollEdge(scroller, true);
  const handle = paneHandle(pane);
  const now = useNow(runIsActive(state));
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const openMenu = (at: { x: number; y: number }) =>
    setMenu({ ...at, entries: remoteSessionEntries(client, computer, { id: run.id, title: run.title, pinned: false, unread: false, projectId: run.projectId, projectName: run.projectName, runRow: true, treeRunId: run.id }, { open: false }) });

  return (
    <div className="@container flex h-full min-h-0 flex-col" style={computerTint(computer.color)} data-remote-run-row={run.id} data-remote-computer={computer.id}>
      <header className={`${PANE_HEADER} ${remoteLine(pane)}`} data-scrolled={!edge.atTop || undefined} {...paneHeader(pane)}>
        {pane.leading && <SidebarToggle />}
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-pipeline/15 @max-[400px]:hidden">
          <ListTree size={14} className="text-pipeline" aria-hidden />
        </span>
        <div className={`min-w-24 flex-1 @max-[560px]:min-w-16 ${handle.className}`} data-pane-handle={handle['data-pane-handle']}>
          <h1 className="truncate text-body leading-snug font-semibold" data-tooltip={run.title}>
            {run.title}
          </h1>
          <p className="truncate text-meta text-muted" data-run-row-meta>
            Run · {runProgress(run)}
            {run.unattended && <span> · without stopping for you</span>}
            <span className="@max-[860px]:hidden"> · {run.projectName}</span>
          </p>
        </div>
        <ComputerChip name={name} size="header" offline={!connected} className="no-drag @max-[420px]:hidden" data-tooltip={`The run goes on ${name}. You follow it from here.`}>
          on {name}
        </ComputerChip>
        <Button
          variant="quiet"
          iconOnly
          icon={<Ellipsis size={15} aria-hidden />}
          aria-label="Run options"
          aria-haspopup="menu"
          data-tooltip="Run options"
          className="no-drag shrink-0"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu({ x: rect.right - 240, y: rect.bottom + 4 });
          }}
          data-remote-run-row-more
        />
        <PaneClose id={pane.id} tiled={pane.tiled} closeTooltip={`Close and go Home (the run keeps going on ${name})`} />
      </header>
      {/* A trigger there started it: which, and the link to the CI run or the issue. */}
      <RemoteTriggerOriginBar origin={triggerOriginOf(run.trigger)} />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-3 px-6 py-4 @max-[860px]:px-4">
          {run.task && (
            <div className="flex justify-end">
              <p className="max-w-[80%] rounded-xl border border-border bg-card px-3.5 py-2.5 text-body whitespace-pre-wrap [overflow-wrap:anywhere]" data-run-task>
                {run.task}
              </p>
            </div>
          )}
          <RemoteRunCard client={client} computer={computer} state={state} now={now} />
        </div>
      </div>
      <div className="shrink-0 bg-bg">
        {/* The message box at the catch-up card's width, a size wider than the run. */}
        <div className="mx-auto max-w-4xl px-6 pt-3 pb-3 @max-[860px]:px-4">
          <RunWriteBox client={client} computer={computer} runId={run.id} />
        </div>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} width={240} label={`Pipeline run “${run.title}”`} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Writes in the run row there: the run gets a session of its own, which opens here. Kept as a draft until it is sent. */
function RunWriteBox({ client, computer, runId }: { client: RpcClient<Contract>; computer: Computer; runId: string }) {
  const name = computer.name;
  const connected = computer.state === 'connected';
  const draftKey = remoteSessionDraftKey(computer.id, runId);
  const [text, setText] = useState(() => loadRemoteDraft(draftKey).text);
  const [sending, setSending] = useState(false);
  useEffect(() => saveRemoteDraft(draftKey, { text }), [draftKey, text]);
  const blocked = !connected ? `${name} is not connected` : !text.trim() ? 'Type a message first' : null;
  const send = async () => {
    if (blocked || sending) return;
    setSending(true);
    try {
      const { sessionId } = await callComputer(client, computer.id, 'runs.write', { runId, text: text.trim() });
      clearRemoteDraft(draftKey);
      setText('');
      useComputers.getState().openSession({ computerId: computer.id, sessionId }, { starting: true });
    } catch (e) {
      toast((e as Error).message, { body: `It wasn’t sent on ${name}.` });
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) || matches(event.nativeEvent, 'new-session.start')) {
      event.preventDefault();
      void send();
    }
  };
  return (
    <div className={`rounded-[18px] border bg-card px-3 pt-3 pb-2 shadow-md transition-colors ${connected ? 'border-remote/45 focus-within:border-remote/80' : 'border-border'}`} data-composer-card>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        disabled={!connected || sending}
        placeholder={connected ? PARENT_PLACEHOLDER : `${name} is not connected`}
        aria-label={`Message Claude on ${name} about this run`}
        className="block field-sizing-content max-h-[10lh] min-h-[3lh] w-full min-w-0 resize-none bg-transparent px-1 text-body leading-relaxed text-text outline-none placeholder:text-faint disabled:opacity-60"
        data-remote-run-write
      />
      <div className="mt-1.5 flex items-center justify-end">
        <span className="flex" data-tooltip={!sending ? (blocked ?? undefined) : undefined}>
          <Button variant="primary" size="lg" disabled={!!blocked || sending} aria-busy={sending || undefined} onClick={() => void send()} className="disabled:pointer-events-none" data-remote-run-write-send>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </span>
      </div>
    </div>
  );
}
