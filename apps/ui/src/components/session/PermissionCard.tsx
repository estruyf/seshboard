import { ClipboardList, MessageCircleQuestion, ShieldQuestion, SquareTerminal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PermissionDecision, PermissionRequest } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Markdown } from '../transcript/Markdown.tsx';
import { Button } from '../ui/Button.tsx';
import { CheckMark } from '../ui/Checkbox.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { toolSummary } from '../transcript/toolSummary.ts';
import { cardKeyAction, OVERLAY_SELECTOR, waitingLabel, type CardKind, type KeyTarget } from './permissionKeys.ts';
import { permissionDecisions } from './permissionDecisions.ts';

/** Sends the answer; resolves to whether the engine took it (a failure shows under the card). */
type Respond = (decision: PermissionDecision) => Promise<boolean>;

/**
 * Answers a request: Allow, Deny (with what to do instead) or a question's answers. The card above the message box and the
 * catch-up both answer through this, so a click in either does exactly the same.
 */
export function usePermissionAnswer(request: PermissionRequest) {
  const { respond, busy, error } = useRespond(request);
  return {
    allow: () => respond(permissionDecisions.allow()),
    deny: (feedback?: string) => respond(permissionDecisions.deny(feedback)),
    answer: (answers: Record<string, string>) => respond(permissionDecisions.answer(request, answers)),
    respond,
    busy,
    error,
  };
}

