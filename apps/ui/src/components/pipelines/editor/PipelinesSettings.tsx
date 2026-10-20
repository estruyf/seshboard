import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Pipeline, PipelineScope } from '@switchboard/protocol/client';
import { basename } from '../../../lib/format.ts';
import { duplicateOf } from '../../../state/pipelines.ts';
import { deletePipeline, savePipeline, usePipelines } from '../../../state/pipelinesStore.ts';
import { useProjects } from '../../../state/projectsStore.ts';
import { useSessions } from '../../../state/sessionsStore.ts';
import { ConfirmDialog } from '../../ConfirmDialog.tsx';
import { Button } from '../../ui/Button.tsx';
import { SectionHeader } from '../../ui/SectionHeader.tsx';
import { formOf, newPipelineForm, pipelineGroups, pipelineRowDetail, toSave } from './editorModel.ts';
import { PipelineEditor } from './PipelineEditor.tsx';

/** What the editor shows: a saved pipeline (by id), or a new one. */
type Selection = { kind: 'saved'; id: string } | { kind: 'new'; scope: PipelineScope };

/**
 * Settings › Pipelines: the pipelines on the left (New pipeline, Built in, All projects, then one group per project),
 * the editor on the right. Opens on the pipeline `openPipelinesSettings(id)` asked for, else the first one.
 */
export function PipelinesSettings() {
  const pipelines = usePipelines((s) => s.pipelines);
  const editing = usePipelines((s) => s.editing);
  const projects = useProjects((s) => s.projects);
  const projectName = useCallback((root: string) => projects.get(root)?.name ?? basename(root), [projects]);
  // "This project" starts on the project of the session you were in.
  const defaultRoot = useSessions((s) => (s.selectedId ? (s.sessions.get(s.selectedId)?.projectRoot ?? null) : null));

  const [selection, setSelection] = useState<Selection | null>(() => (editing ? { kind: 'saved', id: editing } : null));
  /** A pipeline just saved or duplicated, until the list has it. */
  const [pending, setPending] = useState<Pipeline | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null);

  // The palette asked for a pipeline: show it, once.
  useEffect(() => {
    if (!editing) return;
    setSelection({ kind: 'saved', id: editing });
    usePipelines.setState({ editing: null });
  }, [editing]);

  const selectedId = selection?.kind === 'saved' ? selection.id : null;
  const listed = selectedId ? pipelines.find((p) => p.id === selectedId) : undefined;
  const current = listed ?? (pending && pending.id === selectedId ? pending : null);
  useEffect(() => {
    if (listed && pending?.id === listed.id) setPending(null);
  }, [listed, pending]);
  // Nothing chosen, or it went (deleted in another window): the first one. The built-ins are always there once the
  // list has loaded, so an empty list is one still loading.
  useEffect(() => {
    if (selection?.kind === 'new' || current) return;
    if (pipelines[0]) setSelection({ kind: 'saved', id: pipelines[0].id });
  }, [selection, current, pipelines]);

  /** Moves to another pipeline, asking first when the one open has changes. */
  const go = (next: Selection) => {
    const move = () => {
      setDirty(false);
      setSelection(next);
    };
    if (dirty) setDiscard(() => move);
    else move();
  };

  const groups = useMemo(() => pipelineGroups(pipelines, projectName), [pipelines, projectName]);
  const initial = useMemo(() => (selection?.kind === 'new' ? newPipelineForm(selection.scope) : current ? formOf(current) : null), [selection, current]);
  // A new form per pipeline; a save of the same one keeps the editor (and which card is open).
  const editorKey = selection?.kind === 'new' ? 'new' : (current?.id ?? 'none');

  const save = async (form: Parameters<typeof toSave>[0]) => {
    const saved = await savePipeline(toSave(form));
    setPending(saved);
    setDirty(false);
    setSelection({ kind: 'saved', id: saved.id });
  };
  const duplicate = async () => {
    if (!current) return;
    const make = async () => {
      const copy = await savePipeline(duplicateOf(current, current.scope.kind === 'project' ? current.scope.root : null));
      setPending(copy);
      setDirty(false);
      setSelection({ kind: 'saved', id: copy.id });
    };
    if (dirty) setDiscard(() => () => void make());
    else await make();
  };
  const remove = async () => {
    if (!current) return;
    await deletePipeline(current);
    setDirty(false);
    const next = pipelines.find((p) => p.id !== current.id);
    setSelection(next ? { kind: 'saved', id: next.id } : { kind: 'new', scope: { kind: 'all' } });
  };

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-6 py-6" data-pipelines-settings>
      <nav aria-label="Pipelines" className="grid gap-3">
        <Button variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => go({ kind: 'new', scope: { kind: 'all' } })} className="w-full" data-pipeline-new>
          New pipeline
        </Button>
        {groups.map((group) => (
          <div key={group.key} className="grid gap-0.5" data-pipeline-group={group.key}>
            <SectionHeader className="px-2.5 pb-1">{group.label}</SectionHeader>
            {group.pipelines.map((p) => {
              const selected = selection?.kind === 'saved' && selection.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => !selected && go({ kind: 'saved', id: p.id })}
                  aria-current={selected ? 'true' : undefined}
                  className={`grid rounded-md px-2.5 py-1.5 text-left ${selected ? 'bg-selected' : 'hover:bg-border/45'}`}
                  data-pipeline-row={p.id}
                >
                  <span className={`truncate text-ui ${selected ? 'font-semibold text-text' : 'text-text'}`}>{p.name}</span>
                  <span className="truncate text-meta text-muted">{pipelineRowDetail(p)}</span>
                </button>
              );
            })}
          </div>
        ))}
        {selection?.kind === 'new' && <p className="px-2.5 text-meta text-muted">The new pipeline shows here once you save it.</p>}
      </nav>
      {initial && <PipelineEditor key={editorKey} initial={initial} saved={selection?.kind === 'new' ? null : current} defaultRoot={defaultRoot} onDirty={setDirty} onSave={save} onDuplicate={duplicate} onDelete={remove} />}
      {discard && (
        <ConfirmDialog
          title="Discard your changes?"
          body="The pipeline you're editing has changes you haven't saved."
          confirmLabel="Discard"
          danger
          onConfirm={async () => {
            const next = discard;
            setDiscard(null);
            next();
          }}
          onClose={() => setDiscard(null)}
          data={{ 'data-pipeline-discard': true }}
        />
      )}
    </div>
  );
}
