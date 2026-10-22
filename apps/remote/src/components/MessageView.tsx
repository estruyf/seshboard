import { useState } from 'react';
import { BookOpen, Check, ChevronRight, CircleDot, Copy, GitPullRequest, Link2 } from 'lucide-react';
import { parseBriefs, parseGithubBlocks, withoutContext, type RemoteMessage } from '@switchboard/protocol/remote-client';
import { runLabel, stepText, type ToolUse, type TranscriptItem } from '../lib/steps.ts';
import { editLines, type resultsByCall } from '../lib/transcript.ts';
import { Markdown } from './Markdown.tsx';
import { toast } from './Toasts.tsx';

/**
 * One item of the conversation. Your messages are cards; Claude's text (markdown, drawn as React elements, never HTML)
 * and tool runs are a quiet timeline (AGENTS.md, Surfaces). A run of calls is one line until you open it; the run
 * Claude is working on stays open. `onRead`: the reply ends a finished turn, so it can be read in full.
 */
export function ItemView({ item, results, live, onRead }: { item: TranscriptItem; results: ReturnType<typeof resultsByCall>; live: boolean; onRead?: () => void }) {
  switch (item.kind) {
    case 'message':
      return <UserMessage message={item.message} />;
    case 'notice':
      return <p className="text-center text-meta break-words whitespace-pre-wrap text-muted">{item.text}</p>;
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          <Markdown text={item.text} />
          {!live && item.text && (
            <div className="-ml-1.5 flex flex-wrap items-center gap-1">
              <CopyButton text={item.text} label="Copy as Markdown" kind="reply" />
              {onRead && <ReadButton onClick={onRead} />}
            </div>
          )}
        </div>
      );
    case 'thinking':
      return <Collapsible label="Thinking" body={item.text} tone="text-faint italic" />;
    case 'image':
      return <p className="text-meta text-faint">Image (on your computer)</p>;
    case 'run':
      return item.steps.length === 1 && item.steps[0]!.type === 'tool_use' ? (
        <ToolRun call={item.steps[0]!} result={results.get(item.steps[0]!.id) ?? null} live={live} />
      ) : (
        <Run steps={item.steps} results={results} live={live} />
      );
  }
}

/** Copies a text as it is (Claude's reply as Markdown, your message). There is no hover on a phone, so it is always there, quiet. */
function CopyButton({ text, label, kind }: { text: string; label: string; kind: 'reply' | 'message' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast("Couldn't copy", { tone: 'error' });
    }
  };
  return (
    <button type="button" onClick={() => void copy()} aria-label={copied ? 'Copied' : label} className="flex min-h-8 w-fit items-center gap-1 rounded-md px-1.5 text-meta text-faint hover:bg-border/50 hover:text-text pointer-fine:min-h-6" data-remote-copy={kind}>
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Read: the turn's replies in full, in a sheet (`ReadSheet`). Quiet, beside Copy under a finished reply. */
function ReadButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-8 w-fit items-center gap-1 rounded-md px-1.5 text-meta text-faint hover:bg-border/50 hover:text-text pointer-fine:min-h-6" data-remote-read>
      <BookOpen className="size-3.5" aria-hidden />
      Read
    </button>
  );
}

