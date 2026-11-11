import { useEffect, useId, useRef, useState } from 'react';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { TAB_NAME_MAX, tabName, type BrowserTab } from './browserTabs.ts';

/** Gives a browser tab a name of your own, kept over the page's title (and after a restart, for a pinned tab). Empty gives the page's title back. */
export function RenameTabDialog({ tab, onClose }: { tab: BrowserTab; onClose(): void }) {
  const [value, setValue] = useState(tabName(tab));
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // The old name selected, so typing replaces it and an arrow key keeps it.
  useEffect(() => inputRef.current?.select(), []);

  const save = () => {
    useWebPreview.getState().rename(tab.id, value);
    onClose();
  };

  return (
    <Dialog
      width="sm"
      title="Rename tab"
      subtitle="Leave it empty to use the page's title."
      onClose={onClose}
      onSubmit={save}
      initialFocus={inputRef}
      data-rename-tab-dialog
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="↵" data-rename-tab-save onClick={save}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor={`${id}-name`} className="sr-only">
          Tab name
        </label>
        <input
          ref={inputRef}
          id={`${id}-name`}
          value={value}
          maxLength={TAB_NAME_MAX}
          onChange={(e) => setValue(e.target.value)}
          placeholder={tab.title}
          className="h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink"
          data-rename-tab-input
        />
      </form>
    </Dialog>
  );
}
