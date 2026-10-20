import { useState, type MouseEvent, type ReactNode } from 'react';
import { Copy, Folder, GitPullRequest, Globe, Lock, MoreHorizontal, Pencil, Plus, Trash2, Users, type LucideIcon } from 'lucide-react';
import type { Pipeline, PipelineSaveScope } from '@switchboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { pipelineSummary } from '../../state/pipelines.ts';
import { duplicatePipeline, movePipeline, openPipelineEditor, requestDeletePipeline, usePipelineList, usePipelines } from '../../state/pipelinesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Select } from '../ui/Select.tsx';

/**
 * The project Settings › Pipelines lists and saves "This project" and "Shared with the project" for: the one picked on
 * the page, else the open session's, else the first project. Null with no projects at all.
 */
function useSettingsRoot() {
  const projects = useProjects((s) => s.projects);
  const picked = usePipelines((s) => s.settingsRoot);
  const selected = useSessions((s) => (s.selectedId ? (s.sessions.get(s.selectedId)?.projectRoot ?? null) : null));
  const added = addedProjects(projects);
  const root = picked && (projects.has(picked) || added.length === 0) ? picked : selected && projects.has(selected) ? selected : (added[0]?.root ?? null);
  const nameOf = (r: string) => projects.get(r)?.name ?? basename(r);
  return { root, added, nameOf, set: (next: string) => usePipelines.setState({ settingsRoot: next }) };
}

/** "+ New pipeline", next to the page's title. */
export function NewPipelineButton() {
  const { root } = useSettingsRoot();
  return (
    <Button size="md" icon={<Plus size={13} aria-hidden />} onClick={() => openPipelineEditor({ pipeline: null, root })} className="shrink-0" data-pipelines-new data-setting-row>
      New pipeline
    </Button>
  );
}

/**
 * Settings › Pipelines: the built-in pipelines (read only, to duplicate), yours for all projects, yours for the project
 * picked at the top, and the ones shared with that project in its .switchboard.json; each with Edit, Duplicate, Move
 * and Delete, and what is wrong with a shared one.
 */
export function PipelinesSettings() {
  const { root, added, nameOf, set } = useSettingsRoot();
  const list = usePipelineList(root);
  const all = list?.pipelines ?? [];
  const of = (kind: Pipeline['scope']['kind']) => all.filter((p) => p.scope.kind === kind);
  const project = root ? nameOf(root) : null;
  return (
    <div className="flex flex-col gap-5" data-pipelines-settings>
      {added.length > 0 && root && (
        <div className="flex items-center justify-between gap-4" data-setting-row>
          <span>
            <span className="block text-ui">Project</span>
            <span className="block text-meta text-muted">Whose pipelines are listed under This project and Shared with the project.</span>
          </span>
          <Select
            label="Project"
            value={root}
            options={[...added.map((p) => ({ value: p.root, label: p.name })), ...(added.some((p) => p.root === root) ? [] : [{ value: root, label: nameOf(root) }])]}
            onChange={set}
            className="h-8 shrink-0 rounded-md border border-edge bg-bg px-2.5 text-ui text-text"
            menuWidth={220}
            dataAttrs={{ 'data-pipelines-project': true }}
          />
        </div>
      )}
      <Group heading={<Heading Icon={Lock} tone="text-muted" name="Built in" place="read only" />} pipelines={of('builtin')} root={root} nameOf={nameOf} />
      <Group heading={<Heading Icon={Globe} tone="text-muted" name="All projects" place="just for you" />} pipelines={of('global')} empty="No pipelines for every project yet." root={root} nameOf={nameOf} />
      {root && <Group heading={<Heading Icon={Folder} tone="text-accent-ink" name={project!} place="just for you" />} pipelines={of('project')} empty="No pipelines for this project yet." root={root} nameOf={nameOf} />}
      {root && (
        <>
          <Group heading={<Heading Icon={Users} tone="text-link" name={project!} place="shared with the project" />} pipelines={of('shared')} empty="Nothing shared with this project yet." root={root} nameOf={nameOf} />
          {(list?.errors ?? []).length > 0 && (
            <Notice tone="caution" data-pipelines-errors>
              {list!.errors.join(' ')}
            </Notice>
          )}
        </>
      )}
      <p className="flex items-start gap-2 text-ui text-muted">
        <Users size={13} aria-hidden className="mt-0.5 shrink-0" />
        Shared pipelines are saved with the project’s actions, in .switchboard.json. Commit that change so your team gets them. The first time someone runs one, they read every step first.
      </p>
    </div>
  );
}

function Heading({ Icon, tone, name, place }: { Icon: LucideIcon; tone: string; name: string; place?: string }) {
  return (
    <h3 className="flex min-w-0 items-center gap-1.5 px-1 text-meta">
      <Icon size={12} aria-hidden className={`shrink-0 ${tone}`} />
      <span className={`truncate font-semibold tracking-wide uppercase ${tone}`}>{name}</span>
      {place && <span className="shrink-0 text-faint">· {place}</span>}
    </h3>
  );
}

