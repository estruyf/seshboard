import { Fragment } from 'react';
import { KEY_LIST } from '../lib/keys.ts';
import { Sheet } from './Sheet.tsx';
import { Kbd } from './ui.tsx';

/** Every key of the wide layout (`?`), from the same list the handler is tested against. */
export function KeysSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard shortcuts" subtitle="Letters work when you're not typing in a field." onClose={onClose} hook="keys">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 pb-1">
        {KEY_LIST.map((entry) => (
          <Fragment key={entry.action}>
            <dt className="flex items-center gap-1 justify-self-end text-meta text-faint">
              {entry.keys.map((stored, i) => (
                <Fragment key={stored}>
                  {i > 0 && <span>{entry.action === 'files' ? '' : 'or'}</span>}
                  <Kbd shortcut={stored} tone="cap" />
                </Fragment>
              ))}
            </dt>
            <dd className="text-ui">{entry.label}</dd>
          </Fragment>
        ))}
      </dl>
    </Sheet>
  );
}
