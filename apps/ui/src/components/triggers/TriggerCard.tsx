import { AlertTriangle, Clock, MoreHorizontal, Pause, RefreshCw, Tag, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Trigger, TriggerEvent } from '@switchboard/protocol/client';
import { modelLabel } from '../../lib/autoModel.ts';
import { MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { cardEvents, checkedLine, eventDetail, eventTitle, pausedLine, speakEvent, statusPill, triggerCounts, workflowsLine, type EventSessionState } from '../../state/triggers.ts';
import { checkTriggerNow, openTriggerEditor, setTriggerPaused, startTriggerEvent, useTriggers } from '../../state/triggersStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { SourceIcon } from './TriggerEditor.tsx';
import { triggerEntries } from './triggerMenu.tsx';
import { useTriggerSessions } from './useTriggerSessions.ts';

/** How many events a card shows before "Show all N events". */
const SHOWN = 3;

const STATE_WORDS: Record<EventSessionState, string> = { working: 'Working', 'needs-you': 'Needs you', finished: 'Finished' };
const STATE_DOT: Record<EventSessionState, string> = { working: 'bg-accent-ink', 'needs-you': 'bg-warn', finished: 'bg-faint' };
const STATE_BOLT: Record<EventSessionState, string> = { working: 'text-accent-ink', 'needs-you': 'text-warn', finished: 'text-ok' };

/**
 * One trigger on its project's Triggers tab: the source's icon, the name and the filter, a status pill ("2 of 3
 * busy"), what its sessions run with and when it last looked, Check now, a pause switch and ⋯. Its events are under
 * it, the last three first. A paused card is dimmed and says why.
 */
export function TriggerCard({ trigger, events, now }: { trigger: Trigger; events: TriggerEvent[]; now: number }) {
  const { stateOf, busy } = useTriggerSessions();
  const models = useHosts((s) => s.models);
  const login = useTriggers((s) => s.repoInfo.get(trigger.projectRoot)?.login ?? null);
  const checking = useTriggers((s) => s.checking.has(trigger.id));
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const sorted = useMemo(() => cardEvents(events), [events]);
  const shown = all ? sorted : sorted.slice(0, SHOWN);
  const counts = triggerCounts(trigger, events, busy);
  const pill = statusPill(trigger, counts);
  const waiting = sorted.filter((e) => e.status === 'waiting');
  const source = trigger.source;
  const paused = pausedLine(trigger);

  const meta = [
    source.kind === 'ci' ? workflowsLine(source.workflows) : trigger.stateLabels.on ? 'State labels on' : null,
    trigger.draft.workspace === 'worktree' ? 'New worktree' : 'Project folder',
    modelLabel(models, trigger.draft.model ?? ''),
    MODE_LABEL[trigger.draft.permissionMode],
    checkedLine(trigger.lastCheckedAt, now),
  ].filter(Boolean);

  return (
    <article
      className="grid gap-3 rounded-xl border border-border bg-card p-4"
      aria-label={`${trigger.name}${paused ? `, ${paused}` : pill ? `, ${pill.text}` : ''}`}
      data-trigger-card={trigger.id}
      data-trigger-paused={trigger.paused || undefined}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className={trigger.paused ? 'opacity-55' : ''}>
          <SourceIcon kind={source.kind} size={32} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-title font-semibold ${trigger.paused ? 'text-muted' : 'text-text'}`}>
            <span className="truncate">{trigger.name}</span>
            {source.kind === 'issues' && source.label && (
              <Pill icon={<Tag size={11} aria-hidden />} className="font-normal" data-trigger-filter-label>
                {source.label}
              </Pill>
            )}
            {source.kind === 'issues' && source.label && source.assignee && <span className="text-ui font-normal text-muted">and assigned to</span>}
            {source.kind === 'issues' && source.assignee && (
              <Pill className="font-normal" data-trigger-filter-assignee>
                @{source.assignee === '@me' ? (login ?? 'me') : source.assignee}
              </Pill>
            )}
            {pill && (
              <Pill tone={pill.tone === 'caution' ? 'caution' : 'default'} icon={trigger.paused ? <Pause size={10} aria-hidden /> : undefined} className={`font-medium ${pill.tone === 'working' ? 'bg-accent/15 text-accent-ink' : ''}`} data-trigger-status>
                {pill.text}
              </Pill>
            )}
          </h3>
          {paused ? (
            <p className="text-ui text-caution" data-trigger-paused-reason>
              {paused}
            </p>
          ) : (
            <p className="truncate text-meta text-muted" data-trigger-meta>
              {meta.join(' · ')}
            </p>
          )}
          {!trigger.paused && trigger.blockedUntil !== null && trigger.blockedUntil > now && (
            <p className="text-meta text-caution">GitHub asked to slow down. The next check is after {new Date(trigger.blockedUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.</p>
          )}
          {!trigger.paused && trigger.failures > 0 && trigger.lastError && (
            <p className="text-meta text-caution" data-trigger-failing>
              The last {trigger.failures === 1 ? 'check' : `${trigger.failures} checks`} failed: {trigger.lastError}. It pauses after 5 in a row.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {trigger.paused ? (
            <Button size="md" onClick={() => openTriggerEditor({ root: trigger.projectRoot, trigger })} data-trigger-edit>
              Edit…
            </Button>
          ) : (
            <Button
              size="md"
              icon={<RefreshCw size={12} aria-hidden className={checking ? 'animate-spin motion-reduce:animate-none' : ''} />}
              disabled={checking}
              aria-busy={checking || undefined}
              onClick={() => void checkTriggerNow(trigger)}
              data-trigger-check
              data-trigger-checking={checking || undefined}
            >
              {checking ? 'Checking…' : 'Check now'}
            </Button>
          )}
          <Switch
            checked={!trigger.paused}
            label={trigger.paused ? `Resume ${trigger.name}` : `Pause ${trigger.name}`}
            onChange={(on) => void setTriggerPaused(trigger, !on).catch((e: Error) => toast(`Couldn't ${on ? 'resume' : 'pause'} it: ${e.message}`))}
            dataAttrs={{ 'data-trigger-switch': true }}
          />
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<MoreHorizontal size={15} aria-hidden />}
            aria-label={`More for ${trigger.name}`}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.right - 220, y: rect.bottom + 4 });
            }}
            data-trigger-more
          />
        </div>
      </div>

      {shown.length > 0 && (
        <ul className="grid border-t border-border pl-11" aria-label={`Events of ${trigger.name}`}>
          {shown.map((event) => (
            <TriggerEventRow key={event.id} event={event} state={event.status === 'started' ? stateOf(event.sessionId) : null} now={now} position={waiting.indexOf(event) + 1 || undefined} of={trigger.maxWaiting} />
          ))}
        </ul>
      )}
      {sorted.length > SHOWN && (
        <button type="button" className="ml-11 w-fit text-meta text-muted hover:text-text" aria-expanded={all} onClick={() => setAll(!all)} data-trigger-show-all>
          {all ? 'Show fewer' : `Show all ${sorted.length} events`}
        </button>
      )}
      {menu && <Menu x={menu.x} y={menu.y} entries={triggerEntries(trigger)} label={`${trigger.name} menu`} onClose={() => setMenu(null)} />}
    </article>
  );
}

