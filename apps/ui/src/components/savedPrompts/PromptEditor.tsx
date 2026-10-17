import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Globe, User, Users } from 'lucide-react';
import { blankProblems, escapeText, PROMPT_NAME_MAX, type PromptScope, type SavedPrompt } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename } from '../../lib/format.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { Select } from '../ui/Select.tsx';
import { editorPreview, fromSegments, sameScope, toSegments, type Segments } from './fillModel.ts';
import { announceMove, announceShared } from './promptActions.ts';
import { ProjectMultiSelect } from './ProjectPicker.tsx';
import { PromptTextEditor } from './PromptTextEditor.tsx';

const USE_IN = [
  { kind: 'global', heading: 'Every project', line: 'Only you. Shows in every project.', Icon: Globe },
  { kind: 'personal', heading: 'Just for you, in projects', line: 'Only you. Pick the projects it shows in.', Icon: User },
  { kind: 'shared', heading: 'Shared with a project', line: "Saved with the project's actions, so everyone on the project gets it once it's committed.", Icon: Users },
] as const;

export interface PromptEditorProps {
  /** The prompt to edit; null for a new one. */
  editing: SavedPrompt | null;
  /** A new one's text (Save as prompt: the message you sent). */
  text?: string;
  /** Save as prompt: links, branches and paths in the text are offered as blanks. */
  fromMessage?: boolean;
  /** The project it was opened in, for "just for you" and "shared"; null outside one. */
  root: string | null;
  /** Where a new one goes; by default, the project just for you (every project without one). */
  scope?: PromptScope;
  onClose(): void;
}

/** What is wrong with a prompt before it can be saved; empty when it's fine. */
export function editorProblems(name: string, segments: Segments): string[] {
  const problems: string[] = [];
  if (!name.trim()) problems.push('Give the prompt a name.');
  const text = fromSegments(segments);
  if (!text.trim()) problems.push('Write the prompt.');
  if (segments.blanks.some((blank) => !blank.name)) problems.push('Every blank needs a name.');
  return [...problems, ...blankProblems(text)];
}

/**
 * New prompt, Edit and Save as prompt: the name, where it is used (every project, this project just for you, or
 * shared with the project in its actions file), and the text with its blanks as chips.
 */
