import { PencilLine } from 'lucide-react';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';

/**
 * The quiet line above a message box that opened with a kept draft: what it is, and Discard. It goes away
 * once the draft is edited or sent (the view stops rendering it).
 */
export function DraftBanner({ text, onDiscard, className = '' }: { text: string; onDiscard(): void; className?: string }) {
  return (
    <Notice
      inline
      icon={<PencilLine size={12} className="text-faint" aria-hidden />}
      actions={
        <Button variant="danger" size="sm" onClick={onDiscard} className="-my-1 ml-auto shrink-0" data-draft-discard>
          Discard
        </Button>
      }
      className={`w-full px-1 text-meta text-muted ${className}`}
      data-draft-banner
    >
      {text}
    </Notice>
  );
}
