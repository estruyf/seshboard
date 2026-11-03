import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CatchUp as CatchUpCardData, GitChanges } from '@seshboard/protocol/client';
import { moveOn, usePassPosition } from '../../state/catchUpPass.ts';
import { turnKey, useCatchUp } from '../../state/catchUpStore.ts';
import { popoutSession } from '../../state/popoutsStore.ts';
import { openNoteEditor } from '../../state/noteEditorStore.ts';
import { openRemindEditor } from '../../state/remindEditorStore.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { saveNote } from '../../state/sessionNotes.ts';
import { toast } from '../../state/toastStore.ts';
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
  suggestedNote,
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
  /** Where you are while going through sessions ("2 of 7"), else null. */
  position: { position: number; total: number } | null;
  /** On to the next session to go through; null where there is none to go to (a pop-out). */
  skip: (() => void) | null;
  /** What it needs from you, offered as the session's note in one click; null when there's nothing to offer. */
  useAsNote: { text: string; run(): void } | null;
  /** Remind me later (L), then on to the next session; null for another computer's session. */
  remind: (() => void) | null;
}

/** "2 of 7" while going through sessions (the footer's "N open", or Skip and Done). */
function PassPosition({ position }: { position: Shared['position'] }) {
  if (!position) return null;
  return (
    <span className="shrink-0 text-meta text-muted tabular-nums" aria-label={`Session ${position.position} of ${position.total} to go through`} data-catchup-position={`${position.position}/${position.total}`}>
      {position.position} of {position.total}
    </span>
  );
}