/**
 * One event: a session that works on it (Working, Needs you or Finished, with Open), one waiting for a slot (Start
 * now), or one skipped with why (Start anyway). Screen readers hear it as one line: "Issue 214, Archive keeps the
 * scroll position, waiting for a slot, 1 of 10".
 */
export function TriggerEventRow({ event, state, now, position, of }: { event: TriggerEvent; state: EventSessionState | null; now: number; position?: number; of?: number }) {
  const icon =
    event.status === 'started' && state ? (
      <Zap size={14} className={STATE_BOLT[state]} aria-hidden />
    ) : event.status === 'waiting' || event.status === 'queued' ? (
      <Clock size={14} className="text-muted" aria-hidden />
    ) : event.status === 'skipped' ? (
      <AlertTriangle size={14} className="text-caution" aria-hidden />
    ) : (
      <Zap size={14} className="text-faint" aria-hidden />
    );
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-border py-2.5 last:border-b-0" aria-label={speakEvent(event, state, { position, of })} data-trigger-event={event.id} data-trigger-event-status={event.status}>
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-body text-text">{eventTitle(event)}</span>
        <span className="truncate text-meta text-muted">
          {eventDetail(event, now, { position, of })}
          {event.label && event.kind === 'issue' && (
            <>
              {' · '}
              <span className="text-text/80">{event.label}</span>
            </>
          )}
          {event.reassignedTo && <> · now assigned to @{event.reassignedTo}</>}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-ui">
        {event.status === 'started' && state && (
          <>
            <span className="flex items-center gap-1.5 text-muted">
              <span className={`size-1.5 rounded-full ${STATE_DOT[state]}`} aria-hidden />
              {STATE_WORDS[state]}
            </span>
            {event.sessionId && (
              <button type="button" className="text-link hover:underline" onClick={() => useSessions.getState().select(event.sessionId!)} data-trigger-event-open>
                Open
              </button>
            )}
          </>
        )}
        {event.status === 'waiting' && (
          <Button size="md" onClick={() => void startTriggerEvent(event)} data-trigger-event-start>
            Start now
          </Button>
        )}
        {(event.status === 'skipped' || event.status === 'replaced') && (
          <Button size="md" onClick={() => void startTriggerEvent(event)} data-trigger-event-start>
            Start anyway
          </Button>
        )}
        {event.url && (
          <a href={event.url} target="_blank" rel="noreferrer" className="text-meta text-muted hover:text-link" aria-label={`Open ${event.kind === 'ci' ? 'the run' : 'the issue'} on GitHub`} data-tooltip="Open on GitHub">
            GitHub
          </a>
        )}
      </div>
    </li>
  );
}
