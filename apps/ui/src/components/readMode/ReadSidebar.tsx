import { useEffect, useRef } from 'react';
import { useSidebar } from '../../state/sidebarStore.ts';
import { Sidebar } from '../sidebar/Sidebar.tsx';
import { Scrim } from '../ui/Scrim.tsx';

/**
 * The session list over the reading view (⌘B): the real sidebar on a scrim, so the reader can jump to another session
 * without leaving the page first. Picking a session selects it, which ends reading mode. It sits outside the `inert`
 * sidebar and view of the window, which stay under reading mode.
 */
export function ReadSidebar({ onClose }: { onClose(): void }) {
  const width = useSidebar((s) => s.width);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="absolute inset-0 z-10" data-read-sidebar-layer>
      <Scrim onClose={onClose} data-read-scrim />
      <div ref={panel} tabIndex={-1} className="no-drag absolute inset-y-0 left-0 max-w-[90%] shadow-overlay outline-none" style={{ width }} data-read-sidebar>
        <Sidebar />
      </div>
    </div>
  );
}