/** A question's questions, as AskUserQuestion sends them. */
export function questionsOf(request: PermissionRequest): Question[] {
  return (request.input as { questions?: Question[] }).questions ?? [];
}

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
function useCardShortcuts(cardRef: RefObject<HTMLElement | null>, kind: CardKind, optionCount: number, busy: boolean, shortcuts: Shortcuts, embedded = false) {
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
      // Inside the catch-up, Esc folds the card rather than saying no.
      if (action.type === 'deny' && embedded) return;
      if (action.type === 'enter' && !s.enter) return;
      event.preventDefault();
      event.stopPropagation();
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

function Header({ icon, title, titleId, createdAt, sub }: { icon: ReactNode; title: string; titleId: string; createdAt: number; sub?: string | null }) {
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

function DenyButton({ label, busy, onClick, embedded = false }: { label: string; busy: boolean; onClick(): void; embedded?: boolean }) {
  return (
    <Button variant="quiet" size="lg" disabled={busy} onClick={onClick} shortcut={embedded ? undefined : 'permission.deny'} data-permission-deny className="ml-auto">
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
  /** Inside the catch-up card: Esc is the catch-up's. */
  embedded: boolean;
}

function ToolPermission({ request, cwd, titleId, cardRef, embedded }: CardProps & { cwd: string | null }) {
  const { respond, busy, error } = useRespond(request);
  const [showInput, setShowInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const allowRef = useFocusIfIdle();
  const inputId = useId();
  const { detail } = toolSummary(request.toolName, request.input, cwd);
  const command = request.toolName === 'Bash' ? (request.input as { command?: string }).command : undefined;
  const allow = () => void respond(permissionDecisions.allow());
  const deny = () => void respond(permissionDecisions.deny(feedback));
  useCardShortcuts(cardRef, 'tool', 0, busy, { allow, deny }, embedded);
  return (
    <div className="grid gap-2.5">
      <Header
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
      {request.description && <p className="text-ui text-muted">{request.description}</p>}
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
        <DenyButton label="Deny" busy={busy} onClick={deny} embedded={embedded} />
      </div>
      <FeedbackField value={feedback} onChange={setFeedback} onSubmit={deny} busy={busy} />
      <ErrorLine error={error} />
    </div>
  );
}

export interface Question {
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

function AskUserQuestion({ request, titleId, cardRef, embedded }: CardProps) {
  const { respond, busy, error } = useRespond(request);
  const questions = questionsOf(request);
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
  const submit = () => {
    if (!complete) return;
    const result = Object.fromEntries(questions.map((q) => [q.question, final(q).join(', ')]));
    void respond(permissionDecisions.answer(request, result));
  };
  const skip = () => void respond(permissionDecisions.deny());

  useCardShortcuts(cardRef, 'question', current?.options.length ?? 0, busy, {
    allow: submit,
    deny: skip,
    pick: (index) => {
      const option = current?.options[index];
      if (!current || !option) return;
      toggle(current, option.label);
      // A single choice is the whole answer to that question; go on to the next one.
      if (!current.multiSelect && step < last) setStep(step + 1);
    },
    enter: () => (step < last ? setStep(step + 1) : submit()),
  }, embedded);

  return (
    <form
      className="grid gap-3"
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Header icon={<MessageCircleQuestion size={15} />} title={permissionTitle(request, null)} titleId={titleId} createdAt={request.createdAt} sub={request.agentId ? 'From a subagent' : null} />
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
            onSelect={() => {
              setStep(qi);
              toggle(q, option.label);
            }}
          />
        ));
        // With several questions, the ones the number keys don't answer right now step back a little.
        const dimmed = questions.length > 1 && qi !== step;
        return (
          <fieldset key={q.question} className={`grid gap-1.5 ${dimmed ? 'opacity-75' : ''}`} onFocus={() => setStep(qi)}>
            <legend className="mb-1.5 text-body font-medium">
              {q.header && <span className="mr-2 rounded bg-border/70 px-1.5 py-0.5 text-meta text-muted uppercase">{q.header}</span>}
              {q.question}
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
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="submit" variant="primary" size="lg" shortcut="permission.allow" disabled={busy || !complete} data-question-submit>
          Answer
        </Button>
        {current && current.options.length > 0 && !busy && (
          <span className="text-meta text-muted">
            {`Press 1${current.options.length > 1 ? ` to ${Math.min(9, current.options.length)}` : ''} to pick, Enter for ${step < last ? 'the next question' : 'send'}`}
          </span>
        )}
        <DenyButton label="Skip" busy={busy} onClick={skip} embedded={embedded} />
      </div>
      {!complete && !busy && step >= last && <p className="text-meta text-muted">{questions.length > 1 ? 'Answer every question to send.' : 'Pick an answer to send.'}</p>}
      <ErrorLine error={error} />
    </form>
  );
}

function PlanApproval({ request, titleId, cardRef, embedded }: CardProps) {
  const { respond, busy, error } = useRespond(request);
  const connection = useEngineConnection();
  const [feedback, setFeedback] = useState('');
  const plan = (request.input as { plan?: string }).plan ?? '';
  const approveWithEdits = async () => {
    // Only switch modes once the plan is really approved: a failed answer leaves the card up.
    if (!(await respond(permissionDecisions.allow()))) return;
    if (connection.status === 'connected') {
      await connection.client.call('session.setPermissionMode', { sessionId: request.sessionId, mode: 'acceptEdits' }).catch(() => {});
    }
  };
  const keepPlanning = () => void respond(permissionDecisions.deny(feedback));
  useCardShortcuts(cardRef, 'plan', 0, busy, { allow: () => void approveWithEdits(), deny: keepPlanning }, embedded);
  return (
    <div className="grid gap-2.5">
      <Header icon={<ClipboardList size={15} />} title={permissionTitle(request, null)} titleId={titleId} createdAt={request.createdAt} sub={request.agentId ? 'From a subagent' : null} />
      <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border bg-bg px-3 py-2">
        <Markdown text={plan} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="lg" shortcut="permission.allow" disabled={busy} onClick={() => void approveWithEdits()} data-permission-allow data-tooltip="Start, and let Claude edit files without asking each time">
          Approve and accept edits
        </Button>
        <Button size="lg" disabled={busy} onClick={() => void respond(permissionDecisions.allow())} data-tooltip="Start, and ask before each file edit">
          Approve, ask before edits
        </Button>
        <DenyButton label="Keep planning" busy={busy} onClick={keepPlanning} embedded={embedded} />
      </div>
      <FeedbackField value={feedback} onChange={setFeedback} onSubmit={keepPlanning} busy={busy} />
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * A pending permission prompt, rendered above the composer. It's a labelled region, so VoiceOver
 * users can jump to it; the session view announces it when it appears. `embedded`: inside the catch-up card, which
 * draws the frame around it and keeps Esc for itself.
 */
export function PermissionCard({ request, cwd, embedded = false }: { request: PermissionRequest; cwd: string | null; embedded?: boolean }) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      // A faint pink tint over the card colour, so the frame reads as "needs you" in both themes.
      // The margin keeps the 4px ring inside the scrolling list that holds the cards.
      className={embedded ? '' : 'rounded-xl border border-warn/55 bg-[color-mix(in_oklab,var(--color-warn)_5%,var(--color-card))] px-4 py-3 ring-4 ring-warn/10'}
      data-permission-request
      data-permission-embedded={embedded || undefined}
    >
      {request.toolName === 'AskUserQuestion' ? (
        <AskUserQuestion request={request} titleId={titleId} cardRef={cardRef} embedded={embedded} />
      ) : request.toolName === 'ExitPlanMode' ? (
        <PlanApproval request={request} titleId={titleId} cardRef={cardRef} embedded={embedded} />
      ) : (
        <ToolPermission request={request} cwd={cwd} titleId={titleId} cardRef={cardRef} embedded={embedded} />
      )}
    </section>
  );
}