/** Skip: the next session to go through, leaving this one as it is. */
function SkipButton({ skip, size = 'md' }: { skip: Shared['skip']; size?: 'sm' | 'md' }) {
  if (!skip) return null;
  return (
    <Button variant="secondary" size={size} shortcut="catchup.skip" onClick={skip} data-tooltip="Go to the next session to review, and leave this one as it is" data-catchup-skip>
      Skip
    </Button>
  );
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
function CatchUpStrip({ card, actions, committed, changesOpen, position, skip }: Shared) {
  const primary = primaryAction(card.need.kind, committed);
  // A size wider than the conversation (max-w-3xl), so the text scrolling under the card stays hidden behind it.
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pt-3 @max-[860px]:px-4">
      <div role="region" aria-label="Catch-up" className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3" data-catchup-strip data-catchup-need={card.need.kind}>
        <StateLabel card={card} committed={committed} />
        <span className="min-w-0 flex-1 truncate text-ui text-text/85">{committed ? 'Committed' : card.need.title}</span>
        <PassPosition position={position} />
        <span className="shrink-0 text-meta text-muted @max-[640px]:hidden">{reviewLabel(card)}</span>
        <ActionButton id={primary} primary actions={actions} changesOpen={changesOpen} size="sm" />
        <SkipButton skip={skip} size="sm" />
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
function CatchUpBanner({ card, actions, unread, committed, changesOpen, details, position, skip, useAsNote, remind }: Shared & { details: boolean }) {
  const tone = committed ? 'ok' : NEED_TONE[card.need.kind];
  const primary = primaryAction(card.need.kind, committed);
  const secondary = secondaryActions(card, { unread, committed });
  // A size wider than the conversation (max-w-3xl), so the text scrolling under the card stays hidden behind it.
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pt-3 @max-[860px]:px-4">
      <section aria-label="Catch-up" className="grid gap-1.5 rounded-[14px] border border-border bg-card px-4 py-2.5 shadow-overlay" data-catchup data-catchup-banner data-catchup-need={card.need.kind} data-catchup-source={card.source}>
        <div className="flex min-w-0 items-center gap-2.5">
          <StateLabel card={card} committed={committed} />
          <span className="min-w-0 flex-1 truncate text-body text-text" data-catchup-ask>
            {card.ask}
          </span>
          <PassPosition position={position} />
          <span className="shrink-0 text-ui font-semibold text-text @max-[640px]:hidden" data-catchup-review>
            {reviewLabel(card)}
          </span>
          <ActionButton id={primary} primary actions={actions} changesOpen={changesOpen} />
          <SkipButton skip={skip} />
          <Button variant="secondary" size="md" kbd="space" selected={details} aria-expanded={details} onClick={() => useCatchUp.getState().setDetails(card, !details)} data-catchup-details-toggle>
            Details
          </Button>
          <Button variant="quiet" iconOnly icon={<X size={15} aria-hidden />} aria-label="Collapse the catch-up (Esc)" data-tooltip="Collapse (Esc)" onClick={() => actions.fold(true)} data-catchup-collapse />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pl-4">
          <span className={`shrink-0 text-ui font-semibold ${TEXT[tone]}`}>{committed ? 'Committed' : card.need.title}</span>
          <span className="min-w-0 flex-1 basis-48 text-ui text-muted">{committed ? 'Mark it done to clear it from your list.' : card.need.text}</span>
          {useAsNote && !committed && (
            <Button variant="quiet" size="sm" onClick={useAsNote.run} data-tooltip={`Note “${useAsNote.text}” under its title in the sidebar`} data-catchup-use-note>
              Use as note
            </Button>
          )}
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
              {remind && (
                <Button variant="secondary" size="md" shortcut="catchup.remind" onClick={remind} data-catchup-remind>
                  Remind me later
                </Button>
              )}
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
  /** A session on another computer (`RemoteSessionView`): what its buttons do there, whether it is unread there, and its row's id. */
  remote?: { actions: CatchUpActions; unread: boolean; rowId: string };
}

/**
 * The catch-up in a session: the banner over the conversation, or the strip it folds into, and its keys. Keys work while
 * focus is in this session's view but not in the message box or another field, and never while a dialog or menu is open.
 */
export function CatchUpSlot({ card, show, cwd, changes, active, changesOpen, remote }: CatchUpSlotProps) {
  const sessionId = card.sessionId;
  const localUnread = useSessions((s) => s.sessions.get(sessionId)?.unread ?? false);
  const unread = remote?.unread ?? localUnread;
  const key = turnKey(card);
  const committed = useCatchUp((s) => s.committed.has(key));
  const details = useCatchUp((s) => !s.detailsClosed.has(key));
  const replying = useCatchUp((s) => s.replying === sessionId);
  const localActions = useCatchUpActions({ card, cwd, changes });
  const actions = remote?.actions ?? localActions;
  const ref = useRef<HTMLDivElement>(null);
  const rowId = remote?.rowId ?? sessionId;
  const position = usePassPosition(rowId);
  // A pop-out shows one session: there is nowhere to skip to.
  const skip = popoutSession ? null : () => moveOn(rowId, 'skip');
  // Notes are this computer's (v1): another computer's session has none here.
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const note = useSessions((s) => s.sessions.get(sessionId)?.note ?? null);
  const suggestion = remote ? null : suggestedNote(card, note);
  const useAsNote = suggestion ? { text: suggestion, run: () => void saveNote(client, sessionId, suggestion).catch((e: unknown) => toast(`Couldn't save the note: ${e instanceof Error ? e.message : String(e)}`)) } : null;
  const remind = remote ? null : () => openRemindEditor([sessionId], () => !popoutSession && moveOn(rowId, 'done'));
  const shared: Shared = { card, actions, unread, committed, changesOpen, position, skip, useAsNote, remind };

  const latest = useRef({ show, details, replying, changesOpen, actions, committed, skip, remind });
  latest.current = { show, details, replying, changesOpen, actions, committed, skip, remind };
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
      if ((action.type === 'skip' && !s.skip) || ((action.type === 'note' || action.type === 'remind') && remote)) return;
      event.preventDefault();
      if (action.type === 'skip') return s.skip?.();
      if (action.type === 'note') return openNoteEditor(sessionId);
      // Remind me later, then on to the next session to go through (a pop-out shows one session: it stays).
      if (action.type === 'remind') return s.remind?.();
      if (action.type === 'primary') return s.actions.run(primaryAction(card.need.kind, s.committed));
      // Space opens and closes Details in the banner, and opens the banner from the strip.
      if (action.type === 'space') return s.show === 'full' ? useCatchUp.getState().setDetails(card, !s.details) : s.actions.fold(false);
      const offered = [primaryAction(card.need.kind, s.committed), ...secondaryActions(card, { unread, committed: s.committed })];
      if (offered.includes(action.id)) s.actions.run(action.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, card, unread, remote]);

  return (
    <div ref={ref} className="shrink-0" data-catchup-slot={show === 'full' ? 'banner' : 'strip'}>
      {show === 'strip' ? <CatchUpStrip {...shared} /> : <CatchUpBanner {...shared} details={details} />}
      {actions.overlays}
    </div>
  );
}

/**
 * While going through sessions, one without a catch-up on screen (none written, or summaries off) still says where you
 * are and keeps Skip, so the pass never stops at it. Nothing outside a pass.
 */
export function CatchUpPassBar({ rowId, active }: { rowId: string; active: boolean }) {
  const position = usePassPosition(rowId);
  const ref = useRef<HTMLDivElement>(null);
  const shown = position !== null && !popoutSession;
  useEffect(() => {
    if (!active || !shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || useSessions.getState().view !== 'session') return;
      const view = ref.current?.closest<HTMLElement>('[data-current-session]') ?? null;
      const overlay = Boolean(document.querySelector(`${OVERLAY_SELECTOR}, [aria-modal="true"]`));
      if (catchUpKey(event, { target: keyTarget(document.activeElement, view), overlay, show: 'strip' })?.type !== 'skip') return;
      event.preventDefault();
      moveOn(rowId, 'skip');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, shown, rowId]);
  if (!shown) return null;
  return (
    <div ref={ref} className="mx-auto w-full max-w-4xl shrink-0 px-6 pt-3 @max-[860px]:px-4">
      <div role="region" aria-label="Catch-up" className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3" data-catchup-pass-bar>
        <span className="min-w-0 flex-1 truncate text-ui text-muted">No catch-up for this session.</span>
        <PassPosition position={position} />
        <SkipButton skip={() => moveOn(rowId, 'skip')} size="sm" />
      </div>
    </div>
  );
}
