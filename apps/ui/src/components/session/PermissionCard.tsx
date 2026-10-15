import { Check, CircleHelp, ClipboardList, MessageCircleQuestion, ShieldQuestion, SquareTerminal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PermissionDecision, PermissionRequest } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useWhy } from '../../state/whyStore.ts';
import { Markdown } from '../transcript/Markdown.tsx';
import { Button } from '../ui/Button.tsx';
import { CheckMark } from '../ui/Checkbox.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { toolSummary } from '../transcript/toolSummary.ts';
import { cardKeyAction, OVERLAY_SELECTOR, waitingLabel, type CardKind, type KeyTarget } from './permissionKeys.ts';
import { nextOpenQuestion } from './questionFlow.ts';

/** Sends the answer; resolves to whether the engine took it (a failure shows under the card). */
type Respond = (decision: PermissionDecision) => Promise<boolean>;

const DECLINED = 'The user declined this action.';

function useRespond(request: PermissionRequest): { respond: Respond; busy: boolean; error: string | null } {
  const connection = useEngineConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respond: Respond = async (decision) => {
    if (connection.status !== 'connected') return false;
    setBusy(true);
    try {
      await connection.client.call('session.respond', { requestId: request.requestId, decision });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return false;
    }
  };
  return { respond, busy, error };
}


/** What the focused element is, for the shortcut rules in `permissionKeys.ts`. */
function keyTarget(el: Element | null, card: HTMLElement): KeyTarget {
  if (!el || el === document.body || el === document.documentElement) return 'body';
  const session = card.closest('[data-current-session]');
  // Only this session's own message box counts: the other pane's is just a field somewhere else.
  const composer = el.closest('[data-composer]');
  if (composer) return !session || session.contains(composer) ? 'composer' : 'field';
  const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
  if (card.contains(el)) return field ? 'card-field' : el.matches('[role=radio], [role=checkbox]') ? 'card-option' : 'card';
  // Keys pressed outside this session's view (the sidebar, where Escape clears picks) are never an answer.
  if (session && !session.contains(el)) return 'field';
  return field ? 'field' : 'other';
}

/**
 * Shortcuts belong to the first pending card in the session you are looking at: with two panes,
 * the other pane's cards stay quiet, and with several requests only the top one answers.
 */
function ownsShortcuts(card: HTMLElement): boolean {
  // A session hidden behind another view (Settings makes it inert) can't be answered from the keyboard.
  if (card.closest('[inert]')) return false;
  if (card.closest('[data-pane-active="false"]')) return false;
  const session = card.closest('[data-current-session]');
  if (session?.querySelector('[data-pane-active="false"]')) return false;
  return (session ?? document).querySelector('[data-permission-request]') === card;
}

interface Shortcuts {
  allow(): void;
  deny(): void;
  pick?(index: number): void;
  enter?(): void;
}

/**
 * ⌘↵ allows, Esc denies (and, for a question, number keys pick and Enter moves on). It listens on
 * the window in the capture phase so it runs before the message box, whose Escape would otherwise
 * stop Claude instead of answering the card.
 */
function useCardShortcuts(cardRef: RefObject<HTMLElement | null>, kind: CardKind, optionCount: number, busy: boolean, shortcuts: Shortcuts) {
  const latest = useRef({ shortcuts, optionCount, busy });
  useEffect(() => {
    latest.current = { shortcuts, optionCount, busy };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card || event.defaultPrevented || latest.current.busy) return;
      if (!ownsShortcuts(card) || document.querySelector(OVERLAY_SELECTOR)) return;
      const action = cardKeyAction(event, keyTarget(document.activeElement, card), kind, latest.current.optionCount);
      if (!action) return;
      const s = latest.current.shortcuts;
      if (action.type === 'pick' && !s.pick) return;
      if (action.type === 'enter' && !s.enter) return;
      event.preventDefault();
      event.stopPropagation();
      // Esc closes "Why Claude asks" before it says no.
      if (action.type === 'deny' && useWhy.getState().open?.sessionId === card.dataset.permissionSession) return useWhy.getState().close();
      if (action.type === 'allow') s.allow();
      else if (action.type === 'deny') s.deny();
      else if (action.type === 'pick') s.pick?.(action.index);
      else s.enter?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cardRef, kind]);
}

