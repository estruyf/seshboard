import { useState } from 'react';
import { KeyRound, LogIn, RefreshCw } from 'lucide-react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { useSignIn } from '../../state/signInStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';

/**
 * Above the message box of a session whose turn failed because Claude Code's login stopped working (signed out,
 * expired). Sign in runs `claude auth login` in the session's terminal panel; once it succeeds, the session continues
 * by itself. Continue is for a login done some other way (in your own terminal).
 */
export function SignInNotice({ sessionId, profileId, busy }: { sessionId: string; profileId: string; busy: boolean }) {
  const signedOut = useSignIn((s) => s.state.profiles.find((p) => p.profileId === profileId && p.sessionIds.includes(sessionId)) ?? null);
  const profile = useProfile(profileId);
  const multiple = useMultipleProfiles();
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [pending, setPending] = useState<'start' | 'continue' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!signedOut || busy) return null;

  const run = async (kind: 'start' | 'continue', work: () => Promise<unknown>) => {
    if (!client || pending) return;
    setError(null);
    setPending(kind);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  const signIn = () =>
    run('start', async () => {
      const terminals = useTerminals.getState();
      terminals.setNotice(sessionId, null);
      terminals.togglePanel(sessionId, true);
      const info = await client!.call('signIn.start', { sessionId });
      useTerminals.getState().setActive(sessionId, info.id);
    });
  const signingIn = signedOut.terminalId !== null;
  const who = multiple && profile ? ` (${profile.name})` : '';

  return (
    <Notice
      tone="warn"
      icon={<KeyRound size={14} aria-hidden />}
      data-sign-in-notice
      data-sign-in-notice-signing-in={signingIn || undefined}
      actions={
        <span className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="primary"
            size="sm"
            icon={<LogIn size={11} aria-hidden />}
            disabled={pending !== null}
            aria-busy={pending === 'start'}
            onClick={() => void signIn()}
            data-sign-in-notice-start
          >
            {pending === 'start' ? 'Opening…' : signingIn ? 'Show sign in' : 'Sign in'}
          </Button>
          <Button
            size="sm"
            icon={<RefreshCw size={11} className={pending === 'continue' ? 'animate-spin' : ''} aria-hidden />}
            disabled={pending !== null}
            aria-busy={pending === 'continue'}
            onClick={() => void run('continue', () => client!.call('signIn.continue', { sessionId }))}
            data-tooltip="Signed in some other way? Continue the session."
            data-sign-in-notice-continue
          >
            {pending === 'continue' ? 'Continuing…' : 'Continue'}
          </Button>
        </span>
      }
    >
      <span className="grid gap-0.5">
        <span className="font-medium">Claude Code is signed out{who}</span>
        <span className="text-meta text-muted">
          {signingIn ? 'Finish signing in in the terminal. The session continues by itself once you are signed in.' : 'Your login expired or was removed. Sign in again to continue where you left off.'}
          {signedOut.message && <span className="block font-mono">{signedOut.message}</span>}
          {error && <span className="block text-error">{error}</span>}
        </span>
      </span>
    </Notice>
  );
}
