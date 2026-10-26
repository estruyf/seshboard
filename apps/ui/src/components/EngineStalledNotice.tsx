import { Loader2 } from 'lucide-react';
import { useEngineStalled } from '../engine/useEngine.ts';
import { Notice } from './ui/Notice.tsx';

/**
 * Says so, at the top of the window, while the engine is connected but doesn't answer (it hangs rather than
 * crashing, so nothing reconnects). It goes away by itself on the engine's next answer.
 */
export function EngineStalledNotice() {
  const stalled = useEngineStalled();
  if (!stalled) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center px-4" data-engine-stalled>
      {/* The notice's tint is see-through; the overlay surface under it keeps the view behind from showing. */}
      <div className="max-w-md rounded-lg overlay">
        <Notice tone="caution" icon={<Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />}>
          Seshboard's engine isn't answering. Waiting for it…
        </Notice>
      </div>
    </div>
  );
}
