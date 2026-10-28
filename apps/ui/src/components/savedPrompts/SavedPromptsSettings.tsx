import { useState, type MouseEvent, type ReactNode } from 'react';
import { Folder, Globe, MoreHorizontal, Plus, User, Users, type LucideIcon } from 'lucide-react';
import type { PromptScope, SavedPrompt } from '@seshboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { promptMeta, sameScope } from './fillModel.ts';
import { deletePrompt, duplicatePrompt, movePrompt } from './promptActions.ts';
import { useSavedPrompts, useSavedPromptsStore } from './savedPromptsStore.ts';
import { PromptIcon } from './ScopeTag.tsx';

/**
 * The project "just for you" and "Share" mean for a prompt kept for every project, and for a new one: the one you typed
 * in last, else the open session's, else the first project. With how to name a project and open the editor.
 */
function usePromptContext() {
  const projects = useProjects((s) => s.projects);
  const lastRoot = useSavedPromptsStore((s) => s.lastRoot);
  const selected = useSessions((s) => (s.selectedId ? (s.sessions.get(s.selectedId)?.projectRoot ?? null) : null));
  const added = addedProjects(projects);
  const contextRoot = lastRoot ?? (selected && projects.has(selected) ? selected : (added[0]?.root ?? null));
  const nameOf = (root: string) => projects.get(root)?.name ?? basename(root);
  const open = (editing: SavedPrompt | null) => usePaletteBus.getState().showDialog({ kind: 'prompt-editor', editing, root: editing && editing.scope.kind !== 'global' ? editing.scope.root : contextRoot });
  return { projects, added, lastRoot, contextRoot, nameOf, open };
}

/** "+ New prompt", next to the page's title. */
export function NewPromptButton() {
  const { open } = usePromptContext();
  return (
    <Button size="md" icon={<Plus size={13} aria-hidden />} onClick={() => open(null)} className="shrink-0" data-saved-prompts-new data-setting-row>
      New prompt
    </Button>
  );
}

/**
 * Settings › Prompts: every saved prompt, by where it is kept (every project, then per project just for you and
 * shared with the project), each with Edit, Duplicate, where to use it, and Delete.
 */
export function SavedPromptsSettings() {
  const { projects, added, lastRoot, contextRoot, nameOf, open } = usePromptContext();
  const { prompts: global } = useSavedPrompts(null);
  return (
    <div className="flex flex-col gap-5" data-saved-prompts-settings>
      <PromptGroup heading={<GroupHeading Icon={Globe} tone="text-muted" name="Every project" />} prompts={global.filter((p) => p.scope.kind === 'global')} empty="No prompts for every project yet." contextRoot={contextRoot} nameOf={nameOf} onEdit={open} />
      {/* Your projects, and the folder you typed in last when it isn't one of them (a session in another folder). */}
      {[...added.map((project) => project.root), ...(lastRoot && !projects.has(lastRoot) ? [lastRoot] : [])].map((root) => (
        <ProjectGroups key={root} root={root} nameOf={nameOf} onEdit={open} />
      ))}
      <p className="flex items-start gap-2 text-ui text-muted">
        <Users size={13} aria-hidden className="mt-0.5 shrink-0" />
        Shared prompts are saved with the project's actions. Commit that change so your team gets them.
      </p>
    </div>
  );
}

/** A group's heading: its icon and name in the place's colour, then what the place is, quieter. */
function GroupHeading({ Icon, tone, name, place }: { Icon: LucideIcon; tone: string; name: string; place?: string }) {
  return (
    <h3 className="flex min-w-0 items-center gap-1.5 px-1 text-meta">
      <Icon size={12} aria-hidden className={`shrink-0 ${tone}`} />
      <span className={`truncate font-semibold tracking-wide uppercase ${tone}`}>{name}</span>
      {place && <span className="shrink-0 text-faint">· {place}</span>}
    </h3>
  );
}

/** A project's own prompts, in two groups; nothing when it has none. */
function ProjectGroups({ root, nameOf, onEdit }: { root: string; nameOf(root: string): string; onEdit(prompt: SavedPrompt): void }) {
  const { prompts, errors } = useSavedPrompts(root);
  const personal = prompts.filter((p) => p.scope.kind === 'personal');
  const shared = prompts.filter((p) => p.scope.kind === 'shared');
  const name = nameOf(root);
  return (
    <>
      {personal.length > 0 && <PromptGroup heading={<GroupHeading Icon={User} tone="text-accent-ink" name={name} place="just for you" />} prompts={personal} contextRoot={root} nameOf={nameOf} onEdit={onEdit} />}
      {shared.length > 0 && <PromptGroup heading={<GroupHeading Icon={Users} tone="text-link" name={name} place="shared with the project" />} prompts={shared} contextRoot={root} nameOf={nameOf} onEdit={onEdit} />}
      {errors.length > 0 && (
        <Notice tone="caution" data-saved-prompts-errors>
          {errors.join(' ')}
        </Notice>
      )}
    </>
  );
}

