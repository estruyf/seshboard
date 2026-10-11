import { usePaletteBus } from '../../state/paletteBus.ts';

/** Import from Claude export…: picks the export's files, then shows the preview. */
export async function importFromClaudeExport(): Promise<void> {
  const paths = (await window.switchboard?.chooseMemoryExport()) ?? [];
  if (paths.length) usePaletteBus.getState().showDialog({ kind: 'memory-import', source: { kind: 'export', paths } });
}

/** Paste from Claude app…: the prompt to send there, then the preview of what you paste back. */
export const pasteFromClaudeApp = () => usePaletteBus.getState().showDialog({ kind: 'memory-import', source: { kind: 'paste' } });

/** Copy for Claude app…: pick memories and copy them as one block. */
export const copyForClaudeApp = () => usePaletteBus.getState().showDialog({ kind: 'memory-copy-app' });
