import { Bot, ChevronRight, ClipboardList } from 'lucide-react';
import type { HookableComponent } from '@switchboard/protocol/client';
import { useMods } from '../../state/modsStore.ts';
import { ModReplaced, useExpectedHooked } from '../mods/ModReplaced.tsx';
import { replaceableOf } from '../mods/modReplace.ts';
import { memo, useId, useMemo, useState, type ReactNode } from 'react';
import { isAbsolutePath, parseBriefs, parseGithubBlocks } from '@switchboard/protocol/client';
import { LinkedSessions } from './LinkedSessions.tsx';
import { GithubAttached } from './GithubAttached.tsx';
import { fileLinkChipLabel } from './fileLinkAction.ts';
import { useFileLinkActions } from './useFileLinkActions.tsx';
import { DiffView } from './DiffView.tsx';
import { ActivityGroupView } from './ActivityGroup.tsx';
import { ClampedPrompt } from './ClampedPrompt.tsx';
import type { DisplayItem, RenderItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { MessageToolbar, messageUuid, REVEAL_IN_REPLY_ROW } from './messageActions.tsx';
import { sentLine } from './turnFormat.ts';
import { TurnMetaLine, type LiveTurnInfo } from './TurnMeta.tsx';
import { useRemote } from '../../state/remoteStore.ts';
import { ToolDetails, ToolImages, type ToolItem } from './ToolDetails.tsx';
import { messageImageSlots } from './imageLayout.ts';
import { TranscriptImage } from './TranscriptImage.tsx';
import { parseTodos, TodoList } from './TodoList.tsx';
import { editHunks, toolSummary } from './toolSummary.ts';
import { memoryWriteOf } from './memoryWrites.ts';
import { SavedMemoryLine } from '../memory/SavedMemoryLine.tsx';
import { useKnownMemoryFolders } from '../memory/useMemoryFolders.ts';
import { useSessions } from '../../state/sessionsStore.ts';

/**
 * A quiet timeline row (26px) that shows or hides the details under it: a status mark, then the
 * label and detail, then a chevron. `after` sits next to the toggle rather than inside it, because
 * a button can't hold another control (screen readers and keyboards lose it).
 */
function Disclosure({ open, onToggle, controls, mark, after, children }: { open: boolean; onToggle: () => void; controls: string; mark: ReactNode; after?: ReactNode; children: ReactNode }) {
  return (
    <div className="group/row flex h-6.5 w-full min-w-0 items-center gap-2">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={open ? controls : undefined} className="flex h-full min-w-0 flex-1 items-center gap-2 text-left">
        <span className="flex w-4 shrink-0 justify-center">{mark}</span>
        {children}
        <ChevronRight size={13} className={`shrink-0 text-faint opacity-0 transition group-hover/row:opacity-100 ${open ? 'rotate-90 opacity-100' : ''}`} aria-hidden />
      </button>
      {after}
    </div>
  );
}

/** Details under a timeline row: lined up with the label, no card around them. */
const below = 'ml-6 mt-1 pb-1';

/** The small status mark at the start of a timeline row. */
function Dot({ state }: { state: 'ok' | 'error' | 'pending' }) {
  const label = state === 'pending' ? 'No result yet' : state === 'error' ? 'Failed' : 'Succeeded';
  return <span className={`size-1.5 shrink-0 rounded-full ${state === 'ok' ? 'bg-ok' : state === 'error' ? 'bg-error' : 'bg-faint'}`} data-tooltip={label} role="img" aria-label={label} />;
}

function Spinner() {
  return <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" data-tooltip="Running" role="img" aria-label="Running" />;
}

/** Says who wrote a message, for screen readers; it also lets VoiceOver jump between messages by heading. */
function Speaker({ name }: { name: string }) {
  return <h2 className="sr-only">{name}</h2>;
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The file a tool touched (absolute path) and, for Read, the line it started at. */
function fileTarget(item: ToolItem): { path: string; line?: number } | null {
  if (!FILE_TOOLS.has(item.name)) return null;
  const input = item.input as { file_path?: unknown; notebook_path?: unknown; offset?: unknown };
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null;
  if (!path || !isAbsolutePath(path)) return null;
  return typeof input.offset === 'number' && input.offset > 0 ? { path, line: input.offset } : { path };
}

/**
 * The chip beside a tool run that touched a file: a click does what Settings › Conversation says for a file link (show it
 * in the file manager, or open it in the editor), Shift-click does the other, and the context menu lists both. It is the
 * same action as a file link in a reply (`useFileLinkActions`), so a file that is gone shows its error here too.
 */
function FileToolChip({ path, line }: { path: string; line?: number }) {
  const { action, tooltip, error, handlers, extras } = useFileLinkActions(path, line);
  const label = fileLinkChipLabel(action);
  return (
    <>
      <button
        type="button"
        {...handlers}
        data-tooltip={error ?? tooltip}
        aria-label={error ?? tooltip}
        data-file-chip={path}
        data-file-link-action={action}
        className={`shrink-0 rounded px-1 text-meta group-hover/row:opacity-100 hover:bg-border/60 focus-visible:opacity-100 ${error ? 'text-error opacity-100' : 'text-muted opacity-0 hover:text-accent-ink'}`}
      >
        {label}
      </button>
      {extras}
    </>
  );
}

const resultState = (item: ToolItem) => (item.result === null ? 'pending' : item.result.isError ? 'error' : 'ok');

function ToolCard({ item, cwd, sessionId }: { item: ToolItem; cwd: string | null; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const target = fileTarget(item);
  const hunks = editHunks(item);
  const isAgent = item.name === 'Task' || item.name === 'Agent';
  const { label, detail } = toolSummary(item.name, item.input, cwd);
  const failed = item.result?.isError ?? false;
  const detailsId = useId();

  return (
    <div data-tool={item.name}>
      <Disclosure
        open={open}
        onToggle={() => setOpen((o) => !o)}
        controls={detailsId}
        // A running agent spins; everything else shows how it went.
        mark={isAgent && item.result === null ? <Spinner /> : <Dot state={resultState(item)} />}
        after={target && <FileToolChip path={target.path} line={target.line} />}
      >
        {isAgent && <Bot size={13} className="shrink-0 text-muted" aria-hidden />}
        <span className="shrink-0 text-ui font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">{detail}</span>
      </Disclosure>

      {/* File changes show their diff without expanding, like the CLI. */}
      {hunks && !failed && (
        <div className="ml-6">
          <DiffView hunks={hunks} truncated={item.inputTruncated} />
        </div>
      )}

      {/* Images a tool returned (e.g. reading a screenshot) are shown right away. */}
      <div className="ml-6">
        <ToolImages item={item} sessionId={sessionId} />
      </div>

      {open && (
        <div id={detailsId} className={below}>
          <ToolDetails item={item} cwd={cwd} sessionId={sessionId} />
        </div>
      )}
      {!open && failed && item.result && (
        <p className="mt-0.5 ml-6 line-clamp-2 font-mono text-meta text-error">
          <span className="sr-only">Failed: </span>
          {item.result.text}
        </p>
      )}
    </div>
  );
}

function PlanCard({ item }: { item: ToolItem }) {
  const plan = (item.input as { plan?: unknown }).plan;
  const verdict = item.result === null ? null : item.result.isError ? 'Not approved' : 'Approved';
  return (
    <div className="rounded-xl border border-accent-ink/30 bg-card px-4 py-3 text-body" data-plan>
      <p className="mb-1 flex items-center gap-2 text-ui font-medium text-muted">
        <ClipboardList size={14} className="text-accent-ink" aria-hidden /> Plan
        {verdict && <span className={`rounded px-1.5 text-meta ${verdict === 'Approved' ? 'bg-ok/15 text-ok' : 'bg-border text-muted'}`}>{verdict}</span>}
      </p>
      <Markdown text={typeof plan === 'string' ? plan : ''} />
    </div>
  );
}

/** A background agent's final report (Every step mode; summarised, it's a step in the group). */
function AgentReport({ title, text, failed }: { title: string; text: string; failed: boolean }) {
  const [open, setOpen] = useState(false);
  const reportId = useId();
  return (
    <div data-agent-report>
      <Disclosure open={open} onToggle={() => setOpen((o) => !o)} controls={reportId} mark={<Dot state={failed ? 'error' : 'ok'} />}>
        <Bot size={13} className="shrink-0 text-muted" aria-hidden />
        <span className={`min-w-0 flex-1 truncate text-ui ${failed ? 'text-error' : 'text-muted'}`}>
          {title}
          {failed && <span className="sr-only"> (did not complete)</span>}
        </span>
      </Disclosure>
      {open && (
        <div id={reportId} className={`${below} text-body`}>
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

/** Claude's task list as a timeline row ("Tasks · 2 of 4 done") with the list under it. */
function TodoRow({ item, className }: { item: ToolItem; className: string }) {
  const todos = parseTodos(item.input);
  const done = todos.filter((t) => t.status === 'completed').length;
  const working = todos.some((t) => t.status === 'in_progress');
  return (
    <div className={className} data-tool="TodoWrite">
      <div className="flex h-6.5 min-w-0 items-center gap-2">
        <span className="flex w-4 shrink-0 justify-center" aria-hidden>
          <span className={`size-1.5 rounded-full ${done === todos.length && todos.length > 0 ? 'bg-ok' : working ? 'bg-accent-ink' : 'bg-faint'}`} />
        </span>
        <span className="shrink-0 text-ui font-medium">Tasks</span>
        <span className="min-w-0 truncate font-mono text-meta text-muted">
          {done} of {todos.length} done
        </span>
      </div>
      <div className="ml-6 pb-1">
        <TodoList todos={todos} />
      </div>
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const thoughtsId = useId();
  return (
    <div className="text-ui text-muted">
      <Disclosure open={open} onToggle={() => setOpen((o) => !o)} controls={thoughtsId} mark={<span className="size-1.5 rounded-full bg-faint/70" aria-hidden />}>
        <span className="italic">Thinking</span>
      </Disclosure>
      {open && (
        <p id={thoughtsId} className={`${below} whitespace-pre-wrap text-muted italic select-text`}>
          {text}
        </p>
      )}
    </div>
  );
}

/** One rendered transcript item. Memoised by item, since finished items never change. */
/** A tool call, or, when it saved a memory, the Saved memory line. */
function ToolOrMemory({ item, cwd, sessionId }: { item: ToolItem; cwd: string | null; sessionId: string }) {
  const folders = useKnownMemoryFolders();
  const root = useSessions((s) => s.sessions.get(sessionId)?.projectRoot ?? null);
  const write = memoryWriteOf(item.name, item.input, folders);
  if (write && !(item.result?.isError ?? false)) return <SavedMemoryLine write={write} root={root} />;
  return <ToolCard item={item} cwd={cwd} sessionId={sessionId} />;
}

/** Your prompt, on the right as a card; hovering it says when you sent it, and from which paired device. */
function PromptItem({ item, sessionId }: { item: Extract<DisplayItem, { kind: 'user' }>; sessionId: string }) {
  const device = useRemote((s) => s.sentFrom.get(messageUuid(item.key)) ?? null);
  const sent = item.at !== null ? sentLine(item.at, device) : undefined;
  // Linked sessions' briefs and attached issues show as rows under what you typed, not as code blocks in it.
  const { text, briefs, issues } = useMemo(() => {
    if (item.subagent) return { text: item.text, briefs: [], issues: [] };
    const github = parseGithubBlocks(item.text);
    const parsed = parseBriefs(github.text);
    return { text: parsed.text, briefs: parsed.briefs, issues: github.blocks };
  }, [item.text, item.subagent]);
  return (
    // Your prompt sits on the right as a card, so the conversation reads like a chat.
    <div className="flex justify-end">
      <div
        className="group/message relative max-w-[80%] min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5"
        data-remember-from={item.subagent ? undefined : 'user'}
        data-message-key={item.key}
        data-prompt-bubble={item.subagent ? undefined : true}
        data-tooltip={item.subagent ? undefined : sent}
      >
        <Speaker name={item.subagent ? 'Prompt to the subagent' : 'You'} />
        {(item.text || !item.subagent) && <MessageToolbar itemKey={item.key} kind="user" text={text} copyOnly={item.subagent} />}
        {/* Images come first, so "Show more" never hides them: one large, a few as thumbnails, many as tiles. */}
        {item.images.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 ${text ? 'mb-2' : ''}`} data-prompt-images={item.images.length}>
            {messageImageSlots(item.images.length).map((slot) => {
              const image = item.images[slot.index]!;
              return <TranscriptImage key={image.imageId} sessionId={sessionId} image={image} variant={slot.variant} gallery={item.images} index={slot.index} more={slot.more} />;
            })}
          </div>
        )}
        {/* Your prompts render as Markdown too, so code and code blocks are styled. */}
        {text && (
          <ClampedPrompt itemKey={item.key} className="text-body [overflow-wrap:anywhere] [&_p]:whitespace-pre-wrap [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <Markdown text={text} />
          </ClampedPrompt>
        )}
        <LinkedSessions briefs={briefs} />
        <GithubAttached blocks={issues} at={item.at} divided={briefs.length === 0} />
      </div>
    </div>
  );
}

const NO_HOOKED: readonly HookableComponent[] = [];

export const TranscriptItem = memo(function TranscriptItem(props: {
  item: RenderItem;
  cwd: string | null;
  sessionId: string;
  active?: boolean;
  activeLabel?: string | null;
  /** For the activity group Claude is on: the live part of the working line. */
  live?: LiveTurnInfo | null;
}) {
  // A mod that replaces this kind of item draws it, with the built-in one where it puts its `engine` node.
  const hooked = useMods((s) => s.sessions.get(props.sessionId)?.state.hooked) ?? NO_HOOKED;
  const expected = useExpectedHooked(props.sessionId);
  const target = replaceableOf(props.item, hooked.length ? hooked : expected);
  const builtIn = <BuiltInItem {...props} />;
  return target ? (
    <ModReplaced sessionId={props.sessionId} target={target}>
      {builtIn}
    </ModReplaced>
  ) : (
    builtIn
  );
});

function BuiltInItem({
  item,
  cwd,
  sessionId,
  active = false,
  activeLabel = null,
  live = null,
}: {
  item: RenderItem;
  cwd: string | null;
  sessionId: string;
  /** For an activity group: Claude is working on it now. */
  active?: boolean;
  activeLabel?: string | null;
  live?: LiveTurnInfo | null;
}) {
  if (item.kind === 'activity') return <ActivityGroupView group={item} cwd={cwd} sessionId={sessionId} active={active} activeLabel={activeLabel} live={live} />;
  if (item.kind === 'user') return <PromptItem item={item} sessionId={sessionId} />;
  const indent = 'subagent' in item && item.subagent ? 'ml-6 border-l border-border pl-3' : '';
  switch (item.kind) {
    case 'command':
      return (
        // A prompt card like your other messages: the command as a chip, then everything you wrote after it.
        <div className="flex justify-end" data-command-item>
          <div className="group/message relative max-w-[80%] min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5">
            <Speaker name="You ran a command" />
            <MessageToolbar itemKey={item.key} kind="command" text={item.args ? `${item.name} ${item.args}` : item.name} />
            <ClampedPrompt itemKey={item.key} className="text-body whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
              <span className="mr-1.5 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-ui text-accent-ink [box-decoration-break:clone]">{item.name}</span>
              {item.args}
            </ClampedPrompt>
          </div>
        </div>
      );
    case 'text':
      return (
        <div className={`group/message relative text-body ${indent}`} data-remember-from={item.subagent ? undefined : 'claude'} data-message-key={item.key}>
          <Speaker name={item.subagent ? 'Subagent' : 'Claude'} />
          <Markdown text={item.text} />
          {/* The actions, then (under a turn's last reply) when the turn ended, how long it took and its tokens: both
              hidden until the reply is hovered or the row has focus, with their space kept. */}
          <div className="group/reply-row -ml-1 mt-1 flex h-6 min-w-0 items-center gap-2">
            <MessageToolbar itemKey={item.key} kind="text" text={item.text} copyOnly={item.subagent} />
            {!item.subagent && <TurnMetaLine itemKey={item.key} className={REVEAL_IN_REPLY_ROW} />}
          </div>
        </div>
      );
    case 'thinking':
      return <Thinking text={item.text} />;
    case 'tool':
      if (item.name === 'TodoWrite') return <TodoRow item={item} className={indent} />;
      if (item.name === 'ExitPlanMode') return <PlanCard item={item} />;
      return (
        <div className={indent}>
          <ToolOrMemory item={item} cwd={cwd} sessionId={sessionId} />
        </div>
      );
    case 'agent-report':
      return <AgentReport title={item.title} text={item.text} failed={item.status !== 'completed'} />;
    case 'notice':
      return <p className="text-center text-meta whitespace-pre-wrap text-muted">{item.text}</p>;
  }
}