export function PromptEditor({ editing, text, fromMessage, root: openedIn, scope: initialScope, onClose }: PromptEditorProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const root = editing && editing.scope.kind !== 'global' ? editing.scope.root : openedIn;
  const projects = useProjects((s) => s.projects);
  const nameOf = (r: string) => projects.get(r)?.name ?? basename(r);
  const [name, setName] = useState(editing?.name ?? '');
  // A sent message is plain text: braces in it stay braces.
  const [segments, setSegments] = useState<Segments>(() => toSegments(editing?.text ?? (text !== undefined ? escapeText(text) : '')));
  const first: PromptScope = editing?.scope ?? initialScope ?? (root ? { kind: 'personal', root } : { kind: 'global' });
  const [kind, setKind] = useState<PromptScope['kind']>(first.kind);
  // Just for you: the projects it goes into (one when editing, since a prompt is moved, not copied). Shared: the one project.
  const [personalRoots, setPersonalRoots] = useState<string[]>(first.kind === 'personal' ? [first.root] : root ? [root] : []);
  const [sharedRoot, setSharedRoot] = useState<string | null>(first.kind === 'shared' ? first.root : root);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);

  // Every project that exists, plus the ones this prompt is already in.
  const choices = useMemo(() => {
    const roots = new Set(addedProjects(projects).map((p) => p.root));
    for (const r of [root, sharedRoot, ...personalRoots]) if (r) roots.add(r);
    return [...roots].map((r) => ({ root: r, name: projects.get(r)?.name ?? basename(r) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  useEffect(() => {
    if (!fromMessage || !client || !root) return;
    void client.call('git.branches', { cwd: root }).then(({ branches }) => setBranches(branches), () => {});
  }, [fromMessage, client, root]);

  const promptText = fromSegments(segments);
  const where = kind === 'personal' ? personalRoots.length === 0 : kind === 'shared' ? !sharedRoot : false;
  const problems = useMemo(() => [...editorProblems(name, segments), ...(where ? [kind === 'personal' ? 'Choose at least one project.' : 'Choose a project.'] : [])], [name, segments, where, kind]);
  /** Where it is saved: one scope, or one per project ticked for "just for you". */
  const scopes = (): PromptScope[] => (kind === 'global' ? [{ kind }] : kind === 'shared' ? [{ kind, root: sharedRoot! }] : personalRoots.map((r) => ({ kind, root: r })));

  const save = async () => {
    setTried(true);
    if (problems.length || !client || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [scope, ...more] = scopes() as [PromptScope, ...PromptScope[]];
      let id = editing?.id;
      let moved: SavedPrompt | null = null;
      // Another place: moved there first (written there, then taken out of where it was), then saved there.
      if (editing && !sameScope(editing.scope, scope)) {
        moved = (await client.call('savedPrompts.move', { id: editing.id, from: editing.scope, to: scope })).prompt;
        id = moved.id;
      }
      const { prompt } = await client.call('savedPrompts.save', { prompt: { id, name: name.trim(), text: promptText, scope } });
      // A new prompt just for you in several projects: one each.
      for (const extra of more) await client.call('savedPrompts.save', { prompt: { name: name.trim(), text: promptText, scope: extra } });
      onClose();
      if (editing && moved) announceMove(editing, moved, nameOf);
      else if (!editing && scope.kind === 'shared') announceShared(prompt.name, scope.root, true, nameOf, () => void client.call('savedPrompts.delete', { id: prompt.id, scope: prompt.scope }).catch(() => {}));
      else if (!editing) toast(`Saved “${prompt.name}”${more.length ? ` in ${more.length + 1} projects` : ''}`, { body: 'Type / in any message box to use it.', data: { 'data-prompt-saved-toast': true } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const title = editing ? 'Edit saved prompt' : fromMessage ? 'Save as prompt' : 'New saved prompt';
  const shown = tried ? problems : [];
  const status = error ? (
    <span role="alert" className="text-meta text-error">
      {error}
    </span>
  ) : shown.length ? (
    <span role="alert" className="text-meta text-error" data-prompt-editor-problem>
      {shown[0]}
    </span>
  ) : (
    <span className="text-meta text-muted" aria-live="polite" data-prompt-editor-preview>
      {editorPreview(promptText)}
    </span>
  );
  return (
    <Dialog
      title={title}
      subtitle={fromMessage ? 'Click a highlighted link, branch or path to make it a blank you fill in each time.' : undefined}
      width="md"
      placement="top"
      onClose={onClose}
      onSubmit={() => void save()}
      initialFocus={nameRef}
      data-prompt-editor-dialog
    >
      <div className="flex flex-col gap-4">
        <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 text-ui text-muted">
          Name
          <input
            ref={nameRef}
            value={name}
            maxLength={PROMPT_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="Implement issue"
            className={`rounded-md border bg-bg px-2.5 py-1.5 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink/60 ${tried && !name.trim() ? 'border-error' : 'border-edge'}`}
            data-prompt-editor-name
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span id={`${ids}-use-in`} className="text-ui text-muted">
            Use in
          </span>
          <RadioGroup label="Use in" className="grid gap-1.5">
            {USE_IN.map(({ kind: place, heading, line, Icon }) => {
              const checked = kind === place;
              const needsProject = place !== 'global';
              return (
                <Radio
                  key={place}
                  checked={checked}
                  disabled={needsProject && choices.length === 0}
                  onSelect={() => setKind(place)}
                  className={`w-full rounded-lg border px-3 py-2 ${checked ? 'border-accent-ink bg-accent/8' : 'border-edge hover:bg-border/45'}`}
                  dataAttrs={{ 'data-prompt-use-in': place }}
                >
                  <span className="flex items-start gap-2">
                    <Icon size={14} aria-hidden className="mt-px shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui font-semibold text-text">{heading}</span>
                      <span className="block text-meta text-muted">{line}</span>
                    </span>
                  </span>
                </Radio>
              );
            })}
          </RadioGroup>
          {kind === 'personal' &&
            (editing ? (
              <Select
                value={personalRoots[0] ?? ''}
                options={choices.map((c) => ({ value: c.root, label: c.name }))}
                onChange={(r) => setPersonalRoots([r])}
                label="Project"
                placeholder="Choose a project"
                className="w-full rounded-md border border-edge bg-bg px-2.5 py-1.5 text-ui text-text"
                dataAttrs={{ 'data-prompt-project-select': true }}
              />
            ) : (
              <ProjectMultiSelect projects={choices} picked={personalRoots} onChange={setPersonalRoots} label="Projects" />
            ))}
          {kind === 'shared' && (
            <Select
              value={sharedRoot ?? ''}
              options={choices.map((c) => ({ value: c.root, label: c.name }))}
              onChange={setSharedRoot}
              label="Project"
              placeholder="Choose a project"
              className="w-full rounded-md border border-edge bg-bg px-2.5 py-1.5 text-ui text-text"
              dataAttrs={{ 'data-prompt-project-select': true }}
            />
          )}
        </div>
        <PromptTextEditor
          segments={segments}
          onChange={setSegments}
          suggest={fromMessage}
          branches={branches}
          labelledBy={`${ids}-text`}
          status={status}
          actions={
            <>
              <Button kbd="Esc" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" kbd="⌘↵" disabled={busy} onClick={() => void save()} data-prompt-editor-save>
                Save
              </Button>
            </>
          }
        />
        <span id={`${ids}-text`} className="sr-only">
          Prompt
        </span>
      </div>
    </Dialog>
  );
}
