import { ChevronRight, ClipboardCopy, Plus, ClipboardPaste, Download, FolderInput, FolderSearch, Plug, Unplug } from 'lucide-react';
import { fileManagerName } from '../../lib/platform.ts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MEMORY_INDEX_LIMIT, type MemoryFile } from '@seshboard/protocol/client';
import type { ContextMenuPoint } from '../../lib/contextMenu.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { guardMemoryEdits, useMemoryView } from '../../state/memoryStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { MemoryEditor } from './MemoryEditor.tsx';
import { MemoryRow, useMemoryActions } from './MemoryTab.tsx';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, tildify } from '../../lib/format.ts';
import { LEVEL_TEXT } from '../../lib/levels.ts';
import { openProject } from '../../state/projectPageStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Meter } from '../ui/Meter.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { DiffRows } from './DiffRows.tsx';
import { copyForClaudeApp, importFromClaudeExport, pasteFromClaudeApp } from './memoryDialogs.ts';
import { indexLevel } from './loadOrderView.ts';
import { useMemoryLinks, usePersonalMemory } from './useMemoryList.ts';

/** "MEMORY.md 62 / 200" with its meter in the index's level colours. */
export function IndexMeter({ lines, size = 'sm', className = '' }: { lines: number; size?: 'sm' | 'md'; className?: string }) {
  const level = indexLevel(lines);
  return (
    <Meter percent={(lines / MEMORY_INDEX_LIMIT) * 100} level={level} size={size} label={`MEMORY.md: ${lines} of ${MEMORY_INDEX_LIMIT} lines load`} className={className} data-memory-index-meter>
      <span className={`font-mono text-meta tabular-nums ${LEVEL_TEXT[level] || 'text-muted'}`}>
        MEMORY.md {lines} / {MEMORY_INDEX_LIMIT}
      </span>
    </Meter>
  );
}

