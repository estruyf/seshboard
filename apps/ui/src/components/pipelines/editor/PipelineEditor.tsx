import { Copy, Lock, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type DragEvent } from 'react';
import { PIPELINE_LIMITS, type Pipeline, type PipelineScope } from '@switchboard/protocol/client';
import { useHosts } from '../../../state/hostsStore.ts';
import { useProjects } from '../../../state/projectsStore.ts';
import { useProjectActionList } from '../../actions/useActions.ts';
import { Button } from '../../ui/Button.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Pill } from '../../ui/Pill.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { Select } from '../../ui/Select.tsx';
import { useFlash } from '../../ui/useFlash.ts';
import { addStep, formIssues, hasPush, isDirty, moveStep, removeStep, type PipelineForm } from './editorModel.ts';
import { PipelineTree } from './PipelineTree.tsx';
import { FIELD, StepCard } from './StepCard.tsx';

export interface PipelineEditorProps {
  /** The form to start from (a saved pipeline's, or a new one). */
  initial: PipelineForm;
  /** What is saved, to tell a change; null for a new pipeline. */
  saved: Pipeline | null;
  /** The project "This project" picks when the pipeline isn't one project's yet. */
  defaultRoot: string | null;
  onDirty(dirty: boolean): void;
  onSave(form: PipelineForm): Promise<void>;
  onDuplicate(): Promise<void>;
  onDelete(): Promise<void>;
}

