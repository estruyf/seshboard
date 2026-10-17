import { ShieldAlert } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RepoBrings } from '@switchboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { trustGroups, trustText } from './cloneModel.ts';

/**
 * Asked once before the first session in a cloned repository that brings hooks, MCP servers, `allow` rules, plugins
 * or settings that run something: Claude Code loads the project's settings without the trust question its CLI asks.
 * Cancel has the focus, so ↩ never starts someone else's code by accident.
 */
export function CloneTrustDialog({ brings, onAnswer }: { brings: RepoBrings; onAnswer(start: boolean): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      role="alertdialog"
      width="md"
      title="Start in this repository?"
      subtitle={<div className="leading-relaxed">{trustText(brings)}</div>}
      onClose={() => onAnswer(false)}
      initialFocus={cancelRef}
      data-clone-trust
      footerStart={<ShieldAlert size={15} className="text-warn" aria-hidden />}
      footer={
        <>
          <Button ref={cancelRef} onClick={() => onAnswer(false)} data-clone-trust-cancel>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onAnswer(true)} data-clone-trust-start>
            Start anyway
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {trustGroups(brings).map((group) => (
          <section key={group.title} className="grid gap-1">
            <h3 className="text-meta font-semibold tracking-wide text-faint uppercase">{group.title}</h3>
            <ul className="grid gap-0.5">
              {group.items.map((item) => (
                <li key={item} className="rounded-md bg-code px-2 py-1 font-mono text-meta break-all text-text">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * The trust question as a promise: `ask` shows the dialog (once per folder) and resolves with the answer; `dialog` is
 * what to render.
 */
export function useTrustQuestion(): { ask(root: string, brings: RepoBrings): Promise<boolean>; dialog: ReactNode } {
  const [open, setOpen] = useState<{ brings: RepoBrings; answer(start: boolean): void } | null>(null);
  const trusted = useRef(new Set<string>());
  const ask = useCallback(
    (root: string, brings: RepoBrings) =>
      trusted.current.has(root)
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) =>
            setOpen({
              brings,
              answer: (start) => {
                setOpen(null);
                if (start) trusted.current.add(root);
                resolve(start);
              },
            }),
          ),
    [],
  );
  const dialog = useMemo(() => (open ? <CloneTrustDialog brings={open.brings} onAnswer={open.answer} /> : null), [open]);
  return { ask, dialog };
}