function Group({ heading, pipelines, empty, root, nameOf }: { heading: ReactNode; pipelines: Pipeline[]; empty?: string; root: string | null; nameOf(root: string): string }) {
  if (pipelines.length === 0 && !empty) return null;
  return (
    <section className="flex flex-col gap-1.5">
      {heading}
      {pipelines.length === 0 ? (
        <p className="border-t border-border px-1 pt-2 text-ui text-muted">{empty}</p>
      ) : (
        <ul className="border-t border-border">
          {pipelines.map((pipeline) => (
            <PipelineRow key={`${pipeline.scope.kind}:${pipeline.id}`} pipeline={pipeline} root={root} nameOf={nameOf} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A pipeline: its name and steps, what is wrong with it if it is shared, and its menu. */
function PipelineRow({ pipeline, root, nameOf }: { pipeline: Pipeline; root: string | null; nameOf(root: string): string }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const builtin = pipeline.scope.kind === 'builtin';
  const edit = () => openPipelineEditor({ pipeline, root });
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right - 240, y: rect.bottom + 4 });
  };
  // Where it can go: not where it is.
  const home = pipeline.scope.kind === 'project' || pipeline.scope.kind === 'shared' ? pipeline.scope.root : root;
  const move = (to: PipelineSaveScope, where: string) => void movePipeline(pipeline, to, where);
  const icon = (Icon: LucideIcon) => <Icon size={13} aria-hidden />;
  const entries: MenuEntry[] = [
    { label: 'Edit…', icon: icon(Pencil), onSelect: edit, data: { 'data-pipeline-edit': true } },
    { label: 'Duplicate', icon: icon(Copy), onSelect: () => void duplicatePipeline(pipeline), data: { 'data-pipeline-duplicate': true } },
    'separator',
    { heading: 'Move to' },
    { label: 'All projects', icon: icon(Globe), checked: pipeline.scope.kind === 'global', onSelect: () => move({ kind: 'global' }, 'All projects'), data: { 'data-pipeline-move': 'global' } },
    ...(home
      ? [
          { label: `${nameOf(home)}, just for you`, icon: icon(Folder), checked: pipeline.scope.kind === 'project', onSelect: () => move({ kind: 'project', root: home }, `${nameOf(home)}, just for you`), data: { 'data-pipeline-move': 'project' } },
          { label: 'Shared with the project', icon: icon(Users), checked: pipeline.scope.kind === 'shared', onSelect: () => move({ kind: 'shared', root: home }, `${nameOf(home)}, shared with the project`), data: { 'data-pipeline-move': 'shared' } },
        ]
      : []),
    'separator',
    { label: 'Delete', icon: icon(Trash2), danger: true, onSelect: () => requestDeletePipeline(pipeline), data: { 'data-pipeline-delete': true } },
  ];

  return (
    <li className="border-b border-border px-1 py-2 hover:bg-border/45" data-pipeline-row={pipeline.id} data-pipeline-scope={pipeline.scope.kind}>
      <div className="flex items-center gap-3">
        <GitPullRequest size={14} aria-hidden className="shrink-0 text-muted" />
        {builtin ? (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-ui text-text">{pipeline.name}</span>
            <span className="block truncate text-meta text-muted">{rowMeta(pipeline)}</span>
          </span>
        ) : (
          <button type="button" className="min-w-0 flex-1 text-left" onClick={edit}>
            <span className="block truncate text-ui text-text">{pipeline.name}</span>
            <span className="block truncate text-meta text-muted">{rowMeta(pipeline)}</span>
          </button>
        )}
        {builtin ? (
          <Button size="sm" icon={<Copy size={12} aria-hidden />} onClick={() => void duplicatePipeline(pipeline)} data-pipeline-duplicate>
            Duplicate
          </Button>
        ) : (
          <Button variant="quiet" size="sm" iconOnly icon={<MoreHorizontal size={14} />} aria-label={`More for ${pipeline.name}`} onClick={openMenu} data-pipeline-menu />
        )}
        {menu && <Menu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} label={pipeline.name} width={240} />}
      </div>
      {pipeline.issues.length > 0 && (
        <Notice tone="caution" className="mt-2" data-pipeline-issues={pipeline.id}>
          <ul className="grid gap-0.5">
            {pipeline.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Notice>
      )}
    </li>
  );
}

/** The line under a pipeline's name: its steps in order, then where they work. */
function rowMeta(pipeline: Pipeline): string {
  return `${pipeline.steps.map((s) => s.name).join(' → ')} · ${pipelineSummary(pipeline)}`;
}
