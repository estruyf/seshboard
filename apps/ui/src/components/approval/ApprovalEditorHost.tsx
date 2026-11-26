import { useEffect, useMemo, useRef } from 'react';
import type { ApprovalReply, LaterDraft, Pipeline, PermissionDecision, ProjectAction, Schedule, Trigger } from '@seshboard/protocol/client';
import { closeApprovalEditor, useApprovalEditor, type ApprovalEditorRequest } from '../../state/approvalEditorStore.ts';
import { clientNow, savePipeline } from '../../state/pipelinesStore.ts';
import { openTriggerEditor } from '../../state/triggersStore.ts';
import { ActionEditor } from '../actions/ActionEditor.tsx';
import { useProjectActionList } from '../actions/useActions.ts';
import { formOf, toSave } from '../pipelines/editor/editorModel.ts';
import { PipelineEditor } from '../pipelines/editor/PipelineEditor.tsx';
import { ScheduleDialog } from '../schedules/ScheduleDialog.tsx';
import { Dialog } from '../ui/Dialog.tsx';

/** A card's draft, as the engine sends it for an editor (`sessionTools.ts`). */
interface Draft<T> {
  root: string;
  isNew: boolean;
  value: T;
}

const CLOSED = 'The user opened it in the editor and closed it without saving.';

/** Answers the card the editor was opened from: what was saved there, or that it was closed. */
function answer(request: ApprovalEditorRequest, saved: { id: string; name: string } | null): void {
  closeApprovalEditor();
  const decision: PermissionDecision = saved ? { behavior: 'allow', updatedInput: { saved } satisfies ApprovalReply } : { behavior: 'deny', message: CLOSED };
  void clientNow()
    .call('session.respond', { requestId: request.requestId, decision })
    .catch(() => {});
}

/**
 * Open in editor on an approval card (docs/seshboard-tools.md): the pipeline, trigger, schedule or action an agent
 * drafted, in its own editor. Saving answers the card with what was saved; closing denies it.
 */
export function ApprovalEditorHost() {
  const request = useApprovalEditor((s) => s.open);
  if (!request) return null;
  switch (request.editor) {
    case 'pipeline':
      return <PipelineApproval key={request.requestId} request={request} draft={request.draft as Draft<Pipeline>} />;
    case 'trigger':
      return <TriggerApproval key={request.requestId} request={request} draft={request.draft as Draft<Trigger>} />;
    case 'schedule':
      return <ScheduleApproval key={request.requestId} request={request} draft={request.draft as Draft<Schedule>} />;
    case 'action':
      return <ActionApproval key={request.requestId} request={request} draft={request.draft as Draft<ProjectAction & { scope: 'project' | 'shared' }>} />;
  }
}

function PipelineApproval({ request, draft }: { request: ApprovalEditorRequest; draft: Draft<Pipeline> }) {
  const initial = useMemo(() => ({ ...formOf(draft.value), id: draft.isNew ? null : draft.value.id }), [draft]);
  return (
    <Dialog title={draft.isNew ? 'New pipeline' : `Change pipeline: ${draft.value.name}`} subtitle="Drafted in the session. Save answers its card." width="full" onClose={() => answer(request, null)} data-approval-editor-dialog="pipeline">
      <PipelineEditor
        initial={initial}
        saved={null}
        defaultRoot={draft.root}
        onDirty={() => {}}
        saveOnly
        onSave={async (form) => {
          const saved = await savePipeline(toSave(form));
          answer(request, { id: saved.id, name: saved.name });
        }}
        onDuplicate={async () => {}}
        onDelete={async () => {}}
      />
    </Dialog>
  );
}

function TriggerApproval({ request, draft }: { request: ApprovalEditorRequest; draft: Draft<Trigger> }) {
  const saved = useRef<{ id: string; name: string } | null>(null);
  useEffect(() => {
    openTriggerEditor({
      root: draft.root,
      trigger: draft.isNew ? null : draft.value,
      draft: draft.value,
      onSaved: (trigger) => void (saved.current = { id: trigger.id, name: trigger.name }),
      onClosed: () => answer(request, saved.current),
    });
  }, [request, draft]);
  return null;
}

function ScheduleApproval({ request, draft }: { request: ApprovalEditorRequest; draft: Draft<Schedule> }) {
  return (
    <ScheduleDialog
      draft={draft.value.draft as LaterDraft}
      schedule={draft.isNew ? null : draft.value}
      prefill={draft.value}
      onSaved={(schedule) => answer(request, { id: schedule.id, name: schedule.name })}
      onClose={() => answer(request, null)}
    />
  );
}

function ActionApproval({ request, draft }: { request: ApprovalEditorRequest; draft: Draft<ProjectAction & { scope: 'project' | 'shared' }> }) {
  const { actions, sharedFile, errors, reload } = useProjectActionList(draft.root);
  return (
    <ActionEditor
      projectRoot={draft.root}
      actions={actions}
      sharedFile={sharedFile}
      errors={errors}
      initial={draft.value}
      onChanged={reload}
      onReorder={() => {}}
      onSaved={(action) => answer(request, { id: action.id, name: action.name })}
      onClose={() => answer(request, null)}
    />
  );
}
