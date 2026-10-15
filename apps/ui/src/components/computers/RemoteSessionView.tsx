import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, ChevronRight, Ellipsis, FileDiff, GitBranch, RefreshCw, SquareCode, SquareTerminal, X } from 'lucide-react';
import type { Computer, Contract, PermissionDecision, RemoteMessage, RemotePrompt, RemoteSession, RpcClient } from '@switchboard/protocol/client';
import { MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';
import { remoteRowId } from '../../state/remoteSelection.ts';
import { onlyThereLine, remoteRowStatus } from '../../state/remoteRows.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { statusLine } from '../../state/sidebarOrder.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { OVERLAY_SELECTOR } from '../session/permissionKeys.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { ClampedPrompt } from '../transcript/ClampedPrompt.tsx';
import { WorkingDots } from '../transcript/ActivityGroup.tsx';
import { DropOverlay } from '../composer/Attachments.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { callComputer, onComputerEvent } from './callComputer.ts';
import { ComputerChip } from './ComputerChip.tsx';
import { ComputerPrompt } from './ComputerPrompt.tsx';
import { applyStream, applyUpdate, awayBanner, NOT_STREAMING, prependMessages, remoteItems, toolLine, toolsSummary, type RemoteTool, type Streaming } from './computerSessions.ts';
import { RemoteAttachButton, RemoteAttachmentList, useRemoteAttachments } from './RemoteAttachments.tsx';
import { RemoteText } from './RemoteText.tsx';
import { remoteSessionEntries } from './remoteActions.ts';

const PAGE = 100;

const DOT_TONE = { warn: 'bg-warn', accent: 'bg-accent-ink animate-pulse', unread: 'bg-unread', ok: 'bg-ok', error: 'bg-error', faint: 'bg-faint' } as const;
const TEXT_TONE = { warn: 'text-warn', accent: 'text-accent-ink', unread: 'text-unread', ok: 'text-ok', error: 'text-error', faint: 'text-muted' } as const;

/** Ticks once a second while `active`, so "Trying again in 30s" counts down. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * A session on another computer, in the same view as a local one (docs/remote-access.md, Other computers): the local
 * header with the computer's chip and a 2px `remote` line along its top, the conversation in the same column, what it
 * waits on docked above the message box, and Stop. What only works on that computer (Changes, the terminal, the
 * editor, pull requests, file links) keeps its place, disabled, with a reason. The transcript is `RemoteText`: nothing
 * in it acts here. While the computer is away the last messages stay, under a banner, and the message box is off.
 */
export function RemoteSessionView({ client, computer, session, prompts }: { client: RpcClient<Contract>; computer: Computer; session: RemoteSession; prompts: RemotePrompt[] }) {
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [streaming, setStreaming] = useState<Streaming>(NOT_STREAMING);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const connected = computer.state === 'connected';
  const id = computer.id;
  const name = computer.name;
  const status = remoteRowStatus(session, prompts.length > 0);
  const working = session.status === 'working' || session.status === 'background';
  const now = useNow(computer.state === 'offline');
  const away = awayBanner(computer, now);
  const line = statusLine(status) ?? { text: 'Idle', tone: 'faint' as const };
  const rowId = remoteRowId({ computerId: id, sessionId: session.id });

  useEffect(() => {
    if (!connected) return;
    let current = true;
    setError(null);
    setStreaming(NOT_STREAMING);
    const offs = [
      onComputerEvent(client, id, 'transcript.updated', (update) => update.sessionId === session.id && setMessages((m) => applyUpdate(m, update))),
      onComputerEvent(client, id, 'session.stream', (delta) => delta.sessionId === session.id && setStreaming((s) => applyStream(s, delta))),
    ];
    void callComputer(client, id, 'transcript.get', { sessionId: session.id, limit: PAGE }).then(
      (page) => {
        if (!current) return;
        atBottom.current = true;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setLoaded(true);
      },
      (e: Error) => current && setError(e.message),
    );
    void callComputer(client, id, 'transcript.watch', { sessionId: session.id }).catch(() => {});
    void callComputer(client, id, 'session.markRead', { sessionId: session.id }).catch(() => {});
    return () => {
      current = false;
      offs.forEach((off) => off());
      void callComputer(client, id, 'transcript.unwatch', { sessionId: session.id }).catch(() => {});
    };
  }, [client, id, session.id, connected]);

  // New messages keep the end in view, unless you scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, prompts.length]);

  const loadEarlier = () => {
    const first = messages[0];
    if (!first) return;
    void callComputer(client, id, 'transcript.get', { sessionId: session.id, before: first.uuid, limit: PAGE }).then((page) => {
      atBottom.current = false;
      setMessages((m) => prependMessages(m, page.messages));
      setHasMore(page.hasMore);
    });
  };

  const respond = async (prompt: RemotePrompt, decision: PermissionDecision): Promise<boolean> => {
    try {
      await callComputer(client, id, 'session.respond', { requestId: prompt.requestId, decision });
      return true;
    } catch (e) {
      toast((e as { code?: string }).code === 'NOT_FOUND' ? 'Already answered' : (e as Error).message);
      return false;
    }
  };

  const stop = () => void callComputer(client, id, 'session.interrupt', { sessionId: session.id }).catch((e: Error) => toast(e.message));

  const openMenu = (at: { x: number; y: number }) =>
    setMenu({
      ...at,
      entries: [
        ...remoteSessionEntries(client, computer, session, { open: false }),
        'separator',
        { label: 'Open folder in editor', disabled: true, onSelect: () => {} },
        { label: 'Create pull request…', disabled: true, onSelect: () => {} },
        { note: onlyThereLine('Files', name) },
      ],
    });

  const items = remoteItems(messages);

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-current-session={rowId} data-remote-session={session.id} data-remote-computer={id} data-drop-zone>
      {/* The 2px line along the top is an inset shadow, so nothing moves. */}
      <header className="drag flex h-13 shrink-0 items-center gap-3 overflow-hidden border-b border-border px-6 shadow-[inset_0_2px_0_var(--sb-remote)] @max-[860px]:gap-2 @max-[860px]:px-4" data-remote-header>
        <SidebarToggle />
        <span className="flex shrink-0 @max-[400px]:hidden">
          <ProjectIcon project={undefined} root={session.projectId} name={session.projectName} size={22} remote />
        </span>
        <div className="min-w-24 flex-1 @max-[400px]:min-w-16">
          <h1 className="truncate text-body leading-snug font-semibold" data-tooltip={session.title}>
            {session.title}
          </h1>
          <div className="flex min-w-0 items-center gap-1.5 text-meta text-muted" data-session-meta>
            <span className={`flex shrink-0 items-center gap-1.5 ${TEXT_TONE[line.tone]}`} data-session-status>
              <span className={`inline-block size-2 shrink-0 rounded-full ${DOT_TONE[line.tone]}`} aria-hidden />
              <span className="@max-[860px]:sr-only">{line.text}</span>
            </span>
            <Sep />
            <span className="min-w-0 shrink truncate @max-[860px]:hidden">{session.projectName}</span>
            {session.branch && (
              <>
                <Sep />
                <span className="flex min-w-0 items-center gap-1">
                  <GitBranch size={11} className="shrink-0" aria-hidden />
                  <span className="truncate">{session.branch}</span>
                </span>
              </>
            )}
          </div>
        </div>
        <ComputerChip name={name} size="header" offline={!connected} className="no-drag @max-[420px]:hidden" data-remote-chip data-tooltip={`Claude runs on ${name}. You follow it from here.`}>
          on {name}
        </ComputerChip>
        {/* Changes | Terminal stay where they are in a local session, disabled: they only work on that computer. */}
        <div className="no-drag flex shrink-0 items-center gap-0.5 rounded-lg bg-border/40 p-0.5" role="group" aria-label="Panels">
          <OnlyThere feature="Changes" name={name}>
            <Button variant="quiet" size="sm" iconOnly disabled icon={<FileDiff size={14} aria-hidden />} aria-label={onlyThereLine('Changes', name)} data-remote-changes />
          </OnlyThere>
          <OnlyThere feature="Terminal" name={name}>
            <Button variant="quiet" size="sm" iconOnly disabled icon={<SquareTerminal size={14} aria-hidden />} aria-label={onlyThereLine('Terminal', name)} data-remote-terminal />
          </OnlyThere>
        </div>
        <OnlyThere feature="The editor" name={name}>
          <Button variant="quiet" iconOnly disabled icon={<SquareCode size={15} aria-hidden />} aria-label={onlyThereLine('The editor', name)} className="@max-[420px]:hidden" data-remote-open-in />
        </OnlyThere>
        <Button
          variant="quiet"
          iconOnly
          icon={<Ellipsis size={15} aria-hidden />}
          aria-label="More"
          aria-haspopup="menu"
          className="no-drag shrink-0"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu({ x: rect.right - 240, y: rect.bottom + 4 });
          }}
          data-remote-more
        />
        <Button
          variant="quiet"
          iconOnly
          icon={<X size={15} />}
          onClick={() => useSessions.getState().closeSession()}
          data-tooltip={`Close session and go Home (it keeps running on ${name})`}
          aria-label="Close session"
          className="no-drag shrink-0"
          data-close-session
        />
      </header>

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        role="region"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        data-transcript
      >
        <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-3 px-6 pt-3 pb-6">
          {error && <Notice tone="error">{error}</Notice>}
          {!loaded && !error && (
            <p className="p-8 text-center text-ui text-muted" role="status">
              {connected ? 'Loading the conversation…' : `The conversation loads once ${name} is back.`}
            </p>
          )}
          {hasMore && (
            <Button variant="quiet" size="sm" className="justify-self-center" onClick={loadEarlier}>
              Show earlier messages
            </Button>
          )}
          {items.map((item) =>
            item.kind === 'user' ? (
              <div key={item.key} className="flex justify-end">
                <div className="relative max-w-[80%] min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5" data-prompt-bubble>
                  <ClampedPrompt itemKey={item.key} className="text-body whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
                    {item.text}
                  </ClampedPrompt>
                  {item.device && <p className="mt-1 text-meta text-faint">from {item.device}</p>}
                </div>
              </div>
            ) : item.kind === 'text' ? (
              <div key={item.key} className="text-body">
                <RemoteText text={item.text} />
              </div>
            ) : (
              <ToolRun key={item.key} tools={item.tools} />
            ),
          )}
          {streaming.kind === 'text' && streaming.text && (
            <div className="text-body">
              <RemoteText text={streaming.text} />
            </div>
          )}
          {working && connected && (
            <p className="flex h-6.5 items-center gap-2 text-ui text-text/85" role="status" data-computer-working>
              <span className="flex w-4 shrink-0 justify-center">
                <WorkingDots />
              </span>
              <span className="min-w-0 truncate">{streaming.kind === 'tool' ? `Using ${streaming.text}…` : streaming.kind === 'thinking' ? 'Thinking…' : 'Working…'}</span>
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-6 pb-4">
        {away && (
          <Notice
            tone="caution"
            data-remote-away={computer.state}
            actions={
              computer.state === 'offline' ? (
                <Button size="sm" icon={<RefreshCw size={12} aria-hidden />} onClick={() => void client.call('computers.retry', { id })}>
                  Try again
                </Button>
              ) : computer.state === 'unpaired' ? (
                <Button size="sm" onClick={() => useSessions.getState().openSettings('remote')}>
                  Pair again
                </Button>
              ) : undefined
            }
          >
            {away}
          </Notice>
        )}
        {connected && prompts.length > 0 && (
          <div className="-m-1 grid max-h-[55vh] gap-2 overflow-y-auto p-1" data-permissions>
            {prompts.map((prompt) => (
              <ComputerPrompt key={prompt.requestId} prompt={prompt} respond={(decision) => respond(prompt, decision)} />
            ))}
          </div>
        )}
        <RemoteComposer client={client} computer={computer} session={session} working={working} onSent={() => (atBottom.current = true)} onStop={stop} />
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} width={240} label={`Session “${session.title}”`} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-faint">
      ·
    </span>
  );
}

