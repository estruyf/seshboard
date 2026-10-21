import { Fragment } from 'react';
import { runAsLabel, type RunAsStep } from '../../state/pipelines.ts';
import { PipelineIcon } from '../pipelines/pipelineMenu.tsx';
import { Button } from '../ui/Button.tsx';

/**
 * What Start will run, under New session's message box while a pipeline is picked (#179): a pill per step with who does
 * it. A dashed frame, so it reads as a preview rather than a control; Change opens the Run as menu. Pills wrap rather
 * than cut a step.
 */
export function RunAsSteps({ name, steps, onChange }: { name: string; steps: readonly RunAsStep[]; onChange(): void }) {
  return (
    <div className="-mt-2 flex min-w-0 items-start gap-2 rounded-lg border border-dashed border-pipeline/35 px-2.5 py-1.5" data-run-as-steps={steps.length}>
      <span className="flex h-6 shrink-0 items-center gap-1.5 text-meta text-muted">
        <PipelineIcon />
        Runs as
      </span>
      <ol aria-label={runAsLabel(name, steps)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
        {steps.map((step, i) => (
          <Fragment key={`${i}-${step.name}`}>
            {i > 0 && (
              <span aria-hidden className="text-meta text-faint">
                →
              </span>
            )}
            <li className="inline-flex h-6 items-center gap-1 rounded-full border border-edge bg-card px-2 text-meta whitespace-nowrap" data-run-as-step={step.name}>
              <span className="text-text">{step.name}</span>
              <span className="text-muted">{step.who}</span>
            </li>
          </Fragment>
        ))}
      </ol>
      <Button variant="quiet" size="sm" onClick={onChange} className="shrink-0" data-run-as-change>
        Change
      </Button>
    </div>
  );
}