function UserMessage({ message }: { message: RemoteMessage }) {
  const sent = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  // A linked session's brief and an attached issue are one line each here; what you typed shows as it is.
  const text = withoutContext(sent);
  const attached = parseGithubBlocks(sent);
  const linked = parseBriefs(attached.text).briefs;
  return (
    <div className="flex flex-col gap-1">
      <div className="ml-8 rounded-xl border border-border bg-card px-3 py-2 sm:ml-16">
        {text && <p className="text-body break-words whitespace-pre-wrap">{text}</p>}
        {linked.map((brief) => (
          <p key={brief.sessionId} className="mt-1 flex items-center gap-1.5 border-t border-border pt-1 text-meta text-muted" data-linked-session={brief.sessionId}>
            <Link2 aria-hidden className="size-3 shrink-0 text-accent-ink" />
            <span className="min-w-0 truncate">Linked: {brief.label}</span>
          </p>
        ))}
        {attached.blocks.map((block) => (
          <p key={`${block.type}:${block.repo}#${block.number}`} className="mt-1 flex items-center gap-1.5 border-t border-border pt-1 text-meta text-muted" data-github-attached={`${block.type}:${block.number}`}>
            {block.type === 'pr' ? <GitPullRequest aria-hidden className="size-3 shrink-0 text-ok" /> : <CircleDot aria-hidden className="size-3 shrink-0 text-ok" />}
            <span className="min-w-0 truncate">
              Attached: #{block.number} {block.title}
            </span>
          </p>
        ))}
        {message.blocks.some((b) => b.type === 'image') && <p className="text-meta text-faint">Image (on your computer)</p>}
        {message.device && <p className="pt-1 text-meta text-faint">From {message.device}</p>}
      </div>
      {text && (
        <div className="flex justify-end">
          <CopyButton text={text} label="Copy message" kind="message" />
        </div>
      )}
    </div>
  );
}

/** "6 steps · edited 3 files, ran 2 commands" (or the step Claude is on); opened, each step as before. */
function Run({ steps, results, live }: { steps: Extract<TranscriptItem, { kind: 'run' }>['steps']; results: ReturnType<typeof resultsByCall>; live: boolean }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  const failed = steps.some((s) => s.type === 'tool_use' && results.get(s.id)?.isError);
  return (
    <div className="text-ui" data-remote-run>
      <button type="button" onClick={() => setChosen(!open)} aria-expanded={open} className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-border/45">
        <Chevron open={open} />
        <span className={`min-w-0 flex-1 truncate ${failed ? 'text-error' : 'text-muted group-hover:text-text'}`}>{runLabel(steps, live)}</span>
        {live && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent-ink pulse-dot" />}
      </button>
      {open && (
        <div className="ml-[7px] flex flex-col border-l border-border pl-3">
          {steps.map((step, i) =>
            step.type === 'tool_use' ? (
              <ToolRun key={step.id} call={step} result={results.get(step.id) ?? null} />
            ) : step.text ? (
              <Collapsible key={i} label="Thinking" body={step.text} tone="text-faint italic" />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function ToolRun({ call, result, live = false }: { call: ToolUse; result: { text: string; isError: boolean } | null; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const { name, input } = call;
  const diff = editLines(name, input);
  return (
    <div className="text-ui">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-border/45">
        <Chevron open={open} />
        <span className={`min-w-0 flex-1 truncate ${result?.isError ? 'text-error' : 'text-muted group-hover:text-text'}`}>{stepText(call, live ? 'present' : 'past')}</span>
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          {diff ? (
            <pre className="overflow-x-auto rounded-lg bg-code p-2 font-mono text-meta">
              {diff.map((line, i) => (
                <div key={i} className={line.kind === '+' ? 'bg-diff-added' : 'bg-diff-removed'}>
                  {line.kind} {line.text}
                </div>
              ))}
            </pre>
          ) : (
            <pre className="overflow-x-auto rounded-lg bg-code p-2 font-mono text-meta whitespace-pre-wrap">{JSON.stringify(input, null, 2)}</pre>
          )}
          {result && <pre className={`max-h-72 overflow-auto rounded-lg bg-code p-2 font-mono text-meta whitespace-pre-wrap ${result.isError ? 'text-error' : 'text-muted'}`}>{result.text || '(no output)'}</pre>}
        </div>
      )}
    </div>
  );
}

function Collapsible({ label, body, tone }: { label: string; body: string; tone: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-ui">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-faint hover:bg-border/45 hover:text-muted">
        <Chevron open={open} />
        {label}
      </button>
      {open && <p className={`whitespace-pre-wrap ${tone}`}>{body}</p>}
    </div>
  );
}

/** Says a row opens, and turns when it is open. */
function Chevron({ open }: { open: boolean }) {
  return <ChevronRight aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />;
}
