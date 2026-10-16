import { RefreshCw } from 'lucide-react';
import { Button } from './ui.tsx';

/**
 * Under the header when the site has a newer remote app: Reload loads it (on the screen you're on), Later hides the
 * bar for an hour. The side channel's blue, as news worth reading that needs nothing from you.
 */
export function UpdateBar({ onReload, onLater }: { onReload: () => void; onLater: () => void }) {
  return (
    <div role="status" className="flex items-center gap-2 border-b border-link/25 bg-link/8 py-1.5 pr-2 pl-4" data-remote-update>
      <RefreshCw className="size-4 shrink-0 text-link" aria-hidden />
      <p className="min-w-0 flex-1 text-ui text-text">A new version is ready.</p>
      <Button variant="quiet" size="md" onClick={onLater} data-remote-update-later>
        Later
      </Button>
      <Button variant="primary" size="md" onClick={onReload} data-remote-update-reload>
        Reload
      </Button>
    </div>
  );
}
