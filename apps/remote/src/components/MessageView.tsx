import { useState } from 'react';
import { ChevronRight, CircleDot, GitPullRequest, Link2 } from 'lucide-react';
import { parseBriefs, parseGithubBlocks, withoutContext, type RemoteMessage } from '@switchboard/protocol/remote-client';
import { runSummary, type TranscriptItem } from '../lib/steps.ts';
import { editLines, toolSummary, type resultsByCall } from '../lib/transcript.ts';
import { Markdown } from './Markdown.tsx';

/**
 * One item of the conversation. Your messages are cards; Claude's text (markdown, drawn as React elements, never HTML)
 * and tool runs are a quiet timeline (AGENTS.md, Surfaces). A run of calls is one line until you open it; the run
 * Claude is working on stays open.
 */
export function ItemView({ item, results, live }: { item: TranscriptItem; results: ReturnType<typeof resultsByCall>; live: boolean }) {
  switch (item.kind) {
    case 'message':
      return <UserMessage message={item.message} />;
    case 'notice':
      return <p className="text-center text-meta break-words whitespace-pre-wrap text-muted">{item.text}</p>;
    case 'text':
      return <Markdown text={item.text} />;
    case 'thinking':
      return <Collapsible label="Thinking" body={item.text} tone="text-faint italic" />;
    case 'image':
      return <p className="text-meta text-faint">Image (on your computer)</p>;
    case 'run':
      return item.steps.length === 1 && item.steps[0]!.type === 'tool_use' ? (
        <ToolRun name={item.steps[0]!.name} input={item.steps[0]!.input} result={results.get(item.steps[0]!.id) ?? null} />
      ) : (
        <Run steps={item.steps} results={results} live={live} />
      );
  }
}

function UserMessage({ message }: { message: RemoteMessage }) {
  const sent = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  // A linked session's brief and an attached issue are one line each here; what you typed shows as it is.
  const text = withoutContext(sent);
  const attached = parseGithubBlocks(sent);
  const linked = parseBriefs(attached.text).briefs;
  return (
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
  );
}

/** "6 steps · edited 3 files, ran 2 commands"; opened, each step as before. */
function Run({ steps, results, live }: { steps: Extract<TranscriptItem, { kind: 'run' }>['steps']; results: ReturnType<typeof resultsByCall>; live: boolean }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  const failed = steps.some((s) => s.type === 'tool_use' && results.get(s.id)?.isError);
  return (
    <div className="text-ui" data-remote-run>
      <button type="button" onClick={() => setChosen(!open)} aria-expanded={open} className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-border/45">
        <Chevron open={open} />
        <span className={`min-w-0 flex-1 truncate ${failed ? 'text-error' : 'text-muted group-hover:text-text'}`}>{runSummary(steps)}</span>
        {live && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent-ink pulse-dot" />}
      </button>
      {open && (
        <div className="ml-[7px] flex flex-col border-l border-border pl-3">
          {steps.map((step, i) =>
            step.type === 'tool_use' ? (
              <ToolRun key={step.id} name={step.name} input={step.input} result={results.get(step.id) ?? null} />
            ) : step.text ? (
              <Collapsible key={i} label="Thinking" body={step.text} tone="text-faint italic" />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function ToolRun({ name, input, result }: { name: string; input: unknown; result: { text: string; isError: boolean } | null }) {
  const [open, setOpen] = useState(false);
  const diff = editLines(name, input);
  return (
    <div className="text-ui">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-border/45">
        <Chevron open={open} />
        <span className={`font-semibold ${result?.isError ? 'text-error' : 'text-muted group-hover:text-text'}`}>{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-meta text-faint">{toolSummary(name, input)}</span>
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