/** The block preview: each profile's CLAUDE.md before and after, then Add to Claude Code. */
function BlockPreviewDialog({ onClose, onInstalled, readOnly }: { onClose(): void; onInstalled(): void; readOnly: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const profiles = useProfiles((s) => s.profiles);
  const [previews, setPreviews] = useState<Array<{ profileId: string; path: string; exists: boolean; diff: string }> | null>(null);
  const [line, setLine] = useState('');
  const [error, setError] = useState<string | null>(null);
  const home = useHomeFolder();
  useEffect(() => {
    if (!client) return;
    void client.call('memory.blockPreview', {}).then(
      (r) => (setPreviews(r.profiles), setLine(r.line)),
      (e: Error) => setError(e.message),
    );
  }, [client]);
  const install = async () => {
    if (!client) return;
    try {
      await client.call('memory.installBlock', {});
      onClose();
      onInstalled();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      title={readOnly ? 'The line in Claude Code' : 'Add personal memory to Claude Code'}
      subtitle="One import line in each profile's CLAUDE.md, inside a block Seshboard owns. The rest of the file stays as it is."
      width="lg"
      placement="top"
      onClose={onClose}
      onSubmit={readOnly ? undefined : () => void install()}
      data-memory-block-dialog
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button variant="primary" kbd="⌘↵" disabled={!previews} onClick={() => void install()} data-memory-block-install>
              Add to Claude Code
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-3">
        {error && <Notice tone="error">{error}</Notice>}
        {!previews && !error && <p className="text-ui text-muted">Reading…</p>}
        {previews?.map((p) => (
          <div key={p.profileId} className="grid gap-1.5" data-memory-block-profile={p.profileId}>
            <p className="text-meta text-muted">
              {profiles.find((x) => x.id === p.profileId)?.name ?? p.profileId} · <span className="font-mono">{tildify(p.path, home)}</span>
              {!p.exists && ' (new file)'}
            </p>
            <div className="overflow-auto rounded-lg border border-edge bg-code font-mono text-ui select-text">
              {readOnly || !p.diff ? <pre className="p-3 whitespace-pre-wrap text-text">{line}</pre> : <DiffRows diff={p.diff} />}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** The personal folder's memories, with the same rows and editor as a project's Memory tab. */
function PersonalMemories() {
  const { personal } = usePersonalMemory();
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ at: ContextMenuPoint; memory: MemoryFile } | null>(null);
  const actions = useMemoryActions(null, 'Personal', (path) => setSelected(path));
  const links = useMemoryLinks(null);
  const focus = useMemoryView((s) => s.focus);
  const handled = useRef(0);
  useEffect(() => {
    if (!focus || focus.root !== null || focus.nonce === handled.current || !personal?.memories.some((m) => m.path === focus.path)) return;
    handled.current = focus.nonce;
    setSelected(focus.path);
    setFocused(focus.path);
  }, [focus, personal]);
  if (!personal) return null;
  const memory = personal.memories.find((m) => m.path === selected);
  const taken = personal.memories.map((m) => basename(m.path).replace(/\.md$/, ''));
  const names = new Set(personal.memories.map((m) => m.name));
  const nameOf = (path: string) => personal.memories.find((m) => m.path === path)?.name ?? basename(path).replace(/\.md$/, '');
  const linkersOf = (m: MemoryFile) => (links[m.path]?.backlinks ?? []).map(nameOf);
  const entries = (m: MemoryFile): MenuEntry[] => [
    { label: 'Rename…', onSelect: () => actions.rename(m, taken, linkersOf(m)) },
    { label: `Reveal in ${fileManagerName()}`, onSelect: () => actions.reveal(m.path) },
    'separator',
    { label: 'Delete…', danger: true, onSelect: () => actions.remove(m) },
  ];
  return (
    <section className="grid gap-1" aria-labelledby="memory-personal-list-heading" data-memory-personal-list>
      <SectionHeader
        as="h3"
        headingId="memory-personal-list-heading"
        count={personal.memories.length}
        className="pb-1"
        action={
          <Button size="sm" variant="quiet" icon={<Plus size={12} aria-hidden />} onClick={() => guardMemoryEdits(() => actions.newMemory(taken))} data-memory-new-personal>
            New
          </Button>
        }
      >
        Personal memories
      </SectionHeader>
      {personal.memories.length === 0 && <p className="text-meta text-muted">Nothing yet. Memory about you and how you like to work goes here.</p>}
      {personal.memories.map((m) => (
        <MemoryRow key={m.path} memory={m} selected={m.path === selected} onSelect={() => guardMemoryEdits(() => setSelected(m.path))} onMenu={(at) => setMenu({ at, memory: m })} />
      ))}
      {memory && (
        <div className="mt-2 flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card">
          <MemoryEditor
            key={memory.path}
            root={null}
            memory={memory}
            names={names}
            autoFocus={memory.path === focused}
            linkInfo={links[memory.path]}
            labelOf={nameOf}
            onOpenPath={(path) => guardMemoryEdits(() => setSelected(path))}
            menuEntries={entries(memory).filter((e) => typeof e !== 'object' || !('label' in e) || e.label !== 'Rename…')}
            onRename={() => actions.rename(memory, taken, linkersOf(memory))}
            onDelete={() => actions.remove(memory)}
            onReveal={() => actions.reveal(memory.path)}
            onOpenLink={(name) => {
              const target = personal.memories.find((m) => m.name === name);
              if (target) guardMemoryEdits(() => setSelected(target.path));
              else guardMemoryEdits(() => actions.newMemory(taken, { name }));
            }}
          />
        </div>
      )}
      {menu && <Menu x={menu.at.x} y={menu.at.y} above={menu.at.above} entries={entries(menu.memory)} label="Memory" onClose={() => setMenu(null)} />}
      {actions.overlays}
    </section>
  );
}

/**
 * Settings › Memory: the personal folder (where it is, whether Claude Code loads it, how full its MEMORY.md is), every
 * project's memory with its meter, and the ways in and out of the Claude app (`actions`).
 */
export function MemorySettings({ actions }: { actions?: ReactNode }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const { personal, error, set } = usePersonalMemory();
  const projects = useProjects((s) => s.projects);
  const home = useHomeFolder();
  const [overview, setOverview] = useState<Array<{ root: string; memories: number; indexLines: number }> | null>(null);
  const [dialog, setDialog] = useState<'preview' | 'line' | 'remove' | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.call('memory.overview', {}).then((r) => !cancelled && setOverview(r.projects), () => {});
    return () => {
      cancelled = true;
    };
  }, [client, projects]);

  const changeFolder = async () => {
    if (!client || !personal) return;
    const picked = await window.seshboard?.pickFolder(personal.dir);
    if (!picked) return;
    try {
      set(await client.call('memory.setPersonalDir', { path: picked }));
    } catch (e) {
      toast(`Couldn't use that folder: ${(e as Error).message}`);
    }
  };

  if (error) return <Notice tone="error">{`Couldn't read personal memory: ${error}`}</Notice>;
  if (!personal) return <p className="text-ui text-muted">Reading…</p>;
  const installed = personal.profiles.some((p) => p.installed);
  const stale = personal.profiles.some((p) => !p.upToDate);

  return (
    <div className="grid gap-5" data-memory-settings>
      <div className="flex flex-wrap gap-2">
        <Button icon={<Download size={13} aria-hidden />} onClick={() => void importFromClaudeExport()} data-memory-import-export>
          Import from Claude export…
        </Button>
        <Button icon={<ClipboardPaste size={13} aria-hidden />} onClick={pasteFromClaudeApp} data-memory-paste-app>
          Paste from Claude app…
        </Button>
        <Button icon={<ClipboardCopy size={13} aria-hidden />} onClick={copyForClaudeApp} data-memory-copy-for-app>
          Copy for Claude app…
        </Button>
        {actions}
      </div>
      <p className="text-ui text-muted">Plain Markdown in the folders Claude Code already reads, so it works in the terminal and VS Code too.</p>

      <section className="grid gap-3 rounded-xl border border-border bg-card px-4 py-3" aria-labelledby="memory-personal-heading" data-memory-personal>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 id="memory-personal-heading" className="text-ui font-semibold">
            Personal memory
          </h3>
          <span className="text-meta text-muted">· loads in every project</span>
          <span className="ml-auto min-w-0 truncate font-mono text-meta text-muted" data-tooltip={personal.dir} data-memory-personal-dir>
            {tildify(personal.dir, home)}
          </span>
        </div>
        {personal.synced && (
          <Notice tone="warn" data-memory-synced>
            {`This folder is synced (${personal.synced}); anything you save here leaves this Mac.`}
          </Notice>
        )}
        <p className="text-meta text-muted" data-memory-block-state={installed ? (stale ? 'stale' : 'installed') : 'off'}>
          {installed
            ? stale
              ? 'Loaded through a line in your profiles’ CLAUDE.md, but not in all of them (or it points at another folder).'
              : 'Loaded through one line in each profile’s CLAUDE.md.'
            : 'Not loaded yet: Claude Code reads it once a line in each profile’s CLAUDE.md imports it.'}
        </p>
        <IndexMeter lines={personal.indexLines} size="md" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<FolderInput size={12} aria-hidden />} onClick={() => void changeFolder()} data-memory-change-folder>
            Change folder…
          </Button>
          <Button size="sm" icon={<FolderSearch size={12} aria-hidden />} disabled={!personal.exists} onClick={() => void client?.call('editors.open', { path: personal.dir, editorId: 'finder' }).catch(() => {})}>
            Show in {fileManagerName()}
          </Button>
          <span className="flex-1" />
          {installed && (
            <Button size="sm" variant="quiet" onClick={() => setDialog('line')} data-memory-show-line>
              Show the line
            </Button>
          )}
          {(!installed || stale) && (
            <Button size="sm" variant="primary" icon={<Plug size={12} aria-hidden />} onClick={() => setDialog('preview')} data-memory-add-block>
              Add to Claude Code…
            </Button>
          )}
          {installed && (
            <Button size="sm" variant="danger" icon={<Unplug size={12} aria-hidden />} onClick={() => setDialog('remove')} data-memory-remove-block>
              Remove from Claude Code
            </Button>
          )}
        </div>
      </section>

      <PersonalMemories />

      <section className="grid gap-1" aria-labelledby="memory-projects-heading">
        <SectionHeader as="h3" headingId="memory-projects-heading" className="pb-1">
          Projects
        </SectionHeader>
        {overview === null && <p className="text-meta text-muted">Reading…</p>}
        {overview?.length === 0 && <p className="text-meta text-muted">Add a project to see its memory here.</p>}
        {overview?.map((row) => {
          const project = projects.get(row.root);
          return (
            <button
              key={row.root}
              type="button"
              onClick={() => openProject(row.root, 'memory')}
              className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-border/45"
              data-memory-project={row.root}
            >
              {project && <ProjectIcon project={project} root={row.root} size={20} />}
              <span className="truncate text-ui">{project?.name ?? row.root}</span>
              <span className="shrink-0 text-meta text-muted">
                · {row.memories} {row.memories === 1 ? 'memory' : 'memories'}
              </span>
              <span className="flex-1" />
              {row.indexLines > 0 && <IndexMeter lines={row.indexLines} className="shrink-0" />}
              <ChevronRight size={13} className="shrink-0 text-faint" aria-hidden />
            </button>
          );
        })}
      </section>

      {(dialog === 'preview' || dialog === 'line') && <BlockPreviewDialog readOnly={dialog === 'line'} onClose={() => setDialog(null)} onInstalled={() => toast('Claude Code now loads your personal memory')} />}
      {dialog === 'remove' && (
        <ConfirmDialog
          title="Remove from Claude Code?"
          danger
          confirmLabel="Remove the line"
          body="Seshboard takes its block out of each profile's CLAUDE.md, and Claude stops loading your personal memory. The memory files stay where they are."
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            set(await client.call('memory.removeBlock', {}));
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
