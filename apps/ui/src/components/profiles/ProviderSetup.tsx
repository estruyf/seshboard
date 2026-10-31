import { ArrowRight, FolderGit2, Loader2, Play, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PROVIDER_NAMES, PROVIDER_SHORT_NAMES, type ClaudeProfile, type OptionalProvider, type ProviderDetection } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { thisComputerName } from '../../lib/platform.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ChoiceMenu } from '../newSession/ChoiceMenu.tsx';
import { PROVIDER_ICONS } from '../providers/ProviderMark.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Button } from '../ui/Button.tsx';
import { needsOtherApps, offerText, readySessionsLine } from './providerOffer.ts';

/**
 * A provider's CLI found on this computer with no profile of it yet (Settings › Profiles, under the list): Add opens
 * Add profile with the provider picked, Not now puts the offer away for good.
 */
export function ProviderOffer({ detection, onAdd }: { detection: ProviderDetection; onAdd(): void }) {
  const Icon = PROVIDER_ICONS[detection.id];
  const name = PROVIDER_NAMES[detection.id];
  const dismiss = () => {
    const { prefs, update } = usePreferences.getState();
    update({ providerOffersDismissed: [...new Set([...prefs.providerOffersDismissed, detection.id])] });
  };
  return (
    <section className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border px-3 py-2.5" aria-label={`${name} CLI found`} data-provider-offer={detection.id}>
      <Icon size={20} aria-hidden className="shrink-0 text-text" />
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-text">
          {name} CLI is on {thisComputerName().replace(/^This/, 'this')}
        </p>
        <p className="text-ui text-muted">{offerText(detection.sessions)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button onClick={dismiss} data-provider-offer-dismiss>
          Not now
        </Button>
        <Button variant="primary" onClick={onAdd} data-provider-offer-add>
          Add {PROVIDER_SHORT_NAMES[detection.id]} profile
        </Button>
      </div>
    </section>
  );
}

/**
 * Add profile's last screen for a provider profile: who it is signed in as (waiting while its sign in runs in the
 * terminal), what now shows in the sidebar, and three ways to start using it.
 */
export function ProviderReady({ profile, sessions, onDone }: { profile: ClaudeProfile; sessions: number | null; onDone(): void }) {
  const provider = profile.provider as OptionalProvider;
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const Icon = PROVIDER_ICONS[provider];
  const short = PROVIDER_SHORT_NAMES[provider];
  const name = PROVIDER_NAMES[provider];
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const projectMap = useProjects((s) => s.projects);
  const projects = useMemo(() => addedProjects(projectMap).filter((p) => p.exists), [projectMap]);
  const reloadProjects = useProjects((s) => s.reload);
  const [login, setLogin] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [confirmDefault, setConfirmDefault] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Asked until it says signed in: a sign in running in the terminal lands here when it is done.
  useEffect(() => {
    if (!client) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () =>
      void client.call('providers.status', { profileId: profile.id }).then(
        (status) => {
          if (!current) return;
          setSignedIn(status.signedIn);
          setLogin(status.login ?? status.account);
          if (!status.signedIn) timer = setTimeout(ask, 3000);
        },
        () => current && (timer = setTimeout(ask, 3000)),
      );
    ask();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, profile.id]);

  const startSession = () => {
    useSessions.getState().openNewSession();
    useProjects.getState().startWith(profile.id);
  };
  const useForProject = async (root: string) => {
    try {
      await client?.call('projects.setProfile', { root, profileId: profile.id });
      reloadProjects();
      setDone(`${projects.find((p) => p.root === root)?.name ?? root} now starts on ${short}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const row = 'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-ui text-text hover:bg-border/45 disabled:opacity-50';

  return (
    <div className="grid min-w-0 gap-3 rounded-lg border border-border bg-card px-3 py-3" data-profile-ready={profile.id}>
      <div className="flex min-w-0 items-start gap-3">
        <Icon size={28} aria-hidden className="mt-0.5 shrink-0 text-text" />
        <div className="min-w-0 flex-1" role="status" aria-live="polite">
          {signedIn === false ? (
            <>
              <h3 className="text-title font-semibold text-text">Finish signing in</h3>
              <p className="text-ui text-muted">Sign in to {name} CLI in the terminal. This updates when it's done.</p>
            </>
          ) : (
            <>
              <h3 className="text-title font-semibold text-text">{short} is ready</h3>
              <p className="text-ui text-muted" data-profile-ready-account>
                {signedIn === null ? `Asking ${name}…` : login ? `Signed in as ${login}` : 'Signed in'}
              </p>
            </>
          )}
        </div>
        {signedIn === null && <Loader2 size={14} aria-hidden className="mt-1 shrink-0 animate-spin text-muted" />}
      </div>
      <p className="text-ui text-muted">
        {readySessionsLine(sessions, short)}
        {needsOtherApps(sessions, scope) && (
          <>
            {' '}
            <button type="button" className="text-link hover:underline" onClick={() => usePreferences.getState().update({ sessionScope: 'all' })} data-profile-ready-other-apps>
              Turn on Show sessions from other apps
            </button>{' '}
            to see them.
          </>
        )}
      </p>
      <ul className="grid min-w-0 gap-0.5 border-y border-border py-1.5" aria-label={`Start using ${short}`}>
        <li>
          <button type="button" className={row} onClick={startSession} data-profile-ready-start>
            <Play size={14} aria-hidden className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">Start a {short} session</span>
            <ArrowRight size={13} aria-hidden className="shrink-0 text-faint" />
          </button>
        </li>
        <li>
          <ChoiceMenu
            name="ready-project"
            value=""
            onChange={(root) => void useForProject(root)}
            heading="Use for a project"
            search={projects.length > 8 ? 'Search projects' : undefined}
            width={300}
            label={`Use ${short} for a project`}
            disabled={projects.length === 0}
            choices={projects.map((p) => ({ value: p.root, label: p.name, description: p.profileId === profile.id ? `Already on ${short}` : undefined, disabled: p.profileId === profile.id }))}
          >
            <span className="flex w-full min-w-0 items-center gap-2.5 py-1 text-text" data-profile-ready-project>
              <FolderGit2 size={14} aria-hidden className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 text-left">Use {short} for a project…</span>
            </span>
          </ChoiceMenu>
        </li>
        <li>
          <button type="button" className={row} disabled={profile.isDefault} onClick={() => setConfirmDefault(true)} data-profile-ready-default>
            <Star size={14} aria-hidden className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">{profile.isDefault ? `${short} is the default` : 'Make it the default'}</span>
          </button>
        </li>
      </ul>
      {done && (
        <p role="status" className="text-ui text-accent-ink" data-profile-ready-done-note>
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="text-ui text-error">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onDone} data-profile-ready-done>
          Done
        </Button>
      </div>
      {confirmDefault && (
        <ConfirmDialog
          title={`Make ${profile.name} the default?`}
          confirmLabel="Make default"
          body={<>New sessions in projects without their own profile start on {name}.</>}
          onConfirm={async () => {
            await client?.call('profiles.setDefault', { id: profile.id });
            setDone(`${profile.name} is the default.`);
          }}
          onClose={() => setConfirmDefault(false)}
        />
      )}
    </div>
  );
}
