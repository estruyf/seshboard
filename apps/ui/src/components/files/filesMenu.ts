import { lineSpan } from './viewerModel.ts';

/**
 * What a right-click (or Shift+F10) in the Files panel is on: a file or folder of the tree (or a file of Search's
 * results), the viewer with the lines picked in it, or a tab.
 */
export type FilesMenuTarget =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'viewer'; path: string; lines: { start: number; end: number } | null }
  | { kind: 'tab'; path: string; tabs: number };

/** What an item of the menu does. The ones that add go to the current session's message, as the VS Code companion's do. */
export type FilesAction =
  | 'add-lines'
  | 'ask-lines'
  | 'add-file'
  | 'add-folder'
  | 'add-open-files'
  | 'open'
  | 'open-full'
  | 'open-editor'
  | 'reveal'
  | 'search-folder'
  | 'find'
  | 'go-to-line'
  | 'copy-path'
  | 'copy-relative-path'
  | 'close'
  | 'close-others'
  | 'close-all';

/** The items of the menu for a target, in order, with separators between groups. */
export function filesMenu(target: FilesMenuTarget): Array<FilesAction | 'separator'> {
  switch (target.kind) {
    case 'file':
      return ['add-file', 'separator', 'open', 'open-full', 'open-editor', 'reveal', 'separator', 'copy-path', 'copy-relative-path'];
    case 'folder':
      return ['add-folder', 'search-folder', 'separator', 'reveal', 'separator', 'copy-path', 'copy-relative-path'];
    case 'viewer':
      return [...(target.lines ? (['add-lines', 'ask-lines'] as const) : []), 'add-file', 'separator', 'find', 'go-to-line', 'open-editor', 'reveal', 'separator', 'copy-path', 'copy-relative-path'];
    case 'tab':
      return ['add-file', ...(target.tabs > 1 ? (['add-open-files'] as const) : []), 'separator', 'close', ...(target.tabs > 1 ? (['close-others', 'close-all'] as const) : []), 'separator', 'open-editor', 'reveal', 'separator', 'copy-path', 'copy-relative-path'];
  }
}

/** An item's label. `fileManager` names Finder or File Explorer. */
export function filesActionLabel(action: FilesAction, target: FilesMenuTarget, fileManager: string): string {
  const lines = target.kind === 'viewer' && target.lines ? lineSpan(target.lines.start, target.lines.end) : 'lines';
  const labels: Record<FilesAction, string> = {
    'add-lines': `Add ${lines} to message`,
    'ask-lines': `Ask about ${lines}`,
    'add-file': 'Add file to message',
    'add-folder': 'Add folder to message',
    'add-open-files': 'Add open files to message',
    open: 'Open',
    'open-full': 'Open full size',
    'open-editor': 'Open in editor',
    reveal: `Show in ${fileManager}`,
    'search-folder': 'Search in folder',
    find: 'Find in file',
    'go-to-line': 'Go to line',
    'copy-path': 'Copy path',
    'copy-relative-path': 'Copy relative path',
    close: 'Close',
    'close-others': 'Close others',
    'close-all': 'Close all',
  };
  return labels[action];
}
