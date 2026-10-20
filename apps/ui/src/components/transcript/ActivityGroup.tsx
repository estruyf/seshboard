import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { useSecondClock } from '../../lib/secondClock.ts';
import { LiveTurnParts, type LiveTurnInfo } from './TurnMeta.tsx';
import type { ActivityGroup, DisplayItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { ToolDetails, ToolImages } from './ToolDetails.tsx';
import { activitySummary, stepLabel } from './toolSummary.ts';

/** Three dots taking turns: Claude is working. */
export function WorkingDots() {
  return (
    <span className="working-dots shrink-0" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/** 9s, 4m 12s, 1h 5m. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Ticks once a second while `active`, on the window's one clock. */
export const useTicker = useSecondClock;

// Open groups and steps survive scrolling out of the virtualised list and back.
const openKeys = new Set<string>();
function useOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => openKeys.has(key));
  return [
    open,
    () => {
      if (open) openKeys.delete(key);
      else openKeys.add(key);
      setOpen(!open);
    },
  ];
}

const endOf = (item: DisplayItem) => (item.kind === 'tool' ? (item.result?.at ?? item.at) : item.at);

function Step({ item, cwd, sessionId }: { item: DisplayItem; cwd: string | null; sessionId: string }) {
  const [open, toggle] = useOpen(`step:${item.key}`);
  const label = stepLabel(item, cwd).past;
  const failed = item.kind === 'tool' && (item.result?.isError ?? false);
  const detailsId = useId();
  return (
    <div data-step>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        className="group flex h-6.5 w-full min-w-0 items-center gap-2 text-left text-ui text-muted hover:text-text"
      >
        <span className="flex w-4 shrink-0 justify-center" aria-hidden>
          <span className={`size-1.5 rounded-full ${failed ? 'bg-error' : 'bg-faint/70'}`} />
        </span>
        <span className="min-w-0 truncate">{label}</span>
        {failed && <span className="shrink-0 text-meta text-error">failed</span>}
        <ChevronRight size={13} className={`shrink-0 text-faint opacity-0 transition group-hover:opacity-100 ${open ? 'rotate-90 opacity-100' : ''}`} aria-hidden />
      </button>
      {open && (
        <div id={detailsId} className="mt-0.5 ml-6 pb-1.5">
          {item.kind === 'tool' ? (
            <ToolDetails item={item} cwd={cwd} sessionId={sessionId} withDiffAndImages />
          ) : item.kind === 'thinking' ? (
            <p className="text-ui whitespace-pre-wrap text-muted italic select-text">{item.text}</p>
          ) : item.kind === 'text' || item.kind === 'user' || item.kind === 'agent-report' ? (
            <div className="text-body">
              <Markdown text={item.text} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * A run of tool calls as one line, like Claude Code: while Claude works, the step it's on
 * ("Reading src/a.ts") with a timer; afterwards, what it did ("Ran 3 commands and edited a file").
 * Click to see each step, and a step to see its details.
 */
export function ActivityGroupView({
  group,
  cwd,
  sessionId,
  active,
  activeLabel,
  live = null,
}: {
  group: ActivityGroup;
  cwd: string | null;
  sessionId: string;
  /** This is the run Claude is working on now. */
  active: boolean;
  /** Overrides the current step while Claude is between steps (thinking, waiting for you). */
  activeLabel: string | null;
  /** While active: the turn's live numbers, which the working line shows instead of the run's own time. */
  live?: LiveTurnInfo | null;
}) {
  const [open, toggle] = useOpen(group.key);
  const now = useTicker(active && !live);
  const items = group.items;
  const last = items.at(-1)!;
  const started = items[0]!.at;
  const ended = active ? now : endOf(last);
  const duration = started !== null && ended !== null ? formatDuration(ended - started) : null;
  const failures = items.filter((i) => i.kind === 'tool' && i.result?.isError).length;
  // One step reads best as itself ("Run the unit tests"); several as what they add up to.
  const steps = items.filter((i) => i.kind !== 'thinking');
  const label = active ? (activeLabel ?? stepLabel(last, cwd).present) : steps.length === 1 ? stepLabel(steps[0]!, cwd).past : activitySummary(items);
  const images = items.filter((i) => i.kind === 'tool' && (i.result?.images.length ?? 0) > 0);
  const stepsId = useId();

  return (
    <div data-activity={active ? 'active' : 'done'}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? stepsId : undefined}
        className="group flex h-6.5 w-full min-w-0 items-center gap-2 text-left text-ui"
        data-tooltip={open ? 'Hide steps' : 'Show each step'}
      >
        <span className="flex w-4 shrink-0 justify-center" aria-hidden>
          {active ? <WorkingDots /> : <span className={`size-1.5 rounded-full ${failures > 0 ? 'bg-error' : 'bg-ok'}`} />}
        </span>
        <span className={`min-w-0 truncate ${active ? 'text-text/85' : 'text-muted group-hover:text-text'}`}>{label}</span>
        {failures > 0 && !active && <span className="shrink-0 text-meta text-error">· {failures} failed</span>}
        {/* While Claude works on it: the turn's time and tokens so far, as the setting says. */}
        {active && live && <LiveTurnParts live={live} startedAt={null} />}
        {/* How long the run took (still counting while Claude works on it). */}
        {duration && !(active && live) && (
          <span className="shrink-0 text-meta text-faint tabular-nums">
            <span className="sr-only">{active ? ', running for ' : ', took '}</span>
            {duration}
          </span>
        )}
        <ChevronRight size={13} className={`shrink-0 text-faint opacity-0 transition group-hover:opacity-100 ${open ? 'rotate-90 opacity-100' : ''}`} aria-hidden />
      </button>

      {/* Images stay in view, like the attachments they often are (screenshots Claude took or read). */}
      {!open && images.length > 0 && (
        <div className="ml-6">
          {images.map((item) => item.kind === 'tool' && <ToolImages key={item.key} item={item} sessionId={sessionId} />)}
        </div>
      )}

      {open && (
        // Each step is a quiet row of its own, indented under the summary; no box around them.
        <div id={stepsId} className="ml-6" data-steps>
          {items.map((item) => (
            <Step key={item.key} item={item} cwd={cwd} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  );
}
