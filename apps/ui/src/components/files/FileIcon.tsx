import { useEffect } from 'react';
import type { FileIconTheme } from '@seshboard/protocol/client';
import { fileIconId } from '../../lib/fileIcons.ts';
import { useFileIcons, wantFileIcon } from '../../state/fileIconStore.ts';

/**
 * A file's or folder's icon from the VS Code icon theme of Settings › Theme › File icons. Takes its 16px while the
 * icon loads, so the name doesn't move when it arrives.
 */
export function FileIcon({ theme, path, dir, open, light }: { theme: FileIconTheme; path: string; dir: boolean; open: boolean; light: boolean }) {
  const icon = fileIconId(theme, path, { dir, open, light });
  const url = useFileIcons((s) => (icon ? s.urls[icon] : null));
  useEffect(() => {
    if (icon) wantFileIcon(icon);
  }, [icon]);
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden data-file-icon={icon ?? ''}>
      {url && <img src={url} alt="" draggable={false} className="size-4" />}
    </span>
  );
}
