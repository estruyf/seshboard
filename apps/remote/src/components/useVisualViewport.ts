import { useEffect, useState } from 'react';
import { keyboardFrame, type ViewportFrame } from '../lib/viewport.ts';

/**
 * While `focused` (the message box has focus), the part of the page the keyboard leaves visible, kept up to date as
 * it resizes and as Safari scrolls the page under it; null otherwise, so the view goes back to its normal size on
 * blur. Null too where the browser shrinks the page itself (Android, `interactive-widget=resizes-content`).
 */
export function useVisualViewport(focused: boolean): ViewportFrame | null {
  const [frame, setFrame] = useState<ViewportFrame | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!focused || !viewport) {
      setFrame(null);
      return;
    }
    const update = () => {
      const next = keyboardFrame({ focused: true, layoutHeight: window.innerHeight, viewportHeight: viewport.height, offsetTop: viewport.offsetTop });
      setFrame((current) => (current?.height === next?.height && current?.top === next?.top ? current : next));
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setFrame(null);
    };
  }, [focused]);
  return frame;
}
