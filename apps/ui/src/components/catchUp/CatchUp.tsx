import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CatchUp as CatchUpCardData, GitChanges } from '@switchboard/protocol/client';
import { turnKey, useCatchUp } from '../../state/catchUpStore.ts';
import { closeChanges } from '../../state/changesPanelStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { OVERLAY_SELECTOR } from '../session/permissionKeys.ts';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import {
  ACTION_KEYS,
  actionLabel,
  catchUpKey,
  chipsOf,
  escapeStep,
  NEED_TONE,
  primaryAction,
  reviewLabel,
  secondaryActions,
  stateLabel,
  type CatchUpActionId,
  type CatchUpShow,
  type CatchUpTone,
  type KeyTarget,
} from './catchUpModel.ts';
import { useCatchUpActions, type CatchUpActions } from './useCatchUpActions.tsx';

// Status colours only, as whole class names so Tailwind finds them.
const DOT: Record<CatchUpTone, string> = { unread: 'bg-unread', error: 'bg-error', warn: 'bg-warn', ok: 'bg-ok', caution: 'bg-caution', neutral: 'bg-faint' };
const TEXT: Record<CatchUpTone, string> = { unread: 'text-unread', error: 'text-error', warn: 'text-warn', ok: 'text-ok', caution: 'text-caution', neutral: 'text-muted' };
const PILL = { ok: 'ok', error: 'error', caution: 'caution', warn: 'warn', neutral: 'muted', unread: 'link' } as const;

interface Shared {
  card: CatchUpCardData;
  actions: CatchUpActions;
  unread: boolean;
  committed: boolean;
  changesOpen: boolean;
}

