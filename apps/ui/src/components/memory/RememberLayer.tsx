import { Brain, Copy } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { contextMenuPoint, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { Menu } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';

/** A message in the conversation that can be remembered: `data-remember-from` (`user` or `claude`) and its key. */
const SOURCE = '[data-remember-from]';

/** The selected text, when it lies inside one rememberable message (and which one). */
function selectionIn(): { text: string; element: HTMLElement } | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!selection || !text || selection.rangeCount === 0) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(SOURCE);
  return element ? { text, element } : null;
}

const fromOf = (element: HTMLElement): 'user' | 'claude' => (element.dataset.rememberFrom === 'user' ? 'user' : 'claude');

/**
 * Remember this from the conversation: right-click a message (Copy for a selection, and Remember this…, for the
 * selection or the whole message), or select text and use the small Remember this button that shows over it.
 */
export function useRememberLayer({ textOf, onRemember }: { textOf(key: string): string | null; onRemember(text: string, from: 'user' | 'claude'): void }) {
  const [menu, setMenu] = useState<{ at: ContextMenuPoint; text: string; selection: boolean; from: 'user' | 'claude' } | null>(null);
  const [chip, setChip] = useState<{ x: number; y: number; text: string; from: 'user' | 'claude' } | null>(null);

  // The button goes away when the selection does.
  useEffect(() => {
    const onChange = () => {
      if (!selectionIn()) setChip(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  const handlers = {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      const element = (event.target as Element).closest<HTMLElement>(SOURCE);
      if (!element) return;
      const selected = selectionIn();
      const text = selected?.element === element ? selected.text : textOf(element.dataset.messageKey ?? '');
      if (!text) return;
      event.preventDefault();
      setChip(null);
      setMenu({ at: contextMenuPoint({ x: event.clientX, y: event.clientY }, element.getBoundingClientRect(), window.innerHeight), text, selection: selected?.element === element, from: fromOf(element) });
    },
    onMouseUp: () => {
      // After the browser updated the selection.
      requestAnimationFrame(() => {
        const selected = selectionIn();
        if (!selected) return setChip(null);
        const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
        setChip({ x: rect.right, y: rect.top, text: selected.text, from: fromOf(selected.element) });
      });
    },
    onScroll: () => setChip(null),
  };

  const overlay = (
    <>
      {chip && (
        <div className="overlay fixed z-50 -translate-x-full -translate-y-full rounded-lg border p-0.5" style={{ left: chip.x, top: chip.y - 4 }} data-remember-selection>
          <Button size="sm" variant="quiet" icon={<Brain size={12} aria-hidden />} onMouseDown={(e) => e.preventDefault()} onClick={() => (setChip(null), onRemember(chip.text, chip.from))}>
            Remember this
          </Button>
        </div>
      )}
      {menu && (
        <Menu
          x={menu.at.x}
          y={menu.at.y}
          above={menu.at.above}
          label="Message"
          onClose={() => setMenu(null)}
          entries={[
            ...(menu.selection ? [{ label: 'Copy', icon: <Copy size={13} aria-hidden />, onSelect: () => void navigator.clipboard.writeText(menu.text) }] : []),
            { label: menu.selection ? 'Remember this…' : 'Remember this message…', icon: <Brain size={13} aria-hidden />, onSelect: () => onRemember(menu.text, menu.from), data: { 'data-remember-menu': true } },
          ]}
        />
      )}
    </>
  );
  return { handlers, overlay };
}
