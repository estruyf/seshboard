import { AlertTriangle, CircleDot, CircleX, Folder, GitBranch, MessageSquareDiff, SquareTerminal, Zap } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { STATE_LABEL_KEYS, TRIGGER_LIMITS, type StateLabelKey, type TriggerRepoInfo } from '@switchboard/protocol/client';
import { modelLabel } from '../../lib/autoModel.ts';
import { basename } from '../../lib/format.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { firstCheckLine, formProblem, formToSave, newTriggerForm, sharedRepoWarning, TRIGGER_SOURCES, triggerForm, updateForm, WHICH_ISSUES, type TriggerForm } from '../../state/triggers.ts';
import { closeTriggerEditor, loadRepoInfo, saveTrigger, useTriggers, type TriggerEditorRequest } from '../../state/triggersStore.ts';
import { layeredDefaults } from '../newSession/choices.ts';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Select } from '../ui/Select.tsx';
import { Stepper } from '../ui/Stepper.tsx';
import { TriggerPromptField } from './TriggerPromptField.tsx';

const FIELD = 'h-8 rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';
const CHIP = 'h-7 rounded-md border border-edge bg-transparent px-2 text-ui text-text hover:bg-border/45';

/** The editor, wherever it was asked for: the Triggers tab, the palette, New session's Start ▾ › Start when…. */
export function TriggerEditorHost() {
  const request = useTriggers((s) => s.editor);
  if (!request) return null;
  // Keyed, so another request starts from its own form.
  return <TriggerEditor key={`${request.root}:${request.trigger?.id ?? 'new'}`} request={request} onClose={closeTriggerEditor} />;
}

