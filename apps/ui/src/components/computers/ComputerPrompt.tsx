import { useState } from 'react';
import type { PermissionDecision, RemotePrompt } from '@switchboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { DECLINED, promptKind, promptQuestions, promptSubject, promptTitle, questionDecision } from './computerPrompts.ts';
import { RemoteText } from './RemoteText.tsx';

/**
 * What a session on another computer waits on: a command or an edit to allow, questions to answer, or a plan to
 * start, with the choices the card on that computer has. `respond` sends the answer there.
 */
export function ComputerPrompt({ prompt, respond }: { prompt: RemotePrompt; respond(decision: PermissionDecision): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const kind = promptKind(prompt);
  const send = (decision: PermissionDecision) => {
    setBusy(true);
    void respond(decision).finally(() => setBusy(false));
  };
  const deny = () => send({ behavior: 'deny', message: DECLINED });

  return (
    <div className="grid gap-2.5 rounded-xl border border-warn/60 bg-card p-3.5" role="group" aria-label={promptTitle(prompt)} data-computer-prompt={prompt.requestId}>
      <p className="text-ui font-semibold">{promptTitle(prompt)}</p>
      {kind === 'question' ? (
        <Questions prompt={prompt} disabled={busy} onAnswer={send} onDeny={deny} />
      ) : kind === 'plan' ? (
        <>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border px-3 py-1">
            <RemoteText text={typeof (prompt.input as { plan?: unknown } | null)?.plan === 'string' ? (prompt.input as { plan: string }).plan : ''} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={busy} onClick={() => send({ behavior: 'deny', message: 'Keep planning.' })}>
              Keep planning
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => send({ behavior: 'allow' })} data-computer-allow>
              Start
            </Button>
          </div>
        </>
      ) : (
        <>
          {prompt.description && <p className="text-ui text-muted">{prompt.description}</p>}
          {promptSubject(prompt) && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-meta">{promptSubject(prompt)}</pre>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={busy} onClick={deny} data-computer-deny>
              Deny
            </Button>
            {prompt.alwaysLabel && (
              <Button disabled={busy} onClick={() => send({ behavior: 'allow', always: true })} data-tooltip={prompt.alwaysLabel}>
                Always allow
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => send({ behavior: 'allow' })} data-computer-allow>
              Allow
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Questions({ prompt, disabled, onAnswer, onDeny }: { prompt: RemotePrompt; disabled: boolean; onAnswer(decision: PermissionDecision): void; onDeny(): void }) {
  const questions = promptQuestions(prompt);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const complete = questions.length > 0 && questions.every((q) => (picks[q.question] ?? []).length > 0);
  const toggle = (question: string, label: string, multi: boolean) =>
    setPicks((current) => {
      const picked = current[question] ?? [];
      return { ...current, [question]: multi ? (picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label]) : [label] };
    });
  return (
    <div className="grid gap-3">
      {questions.map((q) => (
        <fieldset key={q.question} className="grid gap-1.5">
          <legend className="mb-1 text-ui">{q.question}</legend>
          {q.options.map((option) => {
            const picked = (picks[q.question] ?? []).includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={picked}
                disabled={disabled}
                onClick={() => toggle(q.question, option.label, q.multiSelect === true)}
                className={`grid rounded-lg border px-3 py-2 text-left ${picked ? 'border-accent bg-accent/10' : 'border-border hover:bg-border/45'}`}
              >
                <span className="text-ui">{option.label}</span>
                {option.description && <span className="text-meta text-muted">{option.description}</span>}
              </button>
            );
          })}
        </fieldset>
      ))}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={disabled} onClick={onDeny}>
          Skip
        </Button>
        <Button variant="primary" disabled={disabled || !complete} onClick={() => onAnswer(questionDecision(prompt, picks))}>
          Answer
        </Button>
      </div>
    </div>
  );
}
