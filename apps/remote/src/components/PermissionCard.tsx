import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PermissionDecision, RemotePrompt } from '@seshboard/protocol/remote-client';
import { DECLINED, promptAsk, promptKind, promptText, toolLabel } from '../lib/prompts.ts';
import { editLines } from '../lib/transcript.ts';
import { answer } from './answer.ts';
import type { Client } from './Connected.tsx';
import { Markdown } from './Markdown.tsx';
import { Button, Kbd } from './ui.tsx';

interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

/** The panel's heading: what Claude asks, as the card on the computer says it. */
export function promptTitle(prompt: RemotePrompt): string {
  const kind = promptKind(prompt);
  if (kind === 'question') return 'Claude has a question for you';
  if (kind === 'plan') return 'Claude has a plan. Ready to start?';
  return prompt.title ?? `Allow ${toolLabel(prompt.toolName)}?`;
}

/**
 * The prompts a session waits on, docked above the message box so they never scroll away: a pink frame, "Claude needs
 * you", and the same choices as the card on the computer. The chevron folds it to one line to read the conversation
 * first; a new prompt opens it again. With more than one, "1 of 2" and arrows step through them.
 */
export function DockedPrompt({ prompts, client, sessionTitle, onGone, hints = false, typing = false }: { prompts: RemotePrompt[]; client: Client; sessionTitle: string | undefined; onGone: () => void; /** Key hints on the buttons (a wide screen). */ hints?: boolean; /** The keyboard is up: one line, so the message box stays above it. */ typing?: boolean }) {
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const ids = prompts.map((p) => p.requestId).join(' ');

  useEffect(() => {
    if (prompts.some((p) => !seen.current.has(p.requestId))) setCollapsed(false);
    for (const p of prompts) seen.current.add(p.requestId);
    setIndex((i) => Math.min(i, Math.max(0, prompts.length - 1)));
    setBusy(false);
  }, [ids]);

  const prompt = prompts[Math.min(index, prompts.length - 1)];
  if (!prompt) return null;

  const respond = async (decision: PermissionDecision) => {
    if (!client || busy) return;
    setBusy(true);
    const result = await answer(client, prompt, decision, sessionTitle);
    if (result === 'failed') setBusy(false);
    if (result === 'gone') onGone();
  };
  const disabled = busy || !client;

  // While you type, one line: a tap unfolds it and puts the keyboard away, so there is room to read it.
  if (typing) {
    return (
      <section aria-label="Claude needs you" className="px-3 pt-2 sm:px-6" data-remote-prompt={prompt.requestId} data-remote-prompt-line>
        <button
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setCollapsed(false);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
          className="mx-auto flex min-h-11 w-full max-w-3xl items-center gap-2 rounded-xl border-2 border-warn bg-card px-3 text-left"
        >
          <span className="shrink-0 text-meta font-semibold text-warn">Claude needs you</span>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-ui font-semibold">{promptAsk(prompt)}</span>
          {prompts.length > 1 && <span className="shrink-0 text-meta text-muted tabular-nums">{prompts.length}</span>}
          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Claude needs you" className="px-3 pt-2 sm:px-6" data-remote-prompt={prompt.requestId}>
      <div className="mx-auto flex max-h-[min(55dvh,32rem)] w-full max-w-3xl flex-col rounded-xl border-2 border-warn bg-card">
        <div className="flex shrink-0 items-center gap-2 py-1.5 pr-1.5 pl-3">
          <span className="rounded-md bg-warn/12 px-1.5 py-0.5 text-meta font-semibold text-warn">Claude needs you</span>
          {collapsed && <span className="min-w-0 flex-1 truncate text-ui font-semibold">{promptTitle(prompt)}</span>}
          {!collapsed && <span className="flex-1" />}
          {prompts.length > 1 && (
            <span className="flex items-center text-meta text-muted tabular-nums" data-remote-prompt-pager>
              <Button variant="quiet" size="md" aria-label="Previous prompt" disabled={index === 0} onClick={() => setIndex(index - 1)} className="px-1.5!">
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              {index + 1} of {prompts.length}
              <Button variant="quiet" size="md" aria-label="Next prompt" disabled={index >= prompts.length - 1} onClick={() => setIndex(index + 1)} className="px-1.5!">
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </span>
          )}
          <Button variant="quiet" size="md" aria-label={collapsed ? 'Show the prompt' : 'Fold the prompt'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} className="px-2!" data-remote-prompt-fold>
            <ChevronDown className={`size-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} aria-hidden />
          </Button>
        </div>
        {!collapsed && (
          <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
            <PromptBody key={prompt.requestId} prompt={prompt} disabled={disabled} respond={respond} hints={hints} />
          </div>
        )}
      </div>
    </section>
  );
}

type Props = {
  prompt: RemotePrompt;
  disabled: boolean;
  respond: (decision: PermissionDecision) => Promise<void>;
  /** Key hints on the buttons: D, A, ↩ (a wide screen; the keys are in `Connected.tsx`). */
  hints?: boolean;
  /** On a card that has its own heading (the home view): no title, a question's options as chips. */
  compact?: boolean;
};

/** A prompt's choices: a tool's Deny, Always and Allow, a question's options, or a plan's Keep planning and Start. */
export function PromptBody(props: Props) {
  const kind = promptKind(props.prompt);
  return kind === 'question' ? <Questions {...props} /> : kind === 'plan' ? <Plan {...props} /> : <ToolPrompt {...props} />;
}

function ToolPrompt({ prompt, disabled, respond, hints, compact }: Props) {
  const diff = editLines(prompt.toolName, prompt.input);
  return (
    <div className="flex flex-col gap-2">
      {!compact && <h2 className="text-title font-semibold">{promptTitle(prompt)}</h2>}
      {prompt.description && <p className="text-ui text-muted">{prompt.description}</p>}
      {/* All of it, every line: Allow approves all of it. */}
      <pre className="max-h-48 overflow-auto rounded-lg bg-code p-2 font-mono text-meta break-words whitespace-pre-wrap" data-remote-prompt-text>
        {diff ? diff.map((line, i) => <div key={i} className={line.kind === '+' ? 'bg-diff-added' : 'bg-diff-removed'}>{`${line.kind} ${line.text}`}</div>) : promptText(prompt)}
      </pre>
      {prompt.truncated && <p className="text-meta text-warn">This is too long to show in full. Allow approves all of it.</p>}
      <div className="flex gap-2 pt-1">
        {/* With Always allow, Deny and Allow take what their word needs and Always the rest, so its label fits a phone. */}
        <Button variant="danger" disabled={disabled} onClick={() => void respond({ behavior: 'deny', message: DECLINED })} className={prompt.alwaysLabel ? 'px-4!' : 'flex-1'} data-remote-deny>
          Deny
          {hints && <Kbd shortcut="d" />}
        </Button>
        {prompt.alwaysLabel && (
          <Button disabled={disabled} onClick={() => void respond({ behavior: 'allow', always: true })} className="min-w-0 flex-1 px-3!" data-remote-always>
            <span className="truncate">{prompt.alwaysLabel}</span>
          </Button>
        )}
        <Button variant="primary" disabled={disabled} onClick={() => void respond({ behavior: 'allow' })} className={prompt.alwaysLabel ? 'px-5!' : 'flex-[2]'} data-remote-allow>
          Allow
          {hints && <Kbd shortcut="a" tone="on-accent" />}
        </Button>
      </div>
    </div>
  );
}

function Questions({ prompt, disabled, respond, hints, compact }: Props) {
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
    <div className="flex flex-col gap-3">
      {!compact && <h2 className="text-title font-semibold">{promptTitle(prompt)}</h2>}
      {questions.map((q) => (
        <fieldset key={q.question} className={compact ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-2'}>
          <legend className="pb-1 text-body">{q.question}</legend>
          {q.options.map((option) => {
            const picked = (answers[q.question] ?? []).includes(option.label);
            if (compact)
              return (
                <button
                  key={option.label}
                  type="button"
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={picked}
                  title={option.description}
                  onClick={() => toggle(q, option.label)}
                  className={`min-h-7 rounded-full border px-3 text-ui transition-colors ${picked ? 'border-accent-ink bg-accent/15 font-semibold' : 'border-edge hover:border-faint hover:bg-border/45'}`}
                >
                  {option.label}
                </button>
              );
            return (
              <button
                key={option.label}
                type="button"
                role={q.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={picked}
                onClick={() => toggle(q, option.label)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${picked ? 'border-accent-ink bg-accent/15' : 'border-edge hover:border-faint hover:bg-border/45 active:bg-selected'}`}
              >
                <span className="block text-body">{option.label}</span>
                {option.description && <span className="block text-meta text-muted">{option.description}</span>}
              </button>
            );
          })}
          <input
            value={other[q.question] ?? ''}
            onChange={(event) => setOther((current) => ({ ...current, [q.question]: event.target.value }))}
            onKeyDown={(event) => {
              // ↩ answers once every question has one, as the hint on Answer says.
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && complete && !disabled) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={q.multiSelect ? 'Something else (optional)' : 'Or type your own answer'}
            className={`field px-3 text-body ${compact ? 'min-h-7 w-full basis-full' : 'min-h-11 pointer-fine:min-h-8'}`}
          />
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => void respond({ behavior: 'deny', message: DECLINED })} className="flex-1" data-remote-deny>
          Skip
          {hints && <Kbd shortcut="d" />}
        </Button>
        <Button variant="primary" disabled={disabled || !complete} onClick={submit} className="flex-[2]" data-remote-answer>
          Answer
          {hints && <Kbd shortcut="enter" tone="on-accent" />}
        </Button>
      </div>
    </div>
  );
}

function Plan({ prompt, disabled, respond, hints, compact }: Props) {
  const plan = (prompt.input as { plan?: unknown } | null)?.plan;
  return (
    <div className="flex flex-col gap-2">
      {!compact && <h2 className="text-title font-semibold">{promptTitle(prompt)}</h2>}
      {typeof plan === 'string' && (
        <div className="max-h-72 overflow-auto rounded-lg bg-code p-3">
          <Markdown text={plan} />
        </div>
      )}
      {!compact && <p className="text-meta text-muted">To change it, say what in the message box below.</p>}
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => void respond({ behavior: 'deny', message: DECLINED })} className="flex-1" data-remote-deny>
          Keep planning
          {hints && <Kbd shortcut="d" />}
        </Button>
        <Button variant="primary" disabled={disabled} onClick={() => void respond({ behavior: 'allow' })} className="flex-[2]" data-remote-allow>
          Start
          {hints && <Kbd shortcut="a" tone="on-accent" />}
        </Button>
      </div>
    </div>
  );
}
