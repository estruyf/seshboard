import { createContext } from 'react';

/** Opens a file in the preview, at a line or a range when the link named one. */
export type OpenPreview = (path: string, line?: number, endLine?: number) => void;

/**
 * Where a file link's preview opens. The session view opens it in its own side panel (or the dialog, as the reader chose),
 * the dialog in itself; without one (Home, a project page) it opens in the dialog.
 */
export const PreviewOpenerContext = createContext<OpenPreview | null>(null);