/** A control that only works on that computer: in its place, disabled, with the reason as its tooltip (a disabled button gets no hover). */
function OnlyThere({ feature, name, children }: { feature: string; name: string; children: ReactNode }) {
  return (
    <span className="no-drag flex shrink-0" data-tooltip={onlyThereLine(feature, name)}>
      {children}
    </span>
  );
}

/** A run of tool calls as one line, like `ActivityGroup`: "Read 4 files · Edited ContentOverview.tsx +42 −6". A click shows each call. */
function ToolRun({ tools }: { tools: RemoteTool[] }) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  const failures = tools.filter((tool) => tool.failed).length;
  return (
    <div data-activity="done" data-remote-tools={tools.length}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? stepsId : undefined}
        className="group flex h-6.5 w-full min-w-0 items-center gap-2 text-left text-ui"
        data-tooltip={open ? 'Hide steps' : 'Show each step'}
      >
        <span className="flex w-4 shrink-0 justify-center" aria-hidden>
          <ChevronRight size={13} className={`text-faint transition ${open ? 'rotate-90' : ''}`} />
        </span>
        <span className="min-w-0 truncate text-muted group-hover:text-text">{toolsSummary(tools)}</span>
        {failures > 0 && <span className="shrink-0 text-meta text-error">· {failures} failed</span>}
      </button>
      {open && (
        <ul id={stepsId} className="mt-0.5 ml-6 grid gap-0.5 pb-1">
          {tools.map((tool) => {
            const detail = toolLine(tool.name, tool.input);
            return (
              <li key={tool.id} className="flex min-w-0 items-center gap-2 text-ui text-muted">
                <span className={`size-1.5 shrink-0 rounded-full ${tool.failed ? 'bg-error' : 'bg-faint/70'}`} aria-hidden />
                <span className="shrink-0 font-medium">{tool.name}</span>
                {detail && <span className="min-w-0 truncate font-mono text-meta">{detail}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The message box, in the local layout: the computer's chip where the profile chip is, model and mode as read-only
 * chips when that computer says them, Stop while Claude works, and a `remote` border. Images and files go with the
 * message (`RemoteAttachments.tsx`): files only to a computer whose Switchboard takes them.
 */
function RemoteComposer({ client, computer, session, working, onSent, onStop }: { client: RpcClient<Contract>; computer: Computer; session: RemoteSession; working: boolean; onSent(): void; onStop(): void }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const connected = computer.state === 'connected';
  const name = computer.name;
  const attachments = useRemoteAttachments({ computer, rootRef: root, disabledReason: connected ? null : `${name} is not connected` });
  // A prompt is always needed, as on the phone: images and files go with it.
  const hasMessage = !!draft.trim();
  const send = () => {
    const text = draft.trim();
    if (!hasMessage || sending || attachments.reading || !connected) return;
    setSending(true);
    onSent();
    const { images, files } = attachments;
    void callComputer(client, computer.id, 'session.send', { sessionId: session.id, text, mode: 'queue', images, ...(files.length ? { files } : {}) })
      .then(
        ({ queued }) => {
          setDraft('');
          attachments.clear();
          if (queued) toast('Added to Up next', { icon: 'queue', body: `Claude is working on ${name}. It goes next.` });
        },
        (e: Error) => toast(e.message),
      )
      .finally(() => setSending(false));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    } else if (working && matches(event.nativeEvent, 'claude.stop') && !document.querySelector(OVERLAY_SELECTOR)) {
      event.preventDefault();
      onStop();
    }
  };
  const placeholder = !connected ? `${name} is not connected` : working ? `Message Claude on ${name} (queued until this turn ends)` : `Message Claude on ${name}`;
  return (
    <div ref={root} className={`relative rounded-xl border bg-card px-3 pt-2.5 pb-2 shadow-sm transition-colors ${connected ? 'border-remote/45' : 'border-border'}`} data-remote-composer>
      <DropOverlay drop={attachments.drop} />
      <RemoteAttachmentList state={attachments} className="mb-2" />
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={attachments.onPaste}
        rows={1}
        disabled={!connected}
        placeholder={placeholder}
        aria-label={`Message Claude on ${name}`}
        aria-keyshortcuts={working ? formatKeys(keysFor('claude.stop')) : undefined}
        className="block field-sizing-content max-h-80 w-full min-w-0 resize-none bg-transparent text-body leading-relaxed text-text outline-none placeholder:text-faint disabled:opacity-60"
        data-computer-composer
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="-ml-1.5 flex min-w-0 flex-1 items-center gap-1">
          <RemoteAttachButton state={attachments} computer={computer} disabled={!connected} />
          <ComputerChip name={name} size="header" offline={!connected} data-tooltip={`Claude runs on ${name}, with its Claude profile.`} />
          {session.model && (
            <span className="truncate px-1.5 text-ui text-muted" data-tooltip={`Model: ${session.model}`} data-remote-model>
              {session.model}
            </span>
          )}
          {session.permissionMode && (
            <span className="flex shrink-0 items-center gap-1.5 px-1.5 text-ui text-muted" data-tooltip={`Mode: ${MODE_LABEL[session.permissionMode]}`} data-remote-mode>
              <span className={`size-1.5 rounded-full ${MODE_DOT[session.permissionMode] ?? 'bg-faint'}`} aria-hidden />
              {MODE_LABEL[session.permissionMode]}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {working && connected && <span className="text-meta text-muted @max-[860px]:hidden">Claude is working on {name}</span>}
          {working && (
            <Button size="lg" icon={<span className="size-2 rounded-[2px] bg-current" aria-hidden />} shortcut="claude.stop" kbdHideNarrow disabled={!connected} onClick={onStop} data-computer-stop>
              Stop
            </Button>
          )}
          <Button variant="primary" size="lg" iconOnly icon={<ArrowUp size={15} aria-hidden />} aria-label={working ? 'Add to Up next' : 'Send'} disabled={!connected || sending || attachments.reading || !hasMessage} onClick={send} data-computer-send />
        </div>
      </div>
    </div>
  );
}
