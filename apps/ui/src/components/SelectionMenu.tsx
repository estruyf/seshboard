import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { contextMenuPoint, type ContextMenuPoint } from '../lib/contextMenu.ts';
import { SELECTABLE } from '../lib/selectable.ts';
import { copySelection, currentClip, type Clip } from './transcript/selectionClip.ts';
import { Menu } from './Menu.tsx';

/**
 * Right-click on text you selected (the Remote address, a diff, a memory) offers Copy. The window's text is
 * `user-select: none` except where `.select-text` opts in, so this only ever reacts to text meant to be copied.
 * Fields and controls with a context menu of their own handle the event first and are left alone.
 */
export function SelectionMenu() {
  const [at, setAt] = useState<ContextMenuPoint | null>(null);
  const [text, setText] = useState('');
  // Worked out when the menu opens, while the selection is still there.
  const [clip, setClip] = useState<Clip | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const selected = window.getSelection()?.toString() ?? '';
      if (!selected.trim() || !(event.target instanceof Element) || !event.target.closest(SELECTABLE)) return;
      event.preventDefault();
      setText(selected);
      setClip(currentClip());
      setAt(contextMenuPoint({ x: event.clientX, y: event.clientY }, event.target.getBoundingClientRect(), window.innerHeight));
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  if (!at) return null;
  return (
    <Menu
      x={at.x}
      y={at.y}
      above={at.above}
      width={160}
      label="Selected text"
      onClose={() => setAt(null)}
      entries={[{ label: 'Copy', icon: <Copy size={13} />, onSelect: () => void copySelection(text, clip), data: { 'data-selection-copy': true } }]}
    />
  );
}