function PromptGroup({
  heading,
  prompts,
  empty,
  contextRoot,
  nameOf,
  onEdit,
}: {
  heading: ReactNode;
  prompts: SavedPrompt[];
  empty?: string;
  contextRoot: string | null;
  nameOf(root: string): string;
  onEdit(prompt: SavedPrompt): void;
}) {
  if (prompts.length === 0 && !empty) return null;
  return (
    <section className="flex flex-col gap-1.5">
      {heading}
      {prompts.length === 0 ? (
        <p className="border-t border-border px-1 pt-2 text-ui text-muted">{empty}</p>
      ) : (
        <ul className="border-t border-border">
          {prompts.map((prompt) => (
            <PromptRow key={`${prompt.scope.kind}:${prompt.id}`} prompt={prompt} contextRoot={contextRoot} nameOf={nameOf} onEdit={onEdit} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PromptRow({ prompt, contextRoot, nameOf, onEdit }: { prompt: SavedPrompt; contextRoot: string | null; nameOf(root: string): string; onEdit(prompt: SavedPrompt): void }) {
  const [menu, setMenu] = useState<{ x: number; y: number; projects?: boolean } | null>(null);
  const projects = useProjects((s) => s.projects);
  const root = prompt.scope.kind === 'global' ? contextRoot : prompt.scope.root;
  const move = (to: PromptScope) => void movePrompt(prompt, to, nameOf);
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right - 240, y: rect.bottom + 4 });
  };

  const icon = (Icon: LucideIcon) => <Icon size={13} aria-hidden />;
  const useIn: MenuEntry[] = [
    { heading: 'Use in' },
    { label: 'Every project', icon: icon(Globe), checked: prompt.scope.kind === 'global', onSelect: () => move({ kind: 'global' }), data: { 'data-prompt-move': 'global' } },
    ...(root
      ? [
          { label: `${nameOf(root)}, just for you`, icon: icon(User), checked: sameScope(prompt.scope, { kind: 'personal', root }), onSelect: () => move({ kind: 'personal', root }), data: { 'data-prompt-move': 'personal' } },
          { label: 'Share with the project', icon: icon(Users), checked: sameScope(prompt.scope, { kind: 'shared', root }), onSelect: () => move({ kind: 'shared', root }), data: { 'data-prompt-move': 'shared' } },
        ]
      : []),
    // Its own list where this menu was, once this one has closed.
    { label: 'Another project…', icon: icon(Folder), onSelect: () => menu && setTimeout(() => setMenu({ ...menu, projects: true })), data: { 'data-prompt-move': 'other' } },
  ];
  const entries: MenuEntry[] = menu?.projects
    ? [
        { heading: prompt.scope.kind === 'shared' ? 'Share with another project' : 'Another project, just for you' },
        ...addedProjects(projects)
          .filter((p) => p.root !== root)
          .map((p) => ({ label: p.name, onSelect: () => move({ kind: prompt.scope.kind === 'shared' ? 'shared' : 'personal', root: p.root }) })),
      ]
    : [
        { label: 'Edit…', onSelect: () => onEdit(prompt), data: { 'data-prompt-edit': true } },
        { label: 'Duplicate', onSelect: () => void duplicatePrompt(prompt) },
        'separator',
        ...useIn,
        'separator',
        { label: 'Delete', danger: true, onSelect: () => void deletePrompt(prompt), data: { 'data-prompt-delete': true } },
      ];

  return (
    <li className="flex items-center gap-3 border-b border-border px-1 py-2 hover:bg-border/45" data-saved-prompt-row={prompt.id} data-saved-prompt-scope={prompt.scope.kind}>
      <PromptIcon size={14} aria-hidden className="shrink-0 text-muted" />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(prompt)}>
        <span className="block truncate text-ui text-text">{prompt.name}</span>
        <span className="block truncate text-meta text-muted">{promptMeta(prompt)}</span>
      </button>
      <Button variant="quiet" size="sm" iconOnly icon={<MoreHorizontal size={14} />} aria-label={`More for ${prompt.name}`} onClick={openMenu} data-saved-prompt-menu />
      {menu && <Menu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} label={prompt.name} width={240} />}
    </li>
  );
}
