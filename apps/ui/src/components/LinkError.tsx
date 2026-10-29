import { Link2Off } from 'lucide-react';
import { useEffect } from 'react';
import { useLinks } from '../state/linksStore.ts';
import { Notice } from './ui/Notice.tsx';

/** Why a `seshboard://` link did nothing. Nothing else changed; it goes away on its own. */
export function LinkError() {
  const error = useLinks((s) => s.error);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => useLinks.getState().dismiss(), 8_000);
    return () => clearTimeout(timer);
  }, [error]);
  if (!error) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      {/* An opaque card under the tinted notice: it floats over the app. */}
      <div className="pointer-events-auto max-w-lg rounded-lg bg-card shadow-lg">
        <Notice tone="error" icon={<Link2Off size={14} aria-hidden />} onDismiss={() => useLinks.getState().dismiss()} data-link-error>
          <p className="font-medium text-text">Couldn't open that link</p>
          <p className="text-muted">{error.message}</p>
        </Notice>
      </div>
    </div>
  );
}
