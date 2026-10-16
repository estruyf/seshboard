import { Bot, ScrollText } from 'lucide-react';
import { openAgents } from '../../state/agentsPanelStore.ts';
import { openCommands } from '../../state/commandsPanelStore.ts';
import { backgroundTaskOf } from './commandRuns.ts';
import { Button } from '../ui/Button.tsx';
import { DiffView } from './DiffView.tsx';
import type { DisplayItem } from './displayItems.ts';
import { SubagentRun } from './SubagentRun.tsx';
import { parseTodos, TodoList } from './TodoList.tsx';
import { TranscriptImage } from './TranscriptImage.tsx';
import { editHunks } from './toolSummary.ts';

export type ToolItem = Extract<DisplayItem, { kind: 'tool' }>;

export const isAgentTool = (item: ToolItem) => item.name === 'Task' || item.name === 'Agent';

/** Images a tool returned (e.g. reading a screenshot). */
export function ToolImages({ item, sessionId }: { item: ToolItem; sessionId: string }) {
  if (!item.result || item.result.images.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {item.result.images.map((image, index) => (
        <TranscriptImage key={image.imageId} sessionId={sessionId} image={image} variant="single" gallery={item.result!.images} index={index} />
      ))}
    </div>
  );
}

/**
 * What a tool did, in full: a subagent's run, or the input and output.
 * `withDiffAndImages` adds the diff and images, which tool cards already show outside this.
 */
export function ToolDetails({ item, cwd, sessionId, withDiffAndImages = false }: { item: ToolItem; cwd: string | null; sessionId: string; withDiffAndImages?: boolean }) {
  if (isAgentTool(item)) {
    return (
      <div className="grid gap-1.5">
        <div>
          <Button variant="quiet" size="sm" icon={<Bot size={12} aria-hidden />} onClick={() => openAgents(sessionId, item.id)} data-open-in-agents>
            Open in Agents panel
          </Button>
        </div>
        <SubagentRun sessionId={sessionId} toolUseId={item.id} running={item.result === null} cwd={cwd} />
      </div>
    );
  }
  if (item.name === 'TodoWrite') return <TodoList todos={parseTodos(item.input)} />;
  const hunks = editHunks(item);
  const failed = item.result?.isError ?? false;
  const command = item.name === 'Bash' && typeof (item.input as { command?: unknown }).command === 'string' ? (item.input as { command: string }).command : null;
  // A command Claude sent to the background: its output is in the Commands panel, not in this call's result.
  const backgroundTask = item.subagent ? null : backgroundTaskOf(item);
  return (
    <div className="grid gap-2 select-text">
      {backgroundTask && (
        <div>
          <Button variant="quiet" size="sm" icon={<ScrollText size={12} aria-hidden />} onClick={() => openCommands(sessionId, backgroundTask)} data-open-in-commands>
            Open in Commands panel
          </Button>
        </div>
      )}
      {withDiffAndImages && hunks && !failed && <DiffView hunks={hunks} truncated={item.inputTruncated} />}
      {!hunks && (
        <pre className="max-h-64 overflow-auto rounded bg-code px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">
          {/* A command reads better as itself than as JSON. */}
          {command !== null ? `$ ${command}` : JSON.stringify(item.input, null, 2)}
          {item.inputTruncated && '\n… (long values shortened)'}
        </pre>
      )}
      {item.result && (!hunks || failed) && (
        <pre
          className={`max-h-80 overflow-auto rounded px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap ${
            item.result.isError ? 'bg-error/10 text-error' : 'bg-code text-text/85'
          }`}
        >
          {item.result.text || '(no output)'}
          {item.result.truncated && '\n… (output shortened)'}
        </pre>
      )}
      {withDiffAndImages && <ToolImages item={item} sessionId={sessionId} />}
    </div>
  );
}
