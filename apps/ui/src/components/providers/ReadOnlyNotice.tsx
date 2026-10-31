import { Check, Copy, Eye } from 'lucide-react';
import { PROVIDER_NAMES, type OptionalProvider } from '@seshboard/protocol/client';
import { resumeCommandFor, useProvider } from '../../state/providersStore.ts';
import { useFlash } from '../ui/useFlash.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';

/**
 * Where the message box would be, in another provider's session: Seshboard only shows it. Says how to continue it in
 * that provider's CLI, with the command to copy (the provider's own, from the engine's registry).
 */
export function ReadOnlyNotice({ provider, sessionId }: { provider: OptionalProvider; sessionId: string }) {
  const [copied, flash] = useFlash(1_500);
  const info = useProvider(provider);
  const command = info ? resumeCommandFor(info, sessionId) : null;
  return (
    <Notice
      role="note"
      icon={<Eye size={14} aria-hidden />}
      data-read-only-session={provider}
      actions={
        command && (
          <Button
            variant="secondary"
            size="sm"
            icon={copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={12} aria-hidden />}
            onClick={() => void navigator.clipboard.writeText(command).then(() => flash('Copied'), () => {})}
            data-copy-resume-command
          >
            {copied ? 'Copied' : 'Copy command'}
          </Button>
        )
      }
    >
      A {PROVIDER_NAMES[provider]} session, shown read-only.{' '}
      {command ? (
        <>
          To continue it, run <code className="font-mono text-meta text-text">{command}</code> in a terminal.
        </>
      ) : (
        `Continue it in ${PROVIDER_NAMES[provider]}.`
      )}
    </Notice>
  );
}
