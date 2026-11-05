import { useState } from 'react';
import { remoteEditLines, toolLine, type RemoteTool } from './computerSessions.ts';

/**
 * Each call of a run on another computer, one line each: its name and what it worked on. A click opens it: an edit's
 * lines taken away and added (else what it was given), then what it gave back. Nothing in it acts here.
 */
export function RemoteToolList({ tools, id, className = '' }: { tools: readonly RemoteTool[]; id?: string; className?: string }) {
  return (
    <ul id={id} className={`grid gap-0.5 ${className}`}>
      {tools.map((tool) => (
        <RemoteToolStep key={tool.id} tool={tool} />
      ))}
    </ul>
  );
}

function RemoteToolStep({ tool }: { tool: RemoteTool }) {
  const [open, setOpen] = useState(false);
  const detail = toolLine(tool.name, tool.input);
  return (
    <li className="min-w-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group flex w-full min-w-0 items-center gap-2 rounded-md text-left text-ui text-muted hover:text-text" data-remote-tool-step={tool.name}>
        <span className={`size-1.5 shrink-0 rounded-full ${tool.failed ? 'bg-error' : 'bg-faint/70'}`} aria-hidden />
        <span className="shrink-0 font-medium">{tool.name}</span>
        {detail && <span className="min-w-0 truncate font-mono text-meta">{detail}</span>}
      </button>
      {open && <RemoteToolDetail tool={tool} />}
    </li>
  );
}

function RemoteToolDetail({ tool }: { tool: RemoteTool }) {
  const diff = remoteEditLines(tool.name, tool.input);
  const { result } = tool;
  return (
    <div className="mt-1 mb-1.5 ml-3.5 grid min-w-0 gap-1" data-remote-tool-detail>
      {diff ? (
        <pre className="max-h-72 overflow-auto rounded-md bg-code p-2 font-mono text-meta" aria-label="Changes">
          {diff.map((line, i) => (
            <div key={i} className={line.kind === '+' ? 'bg-diff-added' : 'bg-diff-removed'}>
              {line.kind} {line.text}
            </div>
          ))}
        </pre>
      ) : (
        <pre className="max-h-48 overflow-auto rounded-md bg-code p-2 font-mono text-meta whitespace-pre-wrap [overflow-wrap:anywhere]" aria-label="Input">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      )}
      {result && (
        <pre className={`max-h-72 overflow-auto rounded-md bg-code p-2 font-mono text-meta whitespace-pre-wrap [overflow-wrap:anywhere] ${result.isError ? 'text-error' : 'text-muted'}`} aria-label="Output" data-remote-tool-output>
          {result.text || '(no output)'}
          {result.truncated && '\n…'}
        </pre>
      )}
    </div>
  );
}
