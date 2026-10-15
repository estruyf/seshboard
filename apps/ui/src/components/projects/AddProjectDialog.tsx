import { Check, FolderOpen, Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { shortAge, tildify } from '../../lib/format.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { knownFolders } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { manage, useProjectActions } from '../sidebar/ProjectMenu.tsx';

/**
 * Add project: folders Claude Code has sessions for, most recent first and filterable by typing,
 * or any folder through the system dialog. Stays open so several can be added in one go; on closing,
 * the Projects view opens on the last one added so its profile and defaults can be set. New session opens it
 * too, with `onDone`: there the last one added is picked instead, and you stay in New session.
 */
export function AddProjectDialog({ onClose: close, onDone }: { onClose(): void; onDone?(lastAdded: string | null): void }) {
  const projects = useProjects((s) => s.projects);
  const actions = useProjectActions();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const lastAdded = useRef<string | null>(null);
  const onClose = useCallback(() => {
    close();
    if (onDone) onDone(lastAdded.current);
    else if (lastAdded.current) manage(lastAdded.current);
  }, [close, onDone]);
  const home = useHomeFolder();
  const folders = useMemo(() => knownFolders(projects, query, home), [projects, query, home]);
  // The extra row at the end: the system folder dialog.
  const count = folders.length + 1;

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = async (index: number) => {
    setError(null);
    try {
      if (index === folders.length) {
        const path = await actions.chooseAndAdd();
        if (path) {
          lastAdded.current = path;
          onClose();
        }
        return;
      }
      const folder = folders[index];
      if (folder && !folder.added) {
        await actions.add(folder.root);
        lastAdded.current = folder.root;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      placement="top"
      flush
      title="Add project"
      subtitle="Folders you have used Claude Code in, most recent first. Add as many as you like, then choose Done."
      onClose={onClose}
      data-add-project-dialog
      footerStart={
        <>
          <Button
            icon={<FolderOpen size={13} aria-hidden />}
            data-active={active === folders.length}
            data-choose-folder
            onMouseMove={() => setActive(folders.length)}
            onClick={() => void choose(folders.length)}
            // The keyboard highlight, like the folder rows above it.
            selected={active === folders.length}
          >
            Choose folder…
          </Button>
          {error && (
            <span role="alert" className="min-w-0 flex-1 truncate text-ui text-error" data-tooltip={error}>
              Couldn't add the folder: {error}
            </span>
          )}
        </>
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(count - 1, i + 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
          else if (e.key === 'Enter') (e.preventDefault(), void choose(active));
        }}
        placeholder="Filter by name or path"
        aria-label="Filter folders by name or path"
        aria-controls={`${id}-list`}
        spellCheck={false}
        className="h-10 shrink-0 border-b border-edge bg-transparent px-5 text-body text-text outline-none placeholder:text-faint"
      />
      <div ref={listRef} id={`${id}-list`} role="group" aria-label="Folders with Claude Code sessions" className="min-h-0 flex-1 overflow-y-auto py-1">
        {folders.length === 0 && (
          <p className="px-4 py-3 text-ui text-muted">{query ? 'No folder matches.' : 'No Claude Code sessions found yet. Choose a folder instead.'}</p>
        )}
        {folders.map((folder, index) => (
          <button
            key={folder.root}
            type="button"
            data-known-project={folder.root}
            data-added={folder.added}
            data-active={index === active}
            onMouseMove={() => setActive(index)}
            onClick={() => void choose(index)}
            disabled={folder.added}
            aria-label={folder.added ? `${folder.name}, already added` : `Add ${folder.name}`}
            aria-describedby={`${id}-path-${index}`}
            data-tooltip={folder.root}
            className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left ${index === active ? 'bg-accent/15' : ''}`}
          >
            <ProjectIcon project={folder} root={folder.root} size={22} />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-[12.5px] text-text">{folder.name}</span>
              <span id={`${id}-path-${index}`} className="truncate text-[11.5px] text-muted">
                {tildify(folder.root, home)}
                {!folder.exists && <span className="text-warn"> · folder not found</span>}
              </span>
            </span>
            <span className="shrink-0 text-right text-meta text-muted tabular-nums">
              {folder.sessionCount} {folder.sessionCount === 1 ? 'session' : 'sessions'}
              {folder.lastActivity !== null && <span className="block">{shortAge(folder.lastActivity)}</span>}
            </span>
            <span aria-hidden className="flex w-16 shrink-0 justify-end text-[11.5px]">
              {folder.added ? (
                <span className="flex items-center gap-1 text-accent-ink">
                  <Check size={12} /> Added
                </span>
              ) : (
                // Drawn as a small button so the row reads as something to click, not a plain label.
                <span className={`flex h-6 items-center gap-1 rounded-md border px-2 ${index === active ? 'border-accent-ink/60 bg-accent text-on-accent' : 'border-edge text-text'}`}>
                  <Plus size={11} /> Add
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