function StateLabel({ card, committed }: { card: CatchUpCardData; committed: boolean }) {
  const state = stateLabel(card, committed);
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-ui font-semibold ${TEXT[state.tone]}`} data-catchup-state={state.label}>
      <span className={`size-2 shrink-0 rounded-full ${DOT[state.tone]}`} aria-hidden />
      {state.label}
    </span>
  );
}

/** One of the catch-up's actions as a button with its key: the primary one in yellow (also ↩), the others bordered. */
function ActionButton({ id, primary, actions, changesOpen, size = 'md' }: { id: CatchUpActionId; primary: boolean; actions: CatchUpActions; changesOpen: boolean; size?: 'sm' | 'md' }) {
  const letter = ACTION_KEYS[id];
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size={size}
      kbd={letter}
      onClick={() => actions.run(id)}
      aria-keyshortcuts={primary ? `Enter ${letter.toUpperCase()}` : letter.toUpperCase()}
      data-catchup-action={id}
      data-catchup-primary={primary || undefined}
    >
      {actionLabel(id, { changesOpen })}
      {primary && <Kbd keys="enter" tone="on-accent" aria-hidden />}
    </Button>
  );
}

function Chips({ card }: { card: CatchUpCardData }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-catchup-chips>
      {chipsOf(card).map((chip) => (
        <Pill key={chip.id} tone={PILL[chip.tone]} icon={<span className={`size-1.5 shrink-0 rounded-full ${DOT[chip.tone]}`} aria-hidden />} data-tooltip={chip.tooltip} data-catchup-chip={chip.id}>
          {chip.text}
        </Pill>
      ))}
    </div>
  );
}

function Lines({ title, lines, empty }: { title: string; lines: readonly string[]; empty?: string }) {
  return (
    <div className="min-w-0">
      <SectionHeader as="h3">{title}</SectionHeader>
      {lines.length ? (
        <ul className="mt-1.5 grid list-disc gap-1 pl-4 text-body text-text/90 marker:text-faint">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-body text-muted">{empty}</p>
      )}
    </div>
  );
}

/** The banner folded into one row: the state, what it needs, the review time, the primary action and Show catch-up. */
function CatchUpStrip({ card, actions, committed, changesOpen }: Shared) {
  const primary = primaryAction(card.need.kind, committed);
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-3 @max-[860px]:px-4">
      <div role="region" aria-label="Catch-up" className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3" data-catchup-strip data-catchup-need={card.need.kind}>
        <StateLabel card={card} committed={committed} />
        <span className="min-w-0 flex-1 truncate text-ui text-text/85">{committed ? 'Committed' : card.need.title}</span>
        <span className="shrink-0 text-meta text-muted @max-[640px]:hidden">{reviewLabel(card)}</span>
        <ActionButton id={primary} primary actions={actions} changesOpen={changesOpen} size="sm" />
        <Button variant="quiet" size="sm" kbd="space" onClick={() => actions.fold(false)} data-catchup-show>
          Show catch-up
        </Button>
      </div>
    </div>
  );
}

/**
 * The banner over the conversation: the state, your ask, the review time and the primary action, then what it needs and
 * the signals. Details (Space) opens what Claude did and skipped, and the other actions.
 */
function CatchUpBanner({ card, actions, unread, committed, changesOpen, details }: Shared & { details: boolean }) {
  const tone = committed ? 'ok' : NEED_TONE[card.need.kind];
  const primary = primaryAction(card.need.kind, committed);
  const secondary = secondaryActions(card, { unread, committed });
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-3 @max-[860px]:px-4">
      <section aria-label="Catch-up" className="grid gap-1.5 rounded-[14px] border border-border bg-card px-4 py-2.5 shadow-overlay" data-catchup data-catchup-banner data-catchup-need={card.need.kind} data-catchup-source={card.source}>
        <div className="flex min-w-0 items-center gap-2.5">
          <StateLabel card={card} committed={committed} />
          <span className="min-w-0 flex-1 truncate text-body text-text" data-catchup-ask>
            {card.ask}
          </span>
          <span className="shrink-0 text-ui font-semibold text-text @max-[640px]:hidden" data-catchup-review>
            {reviewLabel(card)}
          </span>
          <ActionButton id={primary} primary actions={actions} changesOpen={changesOpen} />
          <Button variant="secondary" size="md" kbd="space" selected={details} aria-expanded={details} onClick={() => useCatchUp.getState().setDetails(card, !details)} data-catchup-details-toggle>
            Details
          </Button>
          <Button variant="quiet" iconOnly icon={<X size={15} aria-hidden />} aria-label="Collapse the catch-up (Esc)" data-tooltip="Collapse (Esc)" onClick={() => actions.fold(true)} data-catchup-collapse />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pl-4">
          <span className={`shrink-0 text-ui font-semibold ${TEXT[tone]}`}>{committed ? 'Committed' : card.need.title}</span>
          <span className="min-w-0 flex-1 basis-48 text-ui text-muted">{committed ? 'Archive it to clear it from your list.' : card.need.text}</span>
          <Chips card={card} />
        </div>
        {details && (
          <div className="mt-1 grid gap-3 border-t border-border pt-3" data-catchup-details>
            <div className="grid grid-cols-2 gap-6 @max-[640px]:grid-cols-1">
              <Lines title="What it did" lines={card.did} />
              <Lines title="Skipped or not finished" lines={card.skipped} empty="Nothing skipped." />
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-catchup-actions>
              {secondary.map((id) => (
                <ActionButton key={id} id={id} primary={false} actions={actions} changesOpen={changesOpen} />
              ))}
            </div>
          </div>
        )}
        {actions.error && (
          <p role="alert" className="text-ui text-error">
            {actions.error}
          </p>
        )}
      </section>
    </div>
  );
}

/** Where a key press happened, for `catchUpKey`. */
function keyTarget(el: Element | null, view: HTMLElement | null): KeyTarget {
  if (!el || el === document.body || el === document.documentElement) return 'view';
  // The session's row in the sidebar or the rail, just clicked: its letters are the catch-up's (Enter and Space press the row).
  if (el.closest('[data-session-list] [data-session-id], [data-sidebar-rail-row]')) return 'control';
  if (!view?.contains(el)) return 'elsewhere';
  if (el.closest('[data-composer], .xterm, [data-changes-panel], [data-permission-request], [data-why-panel]')) return 'elsewhere';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return 'elsewhere';
  return el.closest('button, a, [role=button], [role=radio], [role=checkbox]') ? 'control' : 'view';
}

export interface CatchUpSlotProps {
  card: CatchUpCardData;
  show: Exclude<CatchUpShow, null>;
  cwd: string | null;
  changes: GitChanges | null;
  /** This session's pane is the active one: only it takes keys. */
  active: boolean;
  /** The Changes panel is on screen beside this session (a session outside git shows none). */
  changesOpen: boolean;
}

/**
 * The catch-up in a session: the banner over the conversation, or the strip it folds into, and its keys. Keys work while
 * focus is in this session's view but not in the message box or another field, and never while a dialog or menu is open.
 */
export function CatchUpSlot({ card, show, cwd, changes, active, changesOpen }: CatchUpSlotProps) {
  const sessionId = card.sessionId;
  const unread = useSessions((s) => s.sessions.get(sessionId)?.unread ?? false);
  const key = turnKey(card);
  const committed = useCatchUp((s) => s.committed.has(key));
  const details = useCatchUp((s) => s.details.has(key));
  const replying = useCatchUp((s) => s.replying === sessionId);
  const actions = useCatchUpActions({ card, cwd, changes });
  const ref = useRef<HTMLDivElement>(null);
  const shared: Shared = { card, actions, unread, committed, changesOpen };

  const latest = useRef({ show, details, replying, changesOpen, actions, committed });
  latest.current = { show, details, replying, changesOpen, actions, committed };
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const s = latest.current;
      if (event.defaultPrevented || useSessions.getState().view !== 'session') return;
      const view = ref.current?.closest<HTMLElement>('[data-current-session]') ?? null;
      // Esc in the Changes panel closes it, as the next step of Esc does.
      const inChanges = event.key === 'Escape' && document.activeElement?.closest('[data-changes-panel]');
      const overlay = Boolean(document.querySelector(`${OVERLAY_SELECTOR}, [aria-modal="true"]`));
      const action = catchUpKey(event, { target: inChanges ? 'view' : keyTarget(document.activeElement, view), overlay, show: s.show });
      if (!action) return;
      if (action.type === 'escape') {
        const step = escapeStep({ replying: s.replying, changesOpen: s.changesOpen, detailsOpen: s.details, show: s.show });
        if (!step) return;
        event.preventDefault();
        if (step === 'leave-reply') useCatchUp.getState().setReplying(null);
        else if (step === 'close-changes') closeChanges(sessionId);
        else if (step === 'close-details') useCatchUp.getState().setDetails(card, false);
        else s.actions.fold(true);
        return;
      }
      event.preventDefault();
      if (action.type === 'primary') return s.actions.run(primaryAction(card.need.kind, s.committed));
      // Space opens and closes Details in the banner, and opens the banner from the strip.
      if (action.type === 'space') return s.show === 'full' ? useCatchUp.getState().setDetails(card, !s.details) : s.actions.fold(false);
      const offered = [primaryAction(card.need.kind, s.committed), ...secondaryActions(card, { unread, committed: s.committed })];
      if (offered.includes(action.id)) s.actions.run(action.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, card, unread]);

  return (
    <div ref={ref} className="shrink-0" data-catchup-slot={show === 'full' ? 'banner' : 'strip'}>
      {show === 'strip' ? <CatchUpStrip {...shared} /> : <CatchUpBanner {...shared} details={details} />}
      {actions.overlays}
    </div>
  );
}
