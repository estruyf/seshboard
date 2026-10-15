import { useState } from 'react';
import type { PermissionDecision, RemotePrompt } from '@switchboard/protocol/remote-client';
import { editLines, toolSummary } from '../lib/transcript.ts';
import type { Client } from './Connected.tsx';
import { Button } from './ui.tsx';

/** What the computer's card says when you decline (apps/ui PermissionCard). */
const DECLINED = 'The user declined this action.';

interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

/**
 * A prompt Claude waits on, with the same choices as the card on the computer: a tool to allow (once or always) or
 * deny, a question to answer, or a plan to start or keep working on. A pink frame: it needs you.
 */
export function PermissionCard({ prompt, client, onError }: { prompt: RemotePrompt; client: Client; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const respond = async (decision: PermissionDecision) => {
    if (!client) return;
    setBusy(true);
    try {
      await client.call('session.respond', { requestId: prompt.requestId, decision });
    } catch (error) {
      onError(error instanceof Error ? error.message : "The answer didn't reach your computer.");
      setBusy(false);
    }
  };
  return (
    <section aria-label="Claude needs you" className="rounded-xl border-2 border-warn bg-card p-3 sm:p-4" data-remote-prompt>
      {prompt.toolName === 'AskUserQuestion' ? (
        <Questions prompt={prompt} busy={busy} respond={respond} />
      ) : prompt.toolName === 'ExitPlanMode' ? (
        <Plan prompt={prompt} busy={busy} respond={respond} />
      ) : (
        <ToolPrompt prompt={prompt} busy={busy} respond={respond} />
      )}
    </section>
  );
}

type Props = { prompt: RemotePrompt; busy: boolean; respond: (decision: PermissionDecision) => Promise<void> };

function ToolPrompt({ prompt, busy, respond }: Props) {
  const diff = editLines(prompt.toolName, prompt.input);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title font-semibold">{prompt.title ?? `Allow ${prompt.toolName}?`}</h2>
      {prompt.description && <p className="text-ui text-muted">{prompt.description}</p>}
      <pre className="max-h-60 overflow-auto rounded-lg bg-code p-2 font-mono text-meta whitespace-pre-wrap">
        {diff ? diff.map((line, i) => <div key={i} className={line.kind === '+' ? 'bg-diff-added' : 'bg-diff-removed'}>{`${line.kind} ${line.text}`}</div>) : toolSummary(prompt.toolName, prompt.input)}
      </pre>
      {/* Stacked on a phone with Allow on top; in a row on a wider screen, Allow on the right as on the computer. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="danger" disabled={busy} onClick={() => void respond({ behavior: 'deny', message: DECLINED })}>
          Deny
        </Button>
        {prompt.alwaysLabel && (
          <Button disabled={busy} onClick={() => void respond({ behavior: 'allow', always: true })}>
            {prompt.alwaysLabel}
          </Button>
        )}
        <Button variant="primary" disabled={busy} onClick={() => void respond({ behavior: 'allow' })}>
          Allow
        </Button>
      </div>
    </div>
  );
}

function Questions({ prompt, busy, respond }: Props) {
  const questions = ((prompt.input as { questions?: Question[] } | null)?.questions ?? []).filter((q) => q && typeof q.question === 'string');
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const final = (q: Question) => [...(answers[q.question] ?? []), ...(other[q.question]?.trim() ? [other[q.question]!.trim()] : [])];
  const complete = questions.length > 0 && questions.every((q) => final(q).length > 0);
  const toggle = (q: Question, label: string) =>
    setAnswers((current) => {
      const picked = current[q.question] ?? [];
      return { ...current, [q.question]: q.multiSelect ? (picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label]) : [label] };
    });
  const submit = () => {
    const result = Object.fromEntries(questions.map((q) => [q.question, final(q).join(', ')]));
    void respond({ behavior: 'allow', updatedInput: { ...(prompt.input as Record<string, never>), answers: result } });
  };
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">Claude has a question for you</h2>
      {questions.map((q) => (
        <fieldset key={q.question} className="flex flex-col gap-2">
          <legend className="pb-1 text-body">{q.question}</legend>
          {q.options.map((option) => {
            const picked = (answers[q.question] ?? []).includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                role={q.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={picked}
                onClick={() => toggle(q, option.label)}
                className={`rounded-lg border px-3 py-2 text-left ${picked ? 'border-accent-ink bg-accent/15' : 'border-edge'}`}
              >
                <span className="block text-body">{option.label}</span>
                {option.description && <span className="block text-meta text-muted">{option.description}</span>}
              </button>
            );
          })}
          <input
            value={other[q.question] ?? ''}
            onChange={(event) => setOther((current) => ({ ...current, [q.question]: event.target.value }))}
            placeholder={q.multiSelect ? 'Something else (optional)' : 'Or type your own answer'}
            className="min-h-11 rounded-lg border border-edge bg-card px-3 text-body pointer-fine:min-h-8"
          />
        </fieldset>
      ))}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={() => void respond({ behavior: 'deny', message: DECLINED })}>
          Skip
        </Button>
        <Button variant="primary" disabled={busy || !complete} onClick={submit}>
          Answer
        </Button>
      </div>
    </div>
  );
}

function Plan({ prompt, busy, respond }: Props) {
  const plan = (prompt.input as { plan?: unknown } | null)?.plan;
  const [feedback, setFeedback] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title font-semibold">Claude has a plan. Ready to start?</h2>
      {typeof plan === 'string' && <p className="max-h-80 overflow-auto rounded-lg bg-code p-3 text-ui whitespace-pre-wrap">{plan}</p>}
      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        rows={2}
        placeholder="What should change? (optional)"
        className="rounded-lg border border-edge bg-card px-3 py-2 text-body"
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={() => void respond({ behavior: 'deny', message: feedback.trim() || DECLINED })}>
          Keep planning
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void respond({ behavior: 'allow' })}>
          Start
        </Button>
      </div>
    </div>
  );
}
