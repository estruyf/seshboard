import type { PipelineStep } from '@switchboard/protocol/client';
import { treeLines } from '../../../state/pipelines.ts';
import { SectionHeader } from '../../ui/SectionHeader.tsx';

/** "The tree it makes": the parent and each step as the sidebar will nest them, the open step highlighted. */
export function PipelineTree({ steps, autoPush, openStep }: { steps: readonly PipelineStep[]; autoPush: boolean; openStep: string | null }) {
  const lines = treeLines({ steps: [...steps], autoPush });
  return (
    <div className="grid content-start gap-2" data-pipeline-tree data-setting-row>
      <SectionHeader as="h3">The tree it makes</SectionHeader>
      <pre className="overflow-x-auto rounded-xl border border-border bg-card px-3 py-2.5 font-mono text-ui leading-6 text-text">
        {lines.map((line, i) => {
          const open = line.step !== null && line.step === openStep;
          return (
            <div key={i} className={`flex whitespace-pre ${open ? 'text-accent-ink' : ''}`} data-tree-line={line.step ?? 'parent'} data-open={open || undefined}>
              <span className={line.step === null ? 'text-muted' : ''}>{line.name}</span>
              {line.detail && <span className={`ml-3 ${open ? '' : 'text-muted'}`}>{line.detail}</span>}
            </div>
          );
        })}
      </pre>
      <p className="text-meta text-muted">Each step is a sub-session under the session you run it from. Its first prompt links the parent with @, so Claude gets the task.</p>
    </div>
  );
}
