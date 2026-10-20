import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ClipboardList, MessageCircleQuestion, ShieldQuestion, SquareTerminal } from 'lucide-react';
import type { PermissionDecision, RemotePrompt } from '@switchboard/protocol/client';
import { DenyButton, ErrorLine, FeedbackField, OptionRow, useCardShortcuts, Waiting } from '../session/PermissionCard.tsx';
import { Button } from '../ui/Button.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { DECLINED, promptKind, promptQuestions, promptSubject, promptTitle, questionDecision } from './computerPrompts.ts';
import { RemoteText } from './RemoteText.tsx';

type Respond = (decision: PermissionDecision) => Promise<boolean>;

/**
 * What a session on another computer waits on, in the local permission card's layout and with its keys (⌘↵ allows,
 * Esc denies, number keys pick an answer): a command or an edit to allow, questions to answer, or a plan to start.
 * The decisions are the ones the card on that computer sends; `respond` sends them there. The plan is shown as
 * remote text: nothing in it acts here.
 */
export function ComputerPrompt({ prompt, respond }: { prompt: RemotePrompt; respond(decision: PermissionDecision): Promise<boolean> }) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const send: Respond = async (decision) => {
    setBusy(true);
    const ok = await respond(decision);
    setBusy(false);
    return ok;
  };
  const kind = promptKind(prompt);
  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      className="rounded-xl border border-warn/55 bg-[color-mix(in_oklab,var(--color-warn)_5%,var(--color-card))] px-4 py-3 ring-4 ring-warn/10"
      data-permission-request
      data-permission-session={prompt.sessionId}
      data-computer-prompt={prompt.requestId}
    >
      {kind === 'question' ? (
        <Questions prompt={prompt} titleId={titleId} cardRef={cardRef} busy={busy} respond={send} />
      ) : kind === 'plan' ? (
        <Plan prompt={prompt} titleId={titleId} cardRef={cardRef} busy={busy} respond={send} />
      ) : (
        <Tool prompt={prompt} titleId={titleId} cardRef={cardRef} busy={busy} respond={send} />
      )}
    </section>
  );
}

interface CardProps {
  prompt: RemotePrompt;
  titleId: string;
  cardRef: RefObject<HTMLElement | null>;
  busy: boolean;
  respond: Respond;
}

function Header({ icon, prompt, titleId }: { icon: ReactNode; prompt: RemotePrompt; titleId: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-6.5 shrink-0 items-center justify-center rounded-md bg-warn/15 text-warn" aria-hidden>
        {icon}
      </span>
      <h2 id={titleId} className="min-w-0 flex-1 truncate text-body font-semibold">
        {promptTitle(prompt)}
      </h2>
      <Waiting since={prompt.createdAt} />
    </div>
  );
}

function Tool({ prompt, titleId, cardRef, busy, respond }: CardProps) {
  const [feedback, setFeedback] = useState('');
  const subject = promptSubject(prompt);
  const command = typeof (prompt.input as { command?: unknown } | null)?.command === 'string';
  const allow = () => void respond({ behavior: 'allow' });
  const deny = () => void respond({ behavior: 'deny', message: feedback.trim() || DECLINED });
  useCardShortcuts(cardRef, 'tool', 0, busy, { allow, deny });
  return (
    <div className="grid gap-2.5">
      <Header prompt={prompt} titleId={titleId} icon={command ? <SquareTerminal size={15} /> : <ShieldQuestion size={15} />} />
      {subject && <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-bg px-3 py-2 font-mono text-ui whitespace-pre-wrap break-all select-text">{subject}</pre>}
      {prompt.description && prompt.description.trim() !== subject.trim() && <p className="text-ui text-muted">{prompt.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="lg" shortcut="permission.allow" disabled={busy} onClick={allow} data-computer-allow>
          Allow
        </Button>
        {prompt.alwaysLabel && (
          <Button size="lg" disabled={busy} onClick={() => void respond({ behavior: 'allow', always: true })} data-tooltip={prompt.alwaysLabel} className="max-w-80">
            <span className="truncate">Always allow</span>
          </Button>
        )}
        <DenyButton label="Deny" busy={busy} onClick={deny} />
      </div>
      <FeedbackField value={feedback} onChange={setFeedback} onSubmit={deny} busy={busy} />
    </div>
  );
}

function Questions({ prompt, titleId, cardRef, busy, respond }: CardProps) {
  const questions = promptQuestions(prompt);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(0);
  const last = Math.max(0, questions.length - 1);
  const current = questions[Math.min(step, last)];
  const complete = questions.length > 0 && questions.every((q) => (picks[q.question] ?? []).length > 0);
  const choose = (qi: number, question: string, label: string, multi: boolean) => {
    setPicks((all) => {
      const picked = all[question] ?? [];
      return { ...all, [question]: multi ? (picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label]) : [label] };
    });
    setStep(!multi && qi < last ? qi + 1 : qi);
  };
  const submit = () => complete && void respond(questionDecision(prompt, picks));
  const skip = () => void respond({ behavior: 'deny', message: DECLINED });
  useCardShortcuts(cardRef, 'question', current?.options.length ?? 0, busy, {
    allow: submit,
    deny: skip,
    pick: (index) => {
      const option = current?.options[index];
      if (current && option) choose(Math.min(step, last), current.question, option.label, current.multiSelect === true);
    },
    enter: () => (step < last ? setStep(step + 1) : submit()),
  });
  return (
    <div className="grid gap-3">
      <Header prompt={prompt} titleId={titleId} icon={<MessageCircleQuestion size={15} />} />
      {questions.map((q, qi) => {
        const picked = picks[q.question] ?? [];
        const rows = q.options.map((option, i) => (
          <OptionRow
            key={option.label}
            n={i + 1}
            label={option.label}
            description={option.description}
            checked={picked.includes(option.label)}
            multi={q.multiSelect === true}
            tabbable={picked.length === 0 && i === 0}
            onSelect={() => choose(qi, q.question, option.label, q.multiSelect === true)}
          />
        ));
        return (
          <fieldset key={q.question} className="grid gap-1.5" onFocus={() => setStep(qi)}>
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
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="lg" shortcut="permission.allow" disabled={busy || !complete} onClick={submit} data-computer-allow>
          Answer
        </Button>
        <DenyButton label="Skip" busy={busy} onClick={skip} />
      </div>
    </div>
  );
}

function Plan({ prompt, titleId, cardRef, busy, respond }: CardProps) {
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const plan = typeof (prompt.input as { plan?: unknown } | null)?.plan === 'string' ? (prompt.input as { plan: string }).plan : '';
  const start = () => void respond({ behavior: 'allow' }).then((ok) => !ok && setError('It wasn’t answered. Try again.'));
  const keepPlanning = () => void respond({ behavior: 'deny', message: feedback.trim() || 'Keep planning.' });
  useCardShortcuts(cardRef, 'plan', 0, busy, { allow: start, deny: keepPlanning });
  return (
    <div className="grid gap-2.5">
      <Header prompt={prompt} titleId={titleId} icon={<ClipboardList size={15} />} />
      <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border bg-bg px-3 py-2">
        <RemoteText text={plan} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="lg" shortcut="permission.allow" disabled={busy} onClick={start} data-computer-allow>
          Start
        </Button>
        <DenyButton label="Keep planning" busy={busy} onClick={keepPlanning} />
      </div>
      <FeedbackField value={feedback} onChange={setFeedback} onSubmit={keepPlanning} busy={busy} />
      <ErrorLine error={error} />
    </div>
  );
}
