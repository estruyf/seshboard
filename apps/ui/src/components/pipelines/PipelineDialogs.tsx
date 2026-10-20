import { closeDeletePipeline, removePipeline, usePipelines } from '../../state/pipelinesStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { PipelineEditorHost } from './PipelineEditor.tsx';

/** The pipeline editor and the Delete question, wherever they were asked for (Settings › Pipelines, the palette). Mounted once in the app. */
export function PipelineDialogs() {
  const deleting = usePipelines((s) => s.deleting);
  return (
    <>
      <PipelineEditorHost />
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          danger
          confirmLabel="Delete"
          body={
            deleting.scope.kind === 'shared'
              ? 'It is taken out of the project’s .switchboard.json, so it is gone for everyone once you commit that change. Runs that already started keep going.'
              : 'Runs that already started keep going. This can’t be undone.'
          }
          data={{ 'data-pipeline-delete-dialog': true }}
          onConfirm={() => removePipeline(deleting)}
          onClose={closeDeletePipeline}
        />
      )}
    </>
  );
}