/** "Waiting 2m", refreshed every half minute. */
function Waiting({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const label = waitingLabel(since, now);
  return label ? <span className="shrink-0 text-meta font-medium text-warn">{label}</span> : null;
}

/** "Why?": opens or closes the side panel that explains the request. */
function WhyButton({ request }: { request: PermissionRequest }) {
  const open = useWhy((s) => s.open?.requestId === request.requestId);
  return (
    <Button
      variant="quiet"
      size="sm"
      icon={<CircleHelp size={13} aria-hidden />}
      selected={open}
      aria-expanded={open}
      aria-label="Why is Claude asking?"
      data-tooltip="Why is Claude asking?"
      onClick={() => useWhy.getState().toggle(request.sessionId, request.requestId)}
      className="shrink-0"
      data-permission-why
    >
      Why?
    </Button>
  );
}

function Header({ icon, title, titleId, createdAt, sub, request }: { icon: ReactNode; title: string; titleId: string; createdAt: number; sub?: string | null; request: PermissionRequest }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-6.5 shrink-0 items-center justify-center rounded-md bg-warn/15 text-warn" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="truncate text-body font-semibold">
          {title}
        </h2>
        {sub && <p className="text-meta text-muted">{sub}</p>}
      </div>
      <Waiting since={createdAt} />
      <WhyButton request={request} />
    </div>
  );
}

/** The always-visible "no, do this instead" field; Enter in it denies with what you typed. */
function FeedbackField({ value, onChange, onSubmit, busy }: { value: string; onChange(value: string): void; onSubmit(): void; busy: boolean }) {
  return (
    <input
      value={value}
      disabled={busy}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing && value.trim()) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder="Or tell Claude what to do instead…"
      aria-label="Or tell Claude what to do instead"
      className="h-8 w-full min-w-0 rounded-md border border-border bg-bg px-2.5 text-ui outline-none placeholder:text-faint focus:border-accent-ink/60"
    />
  );
}

function DenyButton({ label, busy, onClick }: { label: string; busy: boolean; onClick(): void }) {
  return (
    <Button variant="quiet" size="lg" disabled={busy} onClick={onClick} shortcut="permission.deny" data-permission-deny className="ml-auto">
      {label}
    </Button>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="text-ui text-error" role="alert">
      {error}
    </p>
  ) : null;
}

/** What the card asks, in one line: its heading, and what the session announces when it appears. */
export function permissionTitle(request: PermissionRequest, cwd: string | null): string {
  if (request.toolName === 'AskUserQuestion') return 'Claude has a question for you';
  if (request.toolName === 'ExitPlanMode') return 'Claude has a plan. Ready to start?';
  return request.title ?? (request.toolName === 'Bash' ? 'Claude wants to run a command' : `Claude wants to use ${toolSummary(request.toolName, request.input, cwd).label}`);
}

/** "Allow Bash(npm test:*) in this project" reads as "Always allow Bash(npm test:*) in this project". */
function alwaysText(label: string): string {
  return /^allow\s/i.test(label) ? `Always allow ${label.slice(6)}` : `Always allow: ${label}`;
}

/**
 * Puts focus on the main answer, but only when nothing else has it: a prompt that pops up while
 * you type in the message box must not catch your Enter and approve something you didn't read.
 * Otherwise the session announces it, and ⇧Tab from the message box reaches it.
 */
function useFocusIfIdle() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  }, []);
  return ref;
}

interface CardProps {
  request: PermissionRequest;
  titleId: string;
  cardRef: RefObject<HTMLElement | null>;
}