/** One row: the label on the left, the control on the right. */
function Row({ label, htmlFor, labelId, children }: { label: string; htmlFor?: string; labelId?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-start gap-3 @max-[640px]:grid-cols-1 @max-[640px]:gap-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="pt-1.5 text-ui text-muted">
          {label}
        </label>
      ) : (
        <span id={labelId} className="pt-1.5 text-ui text-muted">
          {label}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A source's icon on its tile, in its colour: CI in `error`, issues in `ok`, the rest muted. */
export function SourceIcon({ kind, size = 30 }: { kind: 'ci' | 'issues' | 'changes' | 'command'; size?: number }) {
  const tone = kind === 'ci' ? 'bg-error/12 text-error' : kind === 'issues' ? 'bg-ok/12 text-ok' : kind === 'changes' ? 'bg-caution/12 text-caution' : 'bg-link/12 text-link';
  const icon = kind === 'ci' ? <CircleX size={size * 0.5} aria-hidden /> : kind === 'issues' ? <CircleDot size={size * 0.5} aria-hidden /> : kind === 'changes' ? <MessageSquareDiff size={size * 0.5} aria-hidden /> : <SquareTerminal size={size * 0.5} aria-hidden />;
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-lg ${tone}`} style={{ width: size, height: size }} aria-hidden>
      {icon}
    </span>
  );
}

/**
 * New trigger or Edit trigger, for a project: its name, When (the source, as four cards; Changes requested and A
 * command come later), what the source looks for, what it may do on GitHub (issues only), and Then: the prompt with its
 * event fields, what the sessions run with, and how many at once. Bypass permissions is never offered.
 */
function TriggerEditor({ request, onClose }: { request: TriggerEditorRequest; onClose(): void }) {
  const id = useId();
  const project = useProjects((s) => s.projects.get(request.root));
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  const profileDefaults = profiles.find((p) => p.id === (project?.profileId ?? defaultProfile))?.defaults ?? null;
  const defaults = useMemo(() => layeredDefaults(project?.defaults, profileDefaults), [project?.defaults, profileDefaults]);
  const models = useHosts((s) => s.models);
  const [form, setForm] = useState<TriggerForm>(() => (request.trigger ? triggerForm(request.trigger) : newTriggerForm(request.root, defaults, request.from)));
  const [info, setInfo] = useState<TriggerRepoInfo | null>(() => useTriggers.getState().repoInfo.get(request.root) ?? null);
  const [renaming, setRenaming] = useState(false);
  const [otherAssignee, setOtherAssignee] = useState(() => form.assignee !== '@me');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRepoInfo(request.root).then(
      (next) => {
        if (cancelled) return;
        setInfo(next);
        // A new CI trigger's name says the default branch once it is known.
        setForm((current) => updateForm(current, {}, next.defaultBranch));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [request.root]);

  const update = (patch: Partial<TriggerForm>) => setForm((current) => updateForm(current, patch, info?.defaultBranch ?? null));
  const problem = formProblem(form);
  const warning = sharedRepoWarning(form, info?.repo ?? null, info?.collaborators ?? null);
  const folder = form.workspace === 'current';
  const atOnce = folder ? 1 : form.maxAtOnce;
  const issues = form.kind === 'issues';
  const login = info?.login ?? null;

  const save = async () => {
    setTried(true);
    if (problem || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTrigger(formToSave(form));
      request.onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Invalid params:?\s*/i, '') : String(e));
      setSaving(false);
    }
  };

  // What the sessions run with, from the project unless changed here.
  const fromProject = !request.trigger && form.model === (defaults?.model ?? null) && form.permissionMode === (defaults?.permissionMode && defaults.permissionMode !== 'bypassPermissions' ? defaults.permissionMode : 'default') && form.workspace === (defaults?.workspace ?? 'worktree');
  const profileId = form.profileId ?? project?.profileId ?? defaultProfile;
  const assigneeOptions = [
    { value: '@me', label: login ? `@${login}` : '@me' },
    ...(otherAssignee ? [{ value: 'other', label: form.assignee && form.assignee !== '@me' ? `@${form.assignee}` : 'Someone else' }] : []),
    ...(!otherAssignee ? [{ value: 'other', label: 'Someone else…' }] : []),
  ];

  return (
    <Dialog
      title={request.trigger ? 'Edit trigger' : 'New trigger'}
      icon={<Zap size={16} className="text-trigger" aria-hidden />}
      headerActions={<span className="text-ui text-muted">{project?.name ?? basename(request.root)}</span>}
      width="lg"
      onClose={onClose}
      onSubmit={() => void save()}
      initialFocus={firstRef}
      footerStart={<span className="text-meta text-muted" data-trigger-first-check>{firstCheckLine(form.kind)}</span>}
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={saving || (tried && !!problem)} onClick={() => void save()} data-trigger-save>
            {request.trigger ? 'Save' : 'Create trigger'}
          </Button>
        </>
      }
      data-trigger-editor={request.trigger?.id ?? 'new'}
    >
      <div className="@container grid gap-4">
        <Row label="Name" htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            value={form.name}
            maxLength={200}
            onChange={(e) => update({ name: e.target.value, nameTouched: true })}
            className={`w-80 ${FIELD} ${tried && !form.name.trim() ? 'border-error' : 'border-edge'}`}
            data-trigger-name
          />
        </Row>
        <Row label="When" labelId={`${id}-when`}>
          <RadioGroup label="When" className="grid grid-cols-2 gap-2 @max-[640px]:grid-cols-1">
            {TRIGGER_SOURCES.map((source, i) => {
              const checked = !source.soon && form.kind === source.kind;
              return (
                <button
                  key={source.kind}
                  ref={i === 0 ? firstRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-disabled={source.soon || undefined}
                  aria-describedby={source.soon ? `${id}-soon` : undefined}
                  tabIndex={checked ? 0 : -1}
                  // A disabled card stays in the group for screen readers, but the arrow keys skip it.
                  disabled={source.soon}
                  onClick={() => {
                    if (!source.soon && (source.kind === 'ci' || source.kind === 'issues')) update({ kind: source.kind });
                  }}
                  className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left ${checked ? 'border-accent-ink ring-1 ring-accent-ink/40' : 'border-edge hover:bg-border/45'} disabled:cursor-default disabled:hover:bg-transparent`}
                  data-trigger-source={source.kind}
                >
                  <SourceIcon kind={source.kind} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex items-center gap-2 text-ui font-semibold text-text">
                      {source.title}
                      {source.soon && <span className="rounded-md bg-border/70 px-1.5 text-meta font-medium text-muted">Soon</span>}
                    </span>
                    <span className="truncate text-meta text-muted">{source.detail}</span>
                  </span>
                </button>
              );
            })}
          </RadioGroup>
          <span id={`${id}-soon`} className="sr-only">
            Coming later
          </span>
        </Row>

        {form.kind === 'ci' ? (
          <>
            <Row label="Branch" htmlFor={`${id}-branch`}>
              <div className="relative w-64">
                <input
                  id={`${id}-branch`}
                  value={form.branch}
                  placeholder={info?.defaultBranch ?? 'the default branch'}
                  onChange={(e) => update({ branch: e.target.value })}
                  className={`w-full ${FIELD} border-edge pr-16 font-mono`}
                  data-trigger-branch
                />
                {!form.branch.trim() && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">default</span>}
              </div>
            </Row>
            <Row label="Workflows" labelId={`${id}-workflows`}>
              <div role="group" aria-labelledby={`${id}-workflows`} className="flex flex-wrap gap-1.5" data-trigger-workflows>
                {['', ...(info?.workflows ?? []), ...form.workflows.filter((w) => !info?.workflows.includes(w))].map((name) => {
                  const on = name === '' ? form.workflows.length === 0 : form.workflows.includes(name);
                  return (
                    <button
                      key={name || 'all'}
                      type="button"
                      aria-pressed={on}
                      onClick={() => update({ workflows: name === '' ? [] : on ? form.workflows.filter((w) => w !== name) : [...form.workflows, name] })}
                      className={`h-7 rounded-md border px-2.5 text-ui ${on ? 'border-accent-ink bg-accent/15 font-semibold text-text' : 'border-edge text-muted hover:bg-border/45 hover:text-text'}`}
                      data-trigger-workflow={name || 'all'}
                    >
                      {name || 'All'}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-meta text-muted">A newer failure of the same workflow replaces one that still waits.</p>
            </Row>
          </>
        ) : (
          <>
            <Row label="Which issues" labelId={`${id}-which`}>
              <SegmentedControl mode="radio" label="Which issues" value={form.which} onChange={(which) => update({ which })} segments={WHICH_ISSUES.map((w) => ({ value: w.value, label: w.label, data: { 'data-trigger-which': w.value } }))} className="w-fit" />
            </Row>
            <Row label={form.which === 'assignee' ? 'Assigned to' : 'Label'} htmlFor={form.which === 'assignee' ? undefined : `${id}-label`} labelId={`${id}-assigned`}>
              <div className="flex flex-wrap items-center gap-2">
                {form.which !== 'assignee' && (
                  <input
                    id={`${id}-label`}
                    value={form.label}
                    onChange={(e) => update({ label: e.target.value })}
                    maxLength={50}
                    className={`w-56 ${FIELD} ${tried && !form.label.trim() ? 'border-error' : 'border-edge'}`}
                    data-trigger-label
                  />
                )}
                {form.which !== 'label' && (
                  <>
                    {form.which === 'both' && <span className="text-ui text-muted">Assigned to</span>}
                    <Select
                      label="Assigned to"
                      className={CHIP}
                      value={form.assignee === '@me' && !otherAssignee ? '@me' : 'other'}
                      onChange={(value) => {
                        setOtherAssignee(value === 'other');
                        update({ assignee: value === '@me' ? '@me' : form.assignee === '@me' ? '' : form.assignee });
                      }}
                      options={assigneeOptions}
                      dataAttrs={{ 'data-trigger-assignee': true }}
                    />
                    {otherAssignee ? (
                      <input
                        aria-label="GitHub login"
                        placeholder="login"
                        value={form.assignee === '@me' ? '' : form.assignee}
                        onChange={(e) => update({ assignee: e.target.value.replace(/^@/, '') })}
                        className={`w-40 ${FIELD} font-mono ${tried && !form.assignee.trim() ? 'border-error' : 'border-edge'}`}
                        data-trigger-assignee-login
                      />
                    ) : (
                      <span className="text-meta text-muted">{login ? 'signed in to gh' : 'the account gh uses'}</span>
                    )}
                  </>
                )}
              </div>
            </Row>
            <Row label="From" labelId={`${id}-from`}>
              <Checkbox checked={form.collaboratorsOnly} onChange={(collaboratorsOnly) => update({ collaboratorsOnly })} dataAttrs={{ 'data-trigger-collaborators': true }}>
                <span className="grid gap-0.5">
                  <span className="text-ui text-text">Only collaborators</span>
                  <span className="text-meta text-muted">Owners, members and collaborators. A bot or template can add a label for anyone, so on a public repository anyone could start a session here.</span>
                </span>
              </Checkbox>
            </Row>
          </>
        )}
        {/* Always there, so the warning is read out when it appears. */}
        <div aria-live="polite" className="empty:hidden">
          {warning && (
            <Notice tone="caution" icon={<AlertTriangle size={14} aria-hidden />} role="note" data-trigger-shared-warning>
              {warning}
            </Notice>
          )}
        </div>
        {info?.problem && (
          <Notice tone="caution" icon={<AlertTriangle size={14} aria-hidden />} data-trigger-gh-problem>
            {info.problem}. Triggers check GitHub through gh on this computer.
          </Notice>
        )}

        {issues && (
          <section aria-labelledby={`${id}-github`} className="grid gap-3 border-t border-border pt-4">
            <SectionHeader as="h3" headingId={`${id}-github`}>
              On GitHub
            </SectionHeader>
            <div className="grid gap-3 pl-[162px] @max-[640px]:pl-0">
              <div className="grid gap-1.5">
                <Checkbox checked={form.stateLabels.on} onChange={(on) => update({ stateLabels: { ...form.stateLabels, on } })} dataAttrs={{ 'data-trigger-state-labels': true }}>
                  <span className="text-ui text-text">Keep a state label on the issue</span>
                </Checkbox>
                {form.stateLabels.on && (
                  <div className="grid gap-1.5 pl-5.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {STATE_LABEL_KEYS.map((key) => (
                        <StateLabelPill key={key} which={key} name={form.stateLabels[key]} />
                      ))}
                      <Button variant="quiet" size="sm" aria-expanded={renaming} onClick={() => setRenaming(!renaming)} data-trigger-rename-labels>
                        Rename labels
                      </Button>
                    </div>
                    {renaming && (
                      <div className="grid grid-cols-2 gap-1.5 @max-[640px]:grid-cols-1" data-trigger-label-names>
                        {STATE_LABEL_KEYS.map((key) => (
                          <input
                            key={key}
                            aria-label={`${STATE_WORDS[key]} label`}
                            value={form.stateLabels[key]}
                            maxLength={50}
                            onChange={(e) => update({ stateLabels: { ...form.stateLabels, [key]: e.target.value } })}
                            className={`${FIELD} ${tried && !form.stateLabels[key].trim() ? 'border-error' : 'border-edge'}`}
                          />
                        ))}
                      </div>
                    )}
                    <p className="text-meta text-muted">{form.which === 'assignee' ? 'Take the state label off to start an issue again.' : `The ${form.label.trim() || 'trigger'} label comes off when work starts.`} Missing labels are created.</p>
                  </div>
                )}
              </div>
              <Checkbox checked={form.assignOnPickUp} onChange={(assignOnPickUp) => update({ assignOnPickUp })} dataAttrs={{ 'data-trigger-assign': true }}>
                <span className="grid gap-0.5">
                  <span className="text-ui text-text">Assign to me when picked up</span>
                  <span className="text-meta text-muted">Skips issues that already have an assignee.</span>
                </span>
              </Checkbox>
            </div>
          </section>
        )}

        <section aria-labelledby={`${id}-then`} className="grid gap-4 border-t border-border pt-4">
          <SectionHeader as="h3" headingId={`${id}-then`}>
            Then
          </SectionHeader>
          <Row label="Prompt" htmlFor={`${id}-prompt`}>
            <TriggerPromptField id={`${id}-prompt`} value={form.prompt} onChange={(prompt) => update({ prompt })} kind={form.kind} describedBy={`${id}-prompt-hint`} invalid={tried && !form.prompt.trim()} />
            <p id={`${id}-prompt-hint`} className="mt-1.5 text-meta text-muted">
              {issues ? "Type {{ for event fields. The issue's text goes in as context to read, not instructions." : "Type {{ for event fields. The failed jobs' log goes in as context to read, not instructions."}
            </p>
          </Row>
          <Row label="Runs with" labelId={`${id}-runs`}>
            <div role="group" aria-labelledby={`${id}-runs`} className="flex flex-wrap items-center gap-1.5" data-trigger-runs-with>
              <Select
                label="Workspace"
                className={CHIP}
                value={form.workspace}
                onChange={(workspace) => update({ workspace })}
                options={[
                  { value: 'worktree', label: 'New worktree', icon: <GitBranch size={13} aria-hidden /> },
                  { value: 'current', label: 'Project folder', icon: <Folder size={13} aria-hidden /> },
                ]}
                dataAttrs={{ 'data-trigger-workspace': true }}
              />
              {profiles.length > 1 && (
                <Select
                  label="Claude profile"
                  className={CHIP}
                  value={profileId}
                  onChange={(value) => update({ profileId: value === (project?.profileId ?? defaultProfile) ? null : value })}
                  options={profiles.map((p) => ({ value: p.id, label: p.name, icon: <span className={`size-2 rounded-full ${PROFILE_DOT[p.color]}`} /> }))}
                  dataAttrs={{ 'data-trigger-profile': true }}
                />
              )}
              <Select
                label="Model"
                className={CHIP}
                value={form.model ?? ''}
                onChange={(value) => update({ model: value || null })}
                options={[{ value: '', label: 'Default model' }, ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName })), ...(form.model && !models.some((m) => m.value === form.model) ? [{ value: form.model, label: modelLabel(models, form.model) }] : [])]}
                dataAttrs={{ 'data-trigger-model': true }}
              />
              <Select
                label="Permission mode"
                className={CHIP}
                value={form.permissionMode}
                onChange={(permissionMode) => update({ permissionMode })}
                // Bypass permissions is left out: a trigger starts work from text other people wrote.
                options={MODE_CHOICES.map((m) => ({ value: m, label: MODE_LABEL[m], icon: <span className={`size-2 rounded-full ${MODE_DOT[m] ?? 'bg-faint'}`} /> }))}
                dataAttrs={{ 'data-trigger-mode': true }}
              />
              {fromProject && <span className="text-meta text-muted">from the project</span>}
            </div>
          </Row>
          <Row label="At once" labelId={`${id}-at-once`}>
            <div className="flex flex-wrap items-center gap-2 text-ui text-muted">
              <Stepper
                value={atOnce}
                min={TRIGGER_LIMITS.atOnce.min}
                max={folder ? 1 : TRIGGER_LIMITS.atOnce.max}
                onChange={(maxAtOnce) => update({ maxAtOnce })}
                label="Sessions at a time"
                less="Fewer at once"
                more="More at once"
                disabled={folder}
                hook="trigger-at-once"
              />
              <span>{atOnce === 1 ? 'session at a time' : 'sessions at a time'}</span>
            </div>
            <p className="mt-1.5 text-meta text-muted" data-trigger-folder-note={folder || undefined}>
              {folder ? 'Sessions in the project folder edit the same files, so only one runs at a time.' : 'The most sessions this trigger runs together. A session counts while it works or waits for you.'}
            </p>
          </Row>
          <Row label="Waiting" labelId={`${id}-waiting`}>
            <div className="flex flex-wrap items-center gap-2 text-ui text-muted">
              <Stepper value={form.maxWaiting} min={TRIGGER_LIMITS.waiting.min} max={TRIGGER_LIMITS.waiting.max} onChange={(maxWaiting) => update({ maxWaiting })} label="Events that may wait" less="Fewer waiting" more="More waiting" hook="trigger-waiting" />
              <span>{form.maxWaiting === 1 ? 'event at most' : 'events at most'}</span>
            </div>
            <p className="mt-1.5 text-meta text-muted">
              {atOnce === 1 ? 'While its session is busy' : `While ${atOnce} sessions are busy`}, new events wait their turn, oldest first. Past {form.maxWaiting}, they are skipped.
            </p>
          </Row>
        </section>

        {tried && problem && (
          <p className="text-ui text-error" role="alert" data-trigger-problem>
            {problem}
          </p>
        )}
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

const STATE_WORDS: Record<StateLabelKey, string> = { working: 'Working', needsInput: 'Needs input', prOpen: 'Pull request open', failed: 'Failed' };

/** Each state label in the status colour it stands for: working yellow, needs input pink, pull request green, failed red. */
const STATE_PILL: Record<StateLabelKey, string> = {
  working: 'border-accent-ink/50 bg-accent/12 text-accent-ink',
  needsInput: 'border-warn/50 bg-warn/10 text-warn',
  prOpen: 'border-ok/50 bg-ok/10 text-ok',
  failed: 'border-error/50 bg-error/10 text-error',
};

/** A state label as a pill, in the colour of the state it says (GitHub gets the same hues when it is made). */
export function StateLabelPill({ which, name }: { which: StateLabelKey; name: string }) {
  return (
    <span className={`inline-flex h-5.5 items-center rounded-full border px-2 text-meta font-medium ${STATE_PILL[which]}`} data-state-label={which}>
      {name}
    </span>
  );
}
