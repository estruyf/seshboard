import { Star, X } from 'lucide-react';
import { useEffect, type KeyboardEvent, type MouseEvent } from 'react';
import { create } from 'zustand';
import { REPO_URL } from '@switchboard/protocol/bridge';
import type { GithubStarStatus } from '@switchboard/protocol/client';
import type { EngineClient } from '../../engine/connection.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { STAR_AFTER_SESSIONS, starPrompt, type StarPrompt } from './starPrompt.ts';

interface StarState {
  /** Null until gh has answered (asked once per window, and only once the button may show). */
  status: GithubStarStatus | null;
  starring: boolean;
}

const useStar = create<StarState>()(() => ({ status: null, starring: false }));
let asked = false;

const done = () => usePreferences.getState().update({ githubStar: 'done' });
const openPage = () => void window.open(REPO_URL, '_blank');

/** Asks gh once whether Switchboard is starred; starred elsewhere means the button never needs to ask again. */
function askStatus(client: EngineClient): void {
  if (asked) return;
  asked = true;
  client.call('github.starStatus', {}).then(
    ({ status }) => {
      useStar.setState({ status });
      if (status === 'starred') done();
    },
    () => useStar.setState({ status: 'unavailable' }),
  );
}

/** Stars through gh; when that fails, the repository's page opens so you can star it there. Either way it's done. */
async function star(client: EngineClient | null, prompt: StarPrompt): Promise<void> {
  if (prompt !== 'star' || !client) {
    openPage();
    done();
    return;
  }
  useStar.setState({ starring: true });
  try {
    await client.call('github.star', {});
    toast('Starred Switchboard on GitHub. Thank you!', { tone: 'ok' });
  } catch {
    openPage();
  } finally {
    useStar.setState({ starring: false });
    done();
  }
}

/** Whether Star on GitHub shows, with `sessions` the number in the sidebar, and what clicking it does. */
function useStarPrompt(sessions: number) {
  const pref = usePreferences((s) => s.prefs.githubStar);
  const { status, starring } = useStar();
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const wanted = pref === 'ask' && sessions >= STAR_AFTER_SESSIONS;
  useEffect(() => {
    if (wanted && client) askStatus(client);
  }, [wanted, client]);
  const prompt = starPrompt(pref, sessions, status);
  return {
    prompt,
    starring,
    onStar: () => void star(client, prompt),
    // gh stars it with your sign-in, without asking: the tooltip says so.
    tooltip: prompt === 'star' ? 'Stars Switchboard with your GitHub CLI sign-in' : 'Opens Switchboard on GitHub',
  };
}

/** The open sidebar's Star on GitHub: one quiet line above the footer, with × to stop showing it. */
export function StarOnGithub({ sessions }: { sessions: number }) {
  const { prompt, starring, onStar, tooltip } = useStarPrompt(sessions);
  if (prompt === 'hidden') return null;
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-t border-border px-2" data-star-prompt={prompt}>
      <Button
        variant="quiet"
        size="sm"
        icon={<Star size={13} className="shrink-0 text-accent-ink" fill="currentColor" aria-hidden />}
        disabled={starring}
        aria-busy={starring}
        data-tooltip={tooltip}
        data-star-button
        onClick={onStar}
        className="min-w-0 flex-1 justify-start"
      >
        <span className="truncate">{starring ? 'Starring…' : 'Star on GitHub'}</span>
      </Button>
      <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Don't show again" data-star-dismiss onClick={done} />
    </div>
  );
}

/** The rail's Star on GitHub: the star alone; its context menu has Don't show again. */
export function RailStarButton({ sessions, onMenu }: { sessions: number; onMenu(at: { x: number; y: number }, dismiss: () => void): void }) {
  const { prompt, starring, onStar, tooltip } = useStarPrompt(sessions);
  if (prompt === 'hidden') return null;
  const at = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.right - 4, y: rect.top + 8 };
  };
  return (
    <Button
      variant="quiet"
      iconOnly
      icon={<Star size={15} className="text-accent-ink" fill="currentColor" aria-hidden />}
      aria-label="Star on GitHub"
      disabled={starring}
      aria-busy={starring}
      data-tooltip={['Star on GitHub', tooltip, 'Right-click to hide it'].join('\n')}
      data-tooltip-placement="right"
      data-tooltip-title="Star on GitHub"
      data-tooltip-meta={tooltip}
      data-tooltip-hint="Right-click to hide it"
      data-star-prompt={prompt}
      data-star-button
      onClick={onStar}
      onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        onMenu(e.clientX === 0 && e.clientY === 0 ? at(e.currentTarget) : { x: e.clientX, y: e.clientY }, done);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        if (!isContextMenuKey(e)) return;
        e.preventDefault();
        onMenu(at(e.currentTarget), done);
      }}
    />
  );
}
