import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { BLANK_NAME_MAX, BLANK_TYPE_LABELS, BLANK_TYPES, type BlankSpec, type BlankType } from '@switchboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Select } from '../ui/Select.tsx';

/** What a blank's name can't hold: the characters that write a blank. */
export const cleanBlankName = (name: string) => name.replace(/[{}:?|=]/g, '').slice(0, BLANK_NAME_MAX);

/** Options as typed in the form ("staging | production"), as a list. */
export const optionsFrom = (text: string) =>
  text
    .split('|')
    .map((o) => o.trim())
    .filter(Boolean);

const FORM_WIDTH = 300;

/**
 * The small form a blank's chip opens in the prompt editor: its name, type, options (a choice) and whether it is
 * optional. Changes apply as you make them; Done or Esc closes it, Remove takes the blank out.
 */
export function BlankForm({ anchor, spec, onChange, onRemove, onClose }: { anchor: HTMLElement; spec: BlankSpec; onChange(spec: BlankSpec): void; onRemove(): void; onClose(refocus: boolean): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState(spec.options.join(' | '));
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - FORM_WIDTH - 8));
    const room = window.innerHeight - rect.bottom;
    setPosition(room < 260 && rect.top > room ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 });
  }, [anchor]);
  useEffect(() => nameRef.current?.select(), []);
  useEffect(() => {
    const down = (event: MouseEvent) => {
      const target = event.target as Node;
      // The type's menu opens outside the form, in a portal of its own.
      if (ref.current?.contains(target) || anchor.contains(target) || (target instanceof Element && target.closest('[role=listbox], [role=menu]'))) return;
      onClose(false);
    };
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, [anchor, onClose]);

  const set = (patch: Partial<BlankSpec>) => onChange({ ...spec, ...patch });
  const style = { left: position.left, width: FORM_WIDTH, ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }) };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Blank"
      className="fixed z-[60] flex flex-col gap-2.5 rounded-lg border p-3 overlay"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
      }}
      data-blank-form
      data-popover
    >
      <label className="flex flex-col gap-1 text-meta text-muted">
        Name
        <input
          ref={nameRef}
          value={spec.name}
          onChange={(e) => set({ name: cleanBlankName(e.target.value) })}
          spellCheck={false}
          className="rounded-md border border-edge bg-bg px-2 py-1 font-mono text-ui text-text outline-none focus:border-accent-ink/60"
          data-blank-form-name
        />
      </label>
      <div className="flex flex-col gap-1 text-meta text-muted">
        <span>Type</span>
        <Select<BlankType> value={spec.type} options={BLANK_TYPES.map((type) => ({ value: type, label: BLANK_TYPE_LABELS[type] }))} onChange={(type) => set({ type, options: type === 'choice' ? optionsFrom(options) : [] })} label="Type" menuWidth={200} />
      </div>
      {spec.type === 'choice' && (
        <label className="flex flex-col gap-1 text-meta text-muted">
          Options, split with |
          <input
            value={options}
            placeholder="staging | production"
            onChange={(e) => {
              setOptions(e.target.value);
              set({ options: optionsFrom(e.target.value) });
            }}
            className="rounded-md border border-edge bg-bg px-2 py-1 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink/60"
            data-blank-form-options
          />
          {spec.options.length === 0 && <span className="text-error">A choice needs options.</span>}
        </label>
      )}
      <Checkbox checked={spec.optional} onChange={(optional) => set({ optional })}>
        Optional: it can be left empty
      </Checkbox>
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="danger" size="sm" icon={<Trash2 size={12} aria-hidden />} onClick={onRemove}>
          Remove
        </Button>
        <Button variant="primary" size="sm" onClick={() => onClose(true)} disabled={!spec.name}>
          Done
        </Button>
      </div>
    </div>,
    // Inside the editor's dialog, so Tab stays in the dialog and goes through the form.
    anchor.closest<HTMLElement>('[aria-modal="true"]') ?? document.body,
  );
}
