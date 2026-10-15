import { useState } from 'react';
import type { RemoteMessage } from '@switchboard/protocol/remote-client';
import { editLines, toolSummary, type resultsByCall } from '../lib/transcript.ts';

/**
 * One message. Everything is plain text (React escapes it): a transcript can hold anything, so nothing in it is ever
 * rendered as HTML. Your messages are cards; Claude's text and tool runs are a quiet timeline (AGENTS.md, Surfaces).
 */
export function MessageView({ message, results }: { message: RemoteMessage; results: ReturnType<typeof resultsByCall> }) {
  if (message.role === 'user') {
    const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    return (
      <div className="ml-8 rounded-xl border border-border bg-card px-3 py-2 sm:ml-16">
        {text && <p className="text-body whitespace-pre-wrap">{text}</p>}
        {message.blocks.some((b) => b.type === 'image') && <p className="text-meta text-faint">Image (on your computer)</p>}
        {message.device && <p className="pt-1 text-meta text-faint">From {message.device}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {message.blocks.map((block, index) => {
        switch (block.type) {
          case 'text':
            return (
              <p key={index} className="text-body break-words whitespace-pre-wrap">
                {block.text}
              </p>
            );
          case 'thinking':
            return block.text ? <Collapsible key={index} label="Thinking" body={block.text} tone="text-faint italic" /> : null;
          case 'tool_use':
            return <ToolRun key={index} name={block.name} input={block.input} result={results.get(block.id) ?? null} />;
          case 'image':
            return (
              <p key={index} className="text-meta text-faint">
                Image (on your computer)
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function ToolRun({ name, input, result }: { name: string; input: unknown; result: { text: string; isError: boolean } | null }) {
  const [open, setOpen] = useState(false);
  const diff = editLines(name, input);
  return (
    <div className="text-ui">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-baseline gap-2 py-1 text-left">
        <span className={`font-semibold ${result?.isError ? 'text-error' : 'text-muted'}`}>{name}</span>
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
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="py-1 text-faint">
        {label}
      </button>
      {open && <p className={`whitespace-pre-wrap ${tone}`}>{body}</p>}
    </div>
  );
}
