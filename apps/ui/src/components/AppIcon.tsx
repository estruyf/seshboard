import { useEffect, useState } from 'react';
import { Code, Folder, SquareTerminal } from 'lucide-react';
import type { EditorInfo } from '@seshboard/protocol/client';

/** Icons asked of main once each, for every rail and menu that shows the app. */
const icons = new Map<string, Promise<string | null>>();

function iconOf(path: string): Promise<string | null> {
  let icon = icons.get(path);
  if (!icon) {
    icon = window.seshboard?.appIcon(path).catch(() => null) ?? Promise.resolve(null);
    icons.set(path, icon);
  }
  return icon;
}

/** The app's own icon (VS Code's, Finder's), as main reads it from the app; null until then, or when there is none. */
export function useAppIcon(path: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!path) return;
    let live = true;
    void iconOf(path).then((icon) => live && setSrc(icon));
    return () => {
      live = false;
    };
  }, [path]);
  return src;
}

const KIND_ICON = { editor: Code, terminal: SquareTerminal, finder: Folder } as const;

/** An editor, terminal or file manager by its own icon, or by a plain one for its kind (Linux, or while it loads). */
export function AppIcon({ editor, size }: { editor: EditorInfo; size: number }) {
  const src = useAppIcon(editor.icon);
  if (src) return <img src={src} alt="" aria-hidden width={size} height={size} draggable={false} className="shrink-0" data-app-icon={editor.id} />;
  const Icon = KIND_ICON[editor.kind];
  return <Icon size={size - 2} aria-hidden />;
}
