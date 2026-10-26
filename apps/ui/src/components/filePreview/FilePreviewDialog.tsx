import { PanelRight } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { tildify } from '../../lib/format.ts';
import { useFilePreview, type PreviewTarget } from '../../state/filePreviewStore.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { PreviewOpenerContext, type OpenPreview } from './previewOpener.ts';
import { useFilePreviewContent } from './useFilePreviewContent.tsx';

/** What the smoke test sends to open a file: a path (the dialog), or a path with the session whose panel shows it and its lines. */
type SmokeOpen = string | { path: string; sessionId?: string; line?: number; endLine?: number };

/**
 * The file preview as a dialog over the window (`useFilePreview().openDialog(path)`), mounted once per window: for a file
 * opened outside a session, or from a session once the reader detached the preview from its side panel. Dock to the side
 * puts it back in the session's panel.
 */
export function FilePreviewDialog() {
  const target = useFilePreview((s) => s.dialog);
  // The smoke test opens a preview without a conversation that links to a throwaway file.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<SmokeOpen>).detail;
      if (typeof detail === 'string') useFilePreview.getState().openDialog(detail);
      else if (detail && typeof detail.path === 'string') useFilePreview.getState().open(detail.path, { sessionId: detail.sessionId ?? null, line: detail.line, endLine: detail.endLine });
    };
    window.addEventListener('seshboard:preview-file', onOpen);
    return () => window.removeEventListener('seshboard:preview-file', onOpen);
  }, []);
  return target ? <PreviewDialog key={target.path} target={target} /> : null;
}

function PreviewDialog({ target }: { target: PreviewTarget }) {
  const close = useFilePreview((s) => s.close);
  const dock = useFilePreview((s) => s.dock);
  const home = useHomeFolder();
  const { name, kind, switcher, tools, body } = useFilePreviewContent(target);
  // A link in the file opens the next file here, still belonging to the session it came from.
  const sessionId = target.sessionId;
  const openHere = useCallback<OpenPreview>((path, line, endLine) => useFilePreview.getState().openDialog(path, { sessionId, line, endLine }), [sessionId]);

  return (
    <Dialog
      title={name}
      subtitle={<span className="font-mono text-meta [overflow-wrap:anywhere]">{tildify(target.path, home)}</span>}
      width="full"
      flush
      onClose={close}
      data-file-preview=""
      data-file-preview-kind={kind}
      data-file-preview-place="dialog"
      headerActions={
        <>
          {switcher && <span className="mr-1 flex">{switcher}</span>}
          {tools}
          {sessionId && <Button variant="quiet" size="sm" iconOnly icon={<PanelRight size={14} aria-hidden />} aria-label="Dock to the side" data-file-preview-dock="" onClick={dock} />}
        </>
      }
    >
      <PreviewOpenerContext.Provider value={openHere}>{body}</PreviewOpenerContext.Provider>
    </Dialog>
  );
}