function ToolPermission({ request, cwd, titleId, cardRef }: CardProps & { cwd: string | null }) {
  const { respond, busy, error } = useRespond(request);
  const [showInput, setShowInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const allowRef = useFocusIfIdle();
  const inputId = useId();
  const { detail } = toolSummary(request.toolName, request.input, cwd);
  const command = request.toolName === 'Bash' ? (request.input as { command?: string }).command : undefined;
  const allow = () => void respond({ behavior: 'allow' });
  const deny = () => void respond({ behavior: 'deny', message: feedback.trim() || DECLINED });
  useCardShortcuts(cardRef, 'tool', 0, busy, { allow, deny });
  return (
    <div className="grid gap-2.5">
      <Header
        request={request}
        icon={command !== undefined ? <SquareTerminal size={15} /> : <ShieldQuestion size={15} />}
        title={permissionTitle(request, cwd)}
        titleId={titleId}
        createdAt={request.createdAt}
        sub={request.agentId ? 'From a subagent' : null}
      />
      {command ? (
        <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-bg px-3 py-2 font-mono text-ui whitespace-pre-wrap select-text">{command}</pre>
      ) : (
        detail && <p className="truncate rounded-lg border border-border bg-bg px-3 py-2 font-mono text-ui text-muted">{detail}</p>
      )}
      {/* Claude Code often describes a command with the command itself: it shows once, above. */}
      {request.description && request.description.trim() !== command?.trim() && <p className="text-ui text-muted">{request.description}</p>}
      {request.decisionReason && <p className="text-meta text-muted">{request.decisionReason}</p>}
      <button
        type="button"
        onClick={() => setShowInput((v) => !v)}
        aria-expanded={showInput}
        aria-controls={showInput ? inputId : undefined}
        className="w-fit text-meta text-muted hover:text-text"
      >
        {showInput ? 'Hide details' : 'Show details'}
      </button>
      {showInput && (
        <pre id={inputId} className="max-h-56 overflow-auto rounded-lg bg-bg px-3 py-2 font-mono text-meta whitespace-pre-wrap text-muted select-text">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button ref={allowRef} variant="primary" size="lg" shortcut="permission.allow" data-permission-allow disabled={busy} onClick={allow} data-tooltip="Allow this once; Claude asks again next time">
          Allow
        </Button>
        {request.alwaysLabel && (
          <Button
            size="lg"
            disabled={busy}
            data-permission-always
            data-tooltip={alwaysText(request.alwaysLabel)}
            onClick={() => void respond({ behavior: 'allow', always: true })}
            className="max-w-80"
          >
            <span className="truncate">{alwaysText(request.alwaysLabel)}</span>
          </Button>
        )}
        <DenyButton label="Deny" busy={busy} onClick={deny} />
      </div>
      <FeedbackField value={feedback} onChange={setFeedback} onSubmit={deny} busy={busy} />
      <ErrorLine error={error} />
    </div>
  );
}

interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

/** One answer as a row with its number key. Single choice rows are radios, multi-select rows checkboxes. */
function OptionRow({
  n,
  label,
  description,
  checked,
  multi,
  tabbable,
  onSelect,
}: {
  n: number;
  label: string;
  description?: string;
  checked: boolean;
  multi: boolean;
  tabbable: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={checked}
      aria-keyshortcuts={n <= 9 ? String(n) : undefined}
      tabIndex={multi || checked || tabbable ? 0 : -1}
      onClick={onSelect}
      data-question-option={label}
      className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left ${checked ? 'border-accent-ink/60 bg-accent/10' : 'border-border bg-card hover:bg-border/45'}`}
    >
      <span
        aria-hidden
        className={`flex size-5 shrink-0 items-center justify-center rounded-md border text-meta font-semibold tabular-nums ${checked ? 'border-accent-ink bg-accent text-on-accent' : 'border-border text-muted'}`}
      >
        {n <= 9 ? n : '·'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body leading-snug">{label}</span>
        {description && <span className="block text-meta text-muted">{description}</span>}
      </span>
      {multi && <CheckMark checked={checked} className="mt-0.5" />}
    </button>
  );
}

function AskUserQuestion({ request, titleId, cardRef }: CardProps) {
  const { respond, busy, error } = useRespond(request);
  const input = request.input as { questions?: Question[] };
  const questions = input.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  // The question the number keys answer; it moves on as you pick and with Enter.
  const [step, setStep] = useState(0);
  const last = questions.length - 1;
  const current = questions[Math.min(step, last)];

  const toggle = (q: Question, label: string) =>
    setAnswers((c) => {
      const picked = c[q.question] ?? [];
      const next = q.multiSelect ? (picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label]) : [label];
      return { ...c, [q.question]: next };
    });

  const final = (q: Question) => [...(answers[q.question] ?? []), ...(other[q.question]?.trim() ? [other[q.question]!.trim()] : [])];
  const complete = questions.every((q) => final(q).length > 0);

  const nextUnanswered = (from: number) => nextOpenQuestion(questions.map((q) => final(q).length > 0), from);
  /** One way to answer, for a click and a number key. A single choice that is the first answer moves on; changing an answer, or a multi-select, stays. */
  const choose = (qi: number, q: Question, label: string) => {
    const first = final(q).length === 0;
    toggle(q, label);
    setStep(qi);
    const next = !q.multiSelect && first ? nextUnanswered(qi) : undefined;
    if (next !== undefined) setStep(next);
  };
  /** Enter, and Enter in the answer field: on to the next open question, or send when none is left. */
  const advance = () => {
    const next = nextUnanswered(Math.min(step, last));
    if (next !== undefined) setStep(next);
    else submit();
  };

  // Bring the question you move on to into view, when it isn't (a tall card scrolls with the conversation).
  const fieldsets = useRef<Array<HTMLFieldSetElement | null>>([]);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    fieldsets.current[Math.min(step, last)]?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [step, last]);
  const submit = () => {
    if (!complete) return;
    const result = Object.fromEntries(questions.map((q) => [q.question, final(q).join(', ')]));
    void respond({ behavior: 'allow', updatedInput: { ...(request.input as Record<string, never>), answers: result } });
  };
  const skip = () => void respond({ behavior: 'deny', message: DECLINED });

  useCardShortcuts(cardRef, 'question', current?.options.length ?? 0, busy, {
    allow: submit,
    deny: skip,
    pick: (index) => {
      const option = current?.options[index];
      if (!current || !option) return;
      choose(Math.min(step, last), current, option.label);
    },
    enter: advance,
  });

  return (
    <form
      className="grid gap-3"
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        advance();
      }}
    >
      <Header request={request} icon={<MessageCircleQuestion size={15} />} title={permissionTitle(request, null)} titleId={titleId} createdAt={request.createdAt} sub={request.agentId ? 'From a subagent' : null} />
      {questions.map((q, qi) => {
        const picked = answers[q.question] ?? [];
        const rows = q.options.map((option, i) => (
          <OptionRow
            key={option.label}
            n={i + 1}
            label={option.label}
            description={option.description}
            checked={picked.includes(option.label)}
            multi={q.multiSelect ?? false}
            tabbable={picked.length === 0 && i === 0}
            onSelect={() => choose(qi, q, option.label)}
          />
        ));
        // With several questions, a rail and a counter mark the one the number keys answer now. Questions you have answered
        // fade back (hover or focus brings them back); the ones still to come stay fully readable, as you read ahead.
        const several = questions.length > 1;
        const isCurrent = several && qi === step;
        const answered = final(q).length > 0;
        return (
          <fieldset
            key={q.question}
            ref={(el) => void (fieldsets.current[qi] = el)}
            className={`grid gap-1.5 transition-opacity ${several ? `border-l-2 pl-3 ${isCurrent ? 'border-accent-ink' : 'border-border'}` : ''} ${several && answered && !isCurrent ? 'opacity-60 focus-within:opacity-100 hover:opacity-100' : ''}`}
            data-question-current={several ? isCurrent : undefined}
            onFocus={() => setStep(qi)}
          >
            <legend className="mb-1.5 text-body font-medium">
              {several && <span className={`mr-2 text-meta tabular-nums ${isCurrent ? 'font-semibold text-accent-ink' : 'text-muted'}`}>{`${qi + 1} of ${questions.length}`}</span>}
              {q.header && <span className="mr-2 rounded bg-border/70 px-1.5 py-0.5 text-meta text-muted uppercase">{q.header}</span>}
              {q.question}
              {several && answered && (
                <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-meta font-normal text-ok">
                  <Check size={12} aria-hidden />
                  Answered
                </span>
              )}
            </legend>
            {q.multiSelect ? (
              rows
            ) : (
              <RadioGroup label={q.question} className="grid gap-1.5">
                {rows}
              </RadioGroup>
            )}
            <input
              value={other[q.question] ?? ''}
              onChange={(e) => setOther((c) => ({ ...c, [q.question]: e.target.value }))}
              placeholder={q.multiSelect ? 'Something else (optional)' : 'Or type your own answer'}
              aria-label={`Your own answer to: ${q.question}`}
              className="h-8 rounded-md border border-border bg-bg px-2.5 text-ui outline-none placeholder:text-faint focus:border-accent-ink/60"
            />
            {isCurrent && q.multiSelect && nextUnanswered(qi) !== undefined && (
              <div>
                <Button type="button" variant="quiet" size="sm" onClick={advance} data-question-next>
                  Next question
                </Button>
              </div>
            )}
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="submit" variant="primary" size="lg" shortcut="permission.allow" disabled={busy || !complete}>
          Answer
        </Button>
        {current && current.options.length > 0 && !busy && (
          <span className="text-meta text-muted">
            {`Press 1${current.options.length > 1 ? ` to ${Math.min(9, current.options.length)}` : ''} to pick, Enter for ${nextUnanswered(Math.min(step, last)) !== undefined ? 'the next question' : 'send'}`}
          </span>
        )}
        <DenyButton label="Skip" busy={busy} onClick={skip} />
      </div>
      {!complete && !busy && step >= last && <p className="text-meta text-muted">{questions.length > 1 ? 'Answer every question to send.' : 'Pick an answer to send.'}</p>}
      <ErrorLine error={error} />
    </form>
  );
}

function PlanApproval({ request, titleId, cardRef }: CardProps) {
  const { respond, busy, error } = useRespond(request);
  const connection = useEngineConnection();
  const [feedback, setFeedback] = useState('');
  const plan = (request.input as { plan?: string }).plan ?? '';
  const approveWithEdits = async () => {
    // Only switch modes once the plan is really approved: a failed answer leaves the card up.
    if (!(await respond({ behavior: 'allow' }))) return;
    if (connection.status === 'connected') {
      await connection.client.call('session.setPermissionMode', { sessionId: request.sessionId, mode: 'acceptEdits' }).catch(() => {});
    }
  };
  const keepPlanning = () => void respond({ behavior: 'deny', message: feedback.trim() || DECLINED });
  useCardShortcuts(cardRef, 'plan', 0, busy, { allow: () => void approveWithEdits(), deny: keepPlanning });
  return (
    <div className="grid gap-2.5">
      <Header request={request} icon={<ClipboardList size={15} />} title={permissionTitle(request, null)} titleId={titleId} createdAt={request.createdAt} sub={request.agentId ? 'From a subagent' : null} />
      <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border bg-bg px-3 py-2">
        <Markdown text={plan} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="lg" shortcut="permission.allow" disabled={busy} onClick={() => void approveWithEdits()} data-tooltip="Start, and let Claude edit files without asking each time">
          Approve and accept edits
        </Button>
        <Button size="lg" disabled={busy} onClick={() => void respond({ behavior: 'allow' })} data-tooltip="Start, and ask before each file edit">
          Approve, ask before edits
        </Button>
        <DenyButton label="Keep planning" busy={busy} onClick={keepPlanning} />
      </div>
      <FeedbackField value={feedback} onChange={setFeedback} onSubmit={keepPlanning} busy={busy} />
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * A pending permission prompt, rendered above the composer. It's a labelled region, so VoiceOver
 * users can jump to it; the session view announces it when it appears.
 */
export function PermissionCard({ request, cwd }: { request: PermissionRequest; cwd: string | null }) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      // A faint pink tint over the card colour, so the frame reads as "needs you" in both themes.
      // The margin keeps the 4px ring inside the scrolling list that holds the cards.
      className="rounded-xl border border-warn/55 bg-[color-mix(in_oklab,var(--color-warn)_5%,var(--color-card))] px-4 py-3 ring-4 ring-warn/10"
      data-permission-request
      data-permission-session={request.sessionId}
    >
      {request.toolName === 'AskUserQuestion' ? (
        <AskUserQuestion request={request} titleId={titleId} cardRef={cardRef} />
      ) : request.toolName === 'ExitPlanMode' ? (
        <PlanApproval request={request} titleId={titleId} cardRef={cardRef} />
      ) : (
        <ToolPermission request={request} cwd={cwd} titleId={titleId} cardRef={cardRef} />
      )}
    </section>
  );
}
