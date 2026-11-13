import { useEffect, useId, useRef, useState } from 'react';
import type { BrowserBookmark } from '@seshboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { projectOfTab, removeBookmark, updateBookmark } from '../../state/browserBookmarksStore.ts';
import { addFavorite, useFavoriteOf } from '../../state/browserFavoritesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { bookmarkFolders, FOLDER_MAX } from './bookmarks.ts';
import type { BrowserTab } from './browserTabs.ts';

/**
 * A page's bookmark, just added by ⌘D or the star (or the one it had): its name, where it shows (this session's
 * project, or everywhere) and its folder, and also a favourite on request. Done saves; Remove takes the bookmark away.
 * Closing keeps it as it is, as a browser's bookmark bubble does.
 */
export function BookmarkDialog({ tab, bookmark, bookmarks, onClose }: { tab: BrowserTab; bookmark: BrowserBookmark; bookmarks: readonly BrowserBookmark[]; onClose(): void }) {
  const [title, setTitle] = useState(bookmark.title);
  const [folder, setFolder] = useState(bookmark.folder);
  const project = projectOfTab(tab);
  const [scope, setScope] = useState<'project' | 'everywhere'>(bookmark.projectRoot && bookmark.projectRoot === project ? 'project' : 'everywhere');
  const projectName = useProjects((s) => (project ? (s.projects.get(project)?.name ?? basename(project)) : null));
  const favorite = useFavoriteOf(tab.url) !== undefined;
  const [alsoFavorite, setAlsoFavorite] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  // Added just now (in this second): its title is the page's; an older one says Edit bookmark.
  const [added] = useState(() => Date.now() - bookmark.createdAt < 2_000);
  useEffect(() => inputRef.current?.select(), []);

  const done = () => {
    // Without a project here (the Browser view), where it shows stays as it was.
    const projectRoot = !projectName ? bookmark.projectRoot : scope === 'project' ? project : null;
    updateBookmark(bookmark.id, { title, folder, projectRoot });
    if (alsoFavorite && !favorite) addFavorite(tab);
    onClose();
  };
  const remove = () => {
    removeBookmark(bookmark.id);
    onClose();
  };

  return (
    <Dialog
      width="sm"
      title={added ? 'Bookmark added' : 'Edit bookmark'}
      onClose={onClose}
      onSubmit={done}
      initialFocus={inputRef}
      data-bookmark-dialog
      footer={
        <>
          <Button variant="danger" onClick={remove} className="mr-auto" data-bookmark-remove>
            Remove
          </Button>
          <Button variant="primary" kbd="↵" onClick={done} data-bookmark-done>
            Done
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        <label className="grid gap-1 text-ui text-muted" htmlFor={`${id}-name`}>
          Name
          <input
            ref={inputRef}
            id={`${id}-name`}
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={bookmark.url}
            className="h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink"
            data-bookmark-name
          />
        </label>
        {projectName && (
          <div className="grid gap-1 text-ui text-muted">
            <span id={`${id}-scope`}>Show it in</span>
            <SegmentedControl
              mode="radio"
              size="sm"
              fill
              label="Show it in"
              value={scope}
              onChange={(value: 'project' | 'everywhere') => setScope(value)}
              segments={[
                { value: 'project', label: projectName, data: { 'data-bookmark-scope': 'project' } },
                { value: 'everywhere', label: 'Everywhere', data: { 'data-bookmark-scope': 'everywhere' } },
              ]}
            />
          </div>
        )}
        <label className="grid gap-1 text-ui text-muted" htmlFor={`${id}-folder`}>
          Folder
          <input
            id={`${id}-folder`}
            value={folder}
            maxLength={FOLDER_MAX}
            list={`${id}-folders`}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="None"
            className="h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink"
            data-bookmark-folder
          />
          <datalist id={`${id}-folders`}>
            {bookmarkFolders(bookmarks).map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <Checkbox checked={favorite || alsoFavorite} disabled={favorite} disabledReason="It is a favourite already" onChange={setAlsoFavorite} dataAttrs={{ 'data-bookmark-favorite': true }}>
          Also add to favourites
        </Checkbox>
      </form>
    </Dialog>
  );
}
