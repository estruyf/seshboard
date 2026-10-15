import { useState } from 'react';
import { pastedLink } from '../lib/link.ts';
import { Button } from './ui.tsx';

const canRead = typeof navigator.clipboard?.readText === 'function';

/**
 * A field for a pairing or connect link, for where the page can't be opened with one: an app on the Home Screen has no
 * address bar, and on an iPhone it doesn't share Safari's pairing.
 */
export function LinkEntry({ onLink }: { onLink: (fragment: string) => void }) {
  const [text, setText] = useState('');

  const paste = async () => {
    try {
      const pasted = await navigator.clipboard.readText();
      setText(pasted);
      if (pastedLink(pasted)) onLink(pastedLink(pasted));
    } catch {
      // Not allowed: the field still takes a paste.
    }
  };

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onLink(pastedLink(text));
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-ui text-muted">Link from your computer</span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="https://…"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className="field min-h-11 px-3 text-body pointer-fine:min-h-8"
        />
      </label>
      <div className="flex gap-2">
        {canRead && (
          <Button className="flex-1" onClick={() => void paste()}>
            Paste
          </Button>
        )}
        <Button type="submit" variant="primary" className="flex-1" disabled={!pastedLink(text)}>
          Open link
        </Button>
      </div>
    </form>
  );
}