/** The editor on the right of Settings › Pipelines: the name, where it shows, the steps and the tree they make. */
export function PipelineEditor({ initial, saved, defaultRoot, onDirty, onSave, onDuplicate, onDelete }: PipelineEditorProps) {
  const id = useId();
  const [form, setForm] = useState(initial);
  const [openKey, setOpenKey] = useState<number | null>(initial.keys[0] ?? null);
  const [busy, setBusy] = useState<'save' | 'duplicate' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashed, flash] = useFlash();
  const readOnly = form.builtIn;
  const dirty = !readOnly && isDirty(form, saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const models = useHosts((s) => s.models);
  const listed = useProjects((s) => s.listed);
  const projects = useMemo(() => listed.filter((p) => p.added && p.exists), [listed]);
  // "Run first" offers the project's actions; for every project's pipeline, the global ones (read through any project).
  const actionsRoot = form.scope.kind === 'project' ? form.scope.root : (defaultRoot ?? projects[0]?.root ?? null);
  const { actions: listedActions } = useProjectActionList(actionsRoot || null);
  const actions = useMemo(() => listedActions.filter((a) => a.type === 'shell' && (form.scope.kind === 'project' || a.scope === 'global')).map((a) => a.name), [listedActions, form.scope.kind]);

  const issues = formIssues(form);
  const whole = issues.filter((i) => i.step === null);
  const openIndex = openKey === null ? -1 : form.keys.indexOf(openKey);
  const openStep = openIndex >= 0 ? (form.steps[openIndex]?.name ?? null) : null;

  const change = (next: PipelineForm) => {
    setForm(next);
    setError(null);
  };
  const add = (kind: 'claude' | 'push') => {
    const { form: next, index } = addStep(form, kind);
    if (index < 0) return;
    change(next);
    setOpenKey(next.keys[index]!);
  };
  const setScope = (kind: PipelineScope['kind']) => change({ ...form, scope: kind === 'all' ? { kind: 'all' } : { kind: 'project', root: defaultRoot ?? projects[0]?.root ?? '' } });

  // Drag to reorder: the grip arms the card it's on, so text in the fields can still be selected.
  const [armed, setArmed] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const disarm = () => setArmed((a) => (dragging === null ? null : a));
    window.addEventListener('pointerup', disarm);
    return () => window.removeEventListener('pointerup', disarm);
  }, [armed, dragging]);
  const dragFor = (index: number) => ({
    armed: armed === form.keys[index],
    onArm: () => setArmed(form.keys[index]!),
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      if (armed !== form.keys[index]) return event.preventDefault();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', form.steps[index]!.name);
      setDragging(index);
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (dragging === null) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      setDropAt(after ? index + 1 : index);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (dragging !== null && dropAt !== null) change(moveStep(form, dragging, dropAt > dragging ? dropAt - 1 : dropAt));
      setDragging(null);
      setDropAt(null);
      setArmed(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setDropAt(null);
      setArmed(null);
    },
    dropBefore: dragging !== null && dropAt === index && dropAt !== dragging && dropAt !== dragging + 1,
  });

  const run = async (kind: 'save' | 'duplicate' | 'delete', work: () => Promise<void>, failed: string) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await work();
      if (kind === 'save') flash('Saved');
    } catch (e) {
      setError(`${failed}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const projectOptions = useMemo(() => {
    const options = projects.map((p) => ({ value: p.root, label: p.name }));
    if (form.scope.kind === 'project' && form.scope.root && !options.some((o) => o.value === (form.scope as { root: string }).root)) options.push({ value: form.scope.root, label: form.scope.root });
    return options;
  }, [projects, form.scope]);

  return (
    <div className="@container grid min-w-0 gap-4" data-pipeline-editor={form.id ?? 'new'} data-built-in={readOnly || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Pipeline name"
          placeholder="Pipeline name"
          value={form.name}
          maxLength={PIPELINE_LIMITS.pipelineName}
          disabled={readOnly}
          autoFocus={!form.id}
          onChange={(e) => change({ ...form, name: e.target.value })}
          className={`${FIELD} h-9 min-w-48 flex-1 text-body font-semibold`}
          data-pipeline-name
        />
        <SegmentedControl<PipelineScope['kind']>
          mode="radio"
          label="Where it shows"
          value={form.scope.kind}
          onChange={setScope}
          segments={[
            { value: 'project', label: 'This project', disabled: readOnly || projects.length === 0, data: { 'data-pipeline-scope': 'project' } },
            { value: 'all', label: 'All projects', disabled: readOnly, data: { 'data-pipeline-scope': 'all' } },
          ]}
          className="shrink-0"
          data-pipeline-scope-control
        />
        {form.scope.kind === 'project' && (
          <Select
            label="Project"
            className="h-8 max-w-48 rounded-md border border-edge bg-transparent px-2 text-ui text-text hover:bg-border/45"
            value={form.scope.root}
            placeholder="Pick a project"
            disabled={readOnly}
            onChange={(root) => change({ ...form, scope: { kind: 'project', root } })}
            options={projectOptions}
            menuWidth={220}
            dataAttrs={{ 'data-pipeline-project': true }}
          />
        )}
      </div>

      {readOnly && (
        <Notice tone="info" icon={<Lock size={13} aria-hidden />} data-pipeline-read-only>
          Built-in pipelines are read only. Duplicate one to change it.
        </Notice>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_260px] items-start gap-6 @max-[600px]:grid-cols-1">
        <div className="grid min-w-0 gap-3">
          {whole.length > 0 && (
            <ul className="grid gap-0.5 text-meta text-error" data-pipeline-issues>
              {whole.map((issue) => (
                <li key={issue.message}>{issue.message}</li>
              ))}
            </ul>
          )}
          <div className="relative grid gap-3" aria-label="Steps" role="group" data-pipeline-steps>
            {/* The rail the numbered steps sit on. */}
            <span aria-hidden className="absolute top-5 bottom-5 left-[13.5px] w-px bg-border" />
            {form.steps.map((step, index) => (
              <StepCard
                key={form.keys[index]}
                form={form}
                index={index}
                open={openKey === form.keys[index]}
                onToggle={() => setOpenKey((k) => (k === form.keys[index] ? null : form.keys[index]!))}
                onChange={change}
                onMove={(by) => change(moveStep(form, index, index + by))}
                onRemove={() => {
                  if (openKey === form.keys[index]) setOpenKey(null);
                  change(removeStep(form, index));
                }}
                readOnly={readOnly}
                issues={issues.filter((i) => i.step === index).map((i) => i.message)}
                models={models}
                actions={actions}
                actionsKnown={form.scope.kind === 'project'}
                drag={dragFor(index)}
              />
            ))}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 pl-10">
              <Pill dashed icon={<Plus size={11} aria-hidden />} onClick={() => add('claude')} disabled={form.steps.length >= PIPELINE_LIMITS.steps} data-pipeline-add-step>
                Add a step
              </Pill>
              {!hasPush(form) && (
                <Pill dashed icon={<Upload size={11} aria-hidden />} onClick={() => add('push')} disabled={form.steps.length >= PIPELINE_LIMITS.steps} data-pipeline-add-push>
                  Add Push
                </Pill>
              )}
              {form.steps.length >= PIPELINE_LIMITS.steps && <span className="text-meta text-muted">A pipeline has {PIPELINE_LIMITS.steps} steps at most.</span>}
            </div>
          )}
        </div>

        <div className="grid content-start gap-4">
          <PipelineTree steps={form.steps} autoPush={form.autoPush} openStep={openStep} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {error && (
          <Notice tone="error" className="mr-auto">
            {error}
          </Notice>
        )}
        {!error && flashed && (
          <Notice tone="success" inline className="mr-auto" data-pipeline-saved>
            {flashed}
          </Notice>
        )}
        {!readOnly && form.id && (
          <Button variant="danger" icon={<Trash2 size={13} aria-hidden />} onClick={() => void run('delete', onDelete, 'Couldn’t delete')} disabled={busy !== null} aria-busy={busy === 'delete'} data-pipeline-delete className={error || flashed ? '' : 'mr-auto'}>
            {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </Button>
        )}
        {form.id && (
          <Button icon={<Copy size={13} aria-hidden />} onClick={() => void run('duplicate', onDuplicate, 'Couldn’t duplicate')} disabled={busy !== null} aria-busy={busy === 'duplicate'} data-pipeline-duplicate>
            {busy === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
          </Button>
        )}
        {!readOnly && (
          <Button
            variant="primary"
            onClick={() => void run('save', () => onSave(form), 'Couldn’t save')}
            disabled={busy !== null || issues.length > 0 || !dirty}
            aria-busy={busy === 'save'}
            data-tooltip={issues.length > 0 ? 'Fix what the steps say first.' : undefined}
            aria-describedby={issues.length > 0 ? `${id}-blocked` : undefined}
            data-pipeline-save
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        )}
        {issues.length > 0 && !readOnly && (
          <span id={`${id}-blocked`} className="sr-only">
            {issues.length === 1 ? 'One thing to fix before you can save.' : `${issues.length} things to fix before you can save.`}
          </span>
        )}
      </div>
    </div>
  );
}
