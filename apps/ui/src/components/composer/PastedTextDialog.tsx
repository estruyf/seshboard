import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { pasteSize } from './contextItems.ts';

/**
 * Shows and edits a pasted text before it is sent. Saving empty text removes it. Portalled to the body: the session
 * view is an `@container`, which would otherwise hold the fixed scrim inside it.
 */
export function PastedTextDialog({ label, text, onSave, onRemove, onClose }: { label: string; text: string; onSave(text: string): void; onRemove(): void; onClose(): void }) {
  const [value, setValue] = useState(text);
  const save = () => {
    if (value !== text) onSave(value);
    onClose();
  };
  return createPortal(
    <Dialog
      width="lg"
      title={label}
      subtitle={value.trim() ? `${pasteSize(value)}. Sent with your message, after what you type.` : 'Empty: saving removes it.'}
      onClose={onClose}
      onSubmit={save}
      data-pasted-text-dialog
      footerStart={
        <Button variant="danger" onClick={onRemove} data-pasted-text-remove>
          Remove
        </Button>
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="⌘↵" onClick={save} data-pasted-text-save>
            Save
          </Button>
        </>
      }
    >
      <textarea
        autoFocus
        aria-label={`${label}, text`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        className="h-[50vh] w-full resize-none rounded-lg border border-edge bg-code p-3 font-mono text-ui text-text outline-none [overflow-wrap:anywhere] focus:border-accent-ink"
        data-pasted-text-editor
      />
    </Dialog>,
    document.body,
  );
}
