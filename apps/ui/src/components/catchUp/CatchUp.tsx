import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CatchUpLayout } from '@switchboard/protocol/bridge';
import type { CatchUp as CatchUpCardData, GitChanges, PermissionRequest } from '@switchboard/protocol/client';
import { shortAge } from '../../lib/format.ts';
import { turnKey, useCatchUp } from '../../state/catchUpStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { OVERLAY_SELECTOR } from '../session/permissionKeys.ts';
import { PermissionCard, questionsOf } from '../session/PermissionCard.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Pill } from '../ui/Pill.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { SectionHeader, type SectionTone } from '../ui/SectionHeader.tsx';
import {
  ACTION_KEYS,
  actionLabel,
  catchUpKey,
  chipsOf,
  escapeStep,
  NEED_TONE,
  primaryActions,
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
const NEED_BG: Record<CatchUpTone, string> = { unread: 'bg-unread/10', error: 'bg-error/10', warn: 'bg-warn/10', ok: 'bg-ok/10', caution: 'bg-caution/10', neutral: 'bg-border/40' };
const SECTION: Record<CatchUpTone, SectionTone> = { unread: 'info', error: 'error', warn: 'needs-you', ok: 'ok', caution: 'caution', neutral: 'neutral' };
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

/** One of the card's actions as a button with its key: the primary one in yellow (also ↩), the others bordered. */
function ActionButton({ id, primary, actions, changesOpen, size = 'lg', layout }: { id: CatchUpActionId; primary: boolean; actions: CatchUpActions; changesOpen: boolean; size?: 'sm' | 'md' | 'lg'; layout: 'card' | 'banner' }) {
  const letter = ACTION_KEYS[id];
  // Allow, Send answer and the primary action take ↩; Deny has no key of its own here (Esc folds the card).
  const enter = primary && id !== 'deny';
  return (
    <Button
      variant={primary && id !== 'deny' ? 'primary' : 'secondary'}
      size={size}
      kbd={letter}
      disabled={(id === 'allow' || id === 'deny') && actions.busy}
      onClick={() => actions.run(id)}
      aria-keyshortcuts={[enter ? 'Enter' : null, letter ? (letter === 'space' ? 'Space' : letter.toUpperCase()) : null].filter(Boolean).join(' ') || undefined}
      data-catchup-action={id}
      data-catchup-primary={primary || undefined}
    >
      {actionLabel(id, { changesOpen, layout })}
      {enter && <Kbd keys="enter" tone="on-accent" aria-hidden />}
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

/** The full card: what you asked, what Claude did and skipped, what it needs from you, the signals and the actions. */
function CatchUpCard({ card, actions, unread, committed, changesOpen, cwd, request, messageCount }: Shared & { cwd: string | null; request: PermissionRequest | null; messageCount: number }) {
  const tone = committed ? 'ok' : NEED_TONE[card.need.kind];
  // A permission or question is answered right in the card, with the same card as above the message box.
  const embedded = card.state === 'waiting' && request !== null && (card.need.kind === 'permission' || card.need.kind === 'question');
  const primary = embedded ? [] : primaryActions(card.need.kind, committed);
  const secondary = secondaryActions(card, { unread, committed });
  return (
    <div className="mx-auto grid max-w-3xl gap-3 px-6 pt-4 pb-6 @max-[860px]:px-4">
      <section
        aria-label="Catch-up"
        className="grid gap-4 rounded-[14px] border border-border bg-card px-4.5 py-4 shadow-overlay"
        data-catchup
        data-catchup-layout="card"
        data-catchup-need={card.need.kind}
        data-catchup-source={card.source}
      >
        <header className="flex min-w-0 items-center gap-2">
          <StateLabel card={card} committed={committed} />
          <span className="truncate text-meta text-muted">· {shortAge(card.generatedAt) === 'now' ? 'just now' : `${shortAge(card.generatedAt)} ago`}</span>
          <span className="ml-auto shrink-0 text-ui font-semibold text-text" data-catchup-review>
            {reviewLabel(card)}
          </span>
          <Button variant="quiet" iconOnly icon={<X size={15} aria-hidden />} aria-label="Collapse the catch-up (Esc)" onClick={() => actions.run('expand')} data-catchup-collapse />
        </header>
        <div className="min-w-0">
          <SectionHeader as="h3">Your ask</SectionHeader>
          <p className="mt-1 line-clamp-2 text-body text-text" data-catchup-ask>
            {card.ask}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 @max-[640px]:grid-cols-1">
          <Lines title="What it did" lines={card.did} />
          <Lines title="Skipped or not finished" lines={card.skipped} empty="Nothing skipped." />
        </div>
        <div className={`rounded-lg px-4 py-3 ${NEED_BG[tone]}`} data-catchup-need-block>
          <SectionHeader as="h3" tone={SECTION[tone]}>
            What it needs from you
          </SectionHeader>
          {embedded ? (
            <div className="mt-2">
              <PermissionCard request={request} cwd={cwd} embedded />
            </div>
          ) : (
            <>
              <p className="mt-1 text-body font-semibold text-text">{committed ? 'Archive the session' : card.need.title}</p>
              <p className="text-body text-text/85">{committed ? 'The changes are committed. Archive it to clear it from your list.' : card.need.text}</p>
            </>
          )}
        </div>
        <Chips card={card} />
        <div className="flex flex-wrap items-center gap-1.5" data-catchup-actions>
          {primary.map((id) => (
            <ActionButton key={id} id={id} primary actions={actions} changesOpen={changesOpen} layout="card" />
          ))}
          {primary.length > 0 && <span className="w-2" aria-hidden />}
          {secondary.map((id) => (
            <ActionButton key={id} id={id} primary={false} actions={actions} changesOpen={changesOpen} layout="card" />
          ))}
        </div>
        {actions.error && (
          <p role="alert" className="text-ui text-error">
            {actions.error}
          </p>
        )}
      </section>
      <button
        type="button"
        onClick={() => actions.run('expand')}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border text-ui text-muted hover:bg-border/45 hover:text-text"
        data-catchup-expand-conversation
      >
        Expand conversation · {messageCount} {messageCount === 1 ? 'message' : 'messages'}
        <Kbd keys="space" aria-hidden />
      </button>
    </div>
  );
}

/** The card folded into one row: the state, what it needs, the review time, the primary action and Show catch-up. */
function CatchUpStrip({ card, actions, committed, changesOpen }: Shared) {
  const primary = primaryActions(card.need.kind, committed)[0]!;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-3 @max-[860px]:px-4">
      <div role="region" aria-label="Catch-up" className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3" data-catchup-strip data-catchup-need={card.need.kind}>
        <StateLabel card={card} committed={committed} />
        <span className="min-w-0 flex-1 truncate text-ui text-text/85">{committed ? 'Committed' : card.need.title}</span>
        <span className="shrink-0 text-meta text-muted @max-[640px]:hidden">{reviewLabel(card)}</span>
        <ActionButton id={primary} primary actions={actions} changesOpen={changesOpen} size="sm" layout="card" />
        <Button variant="quiet" size="sm" kbd="space" onClick={() => actions.run('expand')} data-catchup-show>
          Show catch-up
        </Button>
      </div>
    </div>
  );
}

/** The banner: the same briefing in two rows over the conversation, with Details for the rest. */
function CatchUpBanner({ card, actions, unread, committed, changesOpen, request, details, choice, onChoice }: Shared & { request: PermissionRequest | null; details: boolean; choice: number | null; onChoice(index: number): void }) {
  const tone = committed ? 'ok' : NEED_TONE[card.need.kind];
  const primary = primaryActions(card.need.kind, committed);
  const secondary = secondaryActions(card, { unread, committed });
  const command = request?.toolName === 'Bash' ? (request.input as { command?: string }).command : undefined;
  const question = request && card.need.kind === 'question' ? questionsOf(request)[0] : undefined;
  // One plain question can be answered here; anything more opens the card.
  const simple = question !== undefined && !question.multiSelect && request !== null && questionsOf(request).length === 1;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-3 @max-[860px]:px-4">
      <section aria-label="Catch-up" className="grid gap-1.5 rounded-[14px] border border-border bg-card px-4 py-2.5 shadow-overlay" data-catchup data-catchup-banner data-catchup-need={card.need.kind}>
        <div className="flex min-w-0 items-center gap-2.5">
          <StateLabel card={card} committed={committed} />
          <span className="min-w-0 flex-1 truncate text-body text-text" data-catchup-ask>
            {card.ask}
          </span>
          <span className="shrink-0 text-ui font-semibold text-text @max-[640px]:hidden" data-catchup-review>
            {reviewLabel(card)}
          </span>
          {primary.map((id) =>
            id === 'answer' ? (
              <Button key={id} variant="primary" size="md" disabled={actions.busy || (simple && choice === null)} onClick={() => (simple && choice !== null ? actions.answer(question.options[choice]!.label) : actions.run('answer'))} aria-keyshortcuts="Enter" data-catchup-action="answer" data-catchup-primary>
                Send answer
                <Kbd keys="enter" tone="on-accent" aria-hidden />
              </Button>
            ) : (
              <ActionButton key={id} id={id} primary actions={actions} changesOpen={changesOpen} size="md" layout="banner" />
            ),
          )}
          <Button variant="secondary" size="md" kbd="space" selected={details} aria-expanded={details} onClick={() => useCatchUp.getState().setDetails(card, !details)} data-catchup-details-toggle>
            Details
          </Button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pl-4">
          <span className={`shrink-0 text-ui font-semibold ${TEXT[tone]}`}>{committed ? 'Committed' : card.need.title}</span>
          <span className="min-w-0 flex-1 basis-48 text-ui text-muted">{committed ? 'Archive it to clear it from your list.' : card.need.text}</span>
          <Chips card={card} />
        </div>
        {command && (
          <pre className="ml-4 max-h-24 overflow-auto rounded-md bg-code px-2.5 py-1.5 font-mono text-ui whitespace-pre-wrap text-text select-text" data-catchup-command>
            {command}
          </pre>
        )}
        {simple && (
          <div className="pl-4" data-catchup-options>
            <RadioGroup label={question.question} className="flex flex-wrap items-center gap-1.5">
              {question.options.slice(0, 3).map((option, i) => (
                <Button
                  key={option.label}
                  size="sm"
                  selected={choice === i}
                  role="radio"
                  aria-checked={choice === i}
                  tabIndex={choice === i || (choice === null && i === 0) ? 0 : -1}
                  kbd={String(i + 1)}
                  onClick={() => onChoice(i)}
                  data-catchup-option={option.label}
                >
                  {option.label}
                </Button>
              ))}
            </RadioGroup>
          </div>
        )}
        {details && (
          <div className="mt-1 grid gap-3 border-t border-border pt-3" data-catchup-details>
            <div className="grid grid-cols-2 gap-6 @max-[640px]:grid-cols-1">
              <Lines title="What it did" lines={card.did} />
              <Lines title="Skipped or not finished" lines={card.skipped} empty="Nothing skipped." />
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-catchup-actions>
              {secondary.map((id) => (
                <ActionButton key={id} id={id} primary={false} actions={actions} changesOpen={changesOpen} size="md" layout="banner" />
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
  // The session's row in the sidebar or the rail, just clicked: its letters are the card's (Enter and Space press the row).
  if (el.closest('[data-session-list] [data-session-id], [data-sidebar-rail-row]')) return 'control';
  if (!view?.contains(el)) return 'elsewhere';
  if (el.closest('[data-composer], .xterm, [data-changes-panel]')) return 'elsewhere';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return 'elsewhere';
  return el.closest('button, a, [role=button], [role=radio], [role=checkbox]') ? 'control' : 'view';
}

export interface CatchUpSlotProps {
  card: CatchUpCardData;
  show: Exclude<CatchUpShow, null>;
  layout: Exclude<CatchUpLayout, 'off'>;
  cwd: string | null;
  changes: GitChanges | null;
  /** Prompts and replies in the conversation, for "Expand conversation · 14 messages". */
  messageCount: number;
  /** This session's pane is the active one: only it takes keys. */
  active: boolean;
  /** The Changes panel is on screen beside this session (the toggle is shared; a session outside git shows none). */
  changesOpen: boolean;
}

/**
 * The catch-up in a session: the full card (in place of the conversation), the banner (over it) or the strip, and its
 * keys. Keys work while focus is in this session's view but not in the message box or another field, and never while
 * a dialog or menu is open.
 */
export function CatchUpSlot({ card, show, layout, cwd, changes, messageCount, active, changesOpen }: CatchUpSlotProps) {
  const sessionId = card.sessionId;
  const request = useHosts((s) => [...s.permissions.values()].filter((p) => p.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null);
  const unread = useSessions((s) => s.sessions.get(sessionId)?.unread ?? false);
  const key = turnKey(card);
  const committed = useCatchUp((s) => s.committed.has(key));
  const details = useCatchUp((s) => s.details.has(key));
  const replying = useCatchUp((s) => s.replying === sessionId);
  const actions = useCatchUpActions({ card, show, cwd, changes, request });
  const [choice, setChoice] = useState<number | null>(null);
  useEffect(() => setChoice(null), [key]);
  const ref = useRef<HTMLDivElement>(null);
  const shared: Shared = { card, actions, unread, committed, changesOpen };
  const banner = layout === 'banner' && show === 'full';
  const question = card.need.kind === 'question' && request !== null;
  const options = question ? Math.min(3, questionsOf(request).length === 1 ? (questionsOf(request)[0]?.options.length ?? 0) : 0) : 0;

  const latest = useRef({ show, banner, details, replying, changesOpen, actions, question, options, committed, choice, request });
  latest.current = { show, banner, details, replying, changesOpen, actions, question, options, committed, choice, request };
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const s = latest.current;
      if (event.defaultPrevented || useSessions.getState().view !== 'session') return;
      const view = ref.current?.closest<HTMLElement>('[data-current-session]') ?? null;
      const target = keyTarget(document.activeElement, view);
      // Esc in the Changes panel closes it, as the next step of Esc does.
      const inChanges = event.key === 'Escape' && document.activeElement?.closest('[data-changes-panel]');
      const overlay = Boolean(document.querySelector(`${OVERLAY_SELECTOR}, [aria-modal="true"]`));
      const action = catchUpKey(event, { target: inChanges ? 'view' : target, overlay, show: s.show, question: s.question, options: s.options });
      if (!action) return;
      const section = ref.current;
      const embedded = s.show === 'full' && !s.banner && s.question;
      const click = (selector: string) => section?.querySelector<HTMLElement>(selector)?.click();
      if (action.type === 'escape') {
        const step = escapeStep({ replying: s.replying, changesOpen: s.changesOpen, detailsOpen: s.banner && s.details, show: s.show });
        if (!step) return;
        event.preventDefault();
        if (step === 'leave-reply') useCatchUp.getState().setReplying(null);
        else if (step === 'close-changes') useOverlay.getState().toggleChanges(false);
        else if (step === 'close-details') useCatchUp.getState().setDetails(card, false);
        else useCatchUp.getState().setCollapsed(card, true);
        return;
      }
      event.preventDefault();
      if (action.type === 'primary') {
        if (s.show === 'full' && !s.banner && s.request && card.state === 'waiting') {
          // The card's own Allow, or its Answer: the permission card does what it always does.
          return click(card.need.kind === 'question' ? '[data-question-submit]' : '[data-permission-allow]');
        }
        return click('[data-catchup-primary]');
      }
      if (action.type === 'option' || action.type === 'pick') {
        if (embedded) {
          const rows = [...(section?.querySelectorAll<HTMLElement>('[data-question-option]') ?? [])];
          const current = rows.findIndex((row) => row === document.activeElement || row.getAttribute('aria-checked') === 'true');
          const next = action.type === 'pick' ? action.index : (current + action.step + rows.length) % rows.length;
          rows[next]?.focus();
          rows[next]?.click();
          return;
        }
        const next = action.type === 'pick' ? action.index : ((s.choice ?? -1) + action.step + s.options) % s.options;
        setChoice(next);
        return;
      }
      const id = action.id;
      if (id === 'expand') {
        // In the banner, Space opens and closes Details; everywhere else it folds or shows the card.
        if (s.banner) useCatchUp.getState().setDetails(card, !s.details);
        else s.actions.run('expand');
        return;
      }
      const offered = [...primaryActions(card.need.kind, s.committed), ...secondaryActions(card, { unread, committed: s.committed })];
      if (offered.includes(id)) s.actions.run(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, card, unread]);

  let body: ReactNode;
  if (show === 'strip') body = <CatchUpStrip {...shared} />;
  else if (banner) body = <CatchUpBanner {...shared} request={request} details={details} choice={choice} onChoice={setChoice} />;
  else body = <CatchUpCard {...shared} cwd={cwd} request={request} messageCount={messageCount} />;
  return (
    <div ref={ref} className={show === 'full' && !banner ? 'min-h-0 flex-1 overflow-y-auto' : 'shrink-0'} data-catchup-slot={show === 'full' ? layout : 'strip'}>
      {body}
      {actions.overlays}
    </div>
  );
}
