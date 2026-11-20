import { useEffect, useId, useRef, useState } from 'react';
import { addressBarUrl, type BrowserFavorite } from '@seshboard/protocol/client';
import { updateFavorite, useBrowserFavorites } from '../../state/browserFavoritesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { favoriteAddressProblem } from './favorites.ts';

/** Edit favourite…: a favourite's name and address, as you type them. The address changes only here and from its menu. */
export function EditFavoriteDialog({ favorite, onClose }: { favorite: BrowserFavorite; onClose(): void }) {
  const favorites = useBrowserFavorites((s) => s.favorites);
  const [title, setTitle] = useState(favorite.title);
  const [address, setAddress] = useState(favorite.url);
  const [tried, setTried] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const problem = favoriteAddressProblem(address, favorites, favorite.id);

  useEffect(() => titleRef.current?.select(), []);

  const save = () => {
    setTried(true);
    if (problem) return;
    updateFavorite(favorite.id, { title, url: addressBarUrl(address, { anyHost: true })! });
    onClose();
  };
  const field = 'h-7 w-full rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';

  return (
    <Dialog
      width="sm"
      title="Edit favourite"
      onClose={onClose}
      onSubmit={save}
      initialFocus={titleRef}
      data-edit-favorite-dialog
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="↵" data-edit-favorite-save onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="grid gap-1 text-meta text-muted" htmlFor={`${id}-title`}>
          Name
          <input ref={titleRef} id={`${id}-title`} value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} placeholder={address} className={`${field} border-edge`} data-edit-favorite-title />
        </label>
        <label className="grid gap-1 text-meta text-muted" htmlFor={`${id}-address`}>
          Address
          <input
            id={`${id}-address`}
            value={address}
            maxLength={8000}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            aria-invalid={tried && problem ? true : undefined}
            aria-describedby={tried && problem ? `${id}-problem` : undefined}
            className={`${field} font-mono ${tried && problem ? 'border-error' : 'border-edge'}`}
            data-edit-favorite-address
          />
          {tried && problem && (
            <span id={`${id}-problem`} className="text-error" data-edit-favorite-problem>
              {problem}
            </span>
          )}
        </label>
      </form>
    </Dialog>
  );
}
