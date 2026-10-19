import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CHANGELOG_URL, releaseUrl, type UpdateChannel } from '@switchboard/protocol/bridge';
import appIcon from '../../assets/app-icon.png';
import { lastChecked, updateStatusText, versionLabel } from '../../lib/updates.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useUpdates } from '../../state/updatesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { Toggle } from '../ui/Toggle.tsx';
import { useInstallUpdate } from './useInstallUpdate.tsx';
import { ClaudeCodeUpdates } from './ClaudeCodeUpdates.tsx';

const CHANNELS: Array<{ value: UpdateChannel; label: string; detail: string }> = [
  { value: 'stable', label: 'Stable', detail: 'Published releases.' },
  { value: 'beta', label: 'Beta', detail: 'Beta versions to test what comes next, and the published releases. Newer, with rougher edges.' },
];

const link = 'inline-flex items-center gap-1 text-ui text-link hover:underline';

/** Re-renders every half minute, so "Last checked" stays true. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Settings → About: the build you're running, and the updater's controls. */
export function AboutSettings() {
  const info = window.switchboard?.appInfo ?? null;
  const state = useUpdates((s) => s.state);
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const { install, dialog } = useInstallUpdate();
  const now = useNow();

  const off = !state || state.status === 'disabled';
  const busy = state?.status === 'checking' || state?.status === 'downloading' || state?.status === 'installing';
  const notesVersion = state?.downloadedVersion ?? state?.availableVersion;

  return (
    <div className="grid gap-6" data-about>
      <div className="flex items-center gap-4">
        <img src={appIcon} alt="" width={48} height={48} draggable={false} />
        <div className="grid gap-0.5">
          <h3 className="text-[14px] font-semibold">Switchboard</h3>
          {info && (
            <p className="text-[12.5px] text-muted">
              <span data-app-version={info.version} data-app-dev={info.dev}>
                {info.dev ? `Development build of ${info.version}` : `Version ${info.version}`}
              </span>
              {info.commit && (
                <>
                  {' · '}
                  <span className="font-mono text-[11.5px]" data-app-commit={info.commit}>
                    {info.commit}
                  </span>
                </>
              )}
            </p>
          )}
          <p className="flex gap-3">
            {info && !info.dev && (
              <a href={releaseUrl(info.version)} target="_blank" rel="noreferrer" className={link}>
                Release notes <ExternalLink size={11} aria-hidden />
              </a>
            )}
            <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" className={link} data-changelog-link>
              Changelog <ExternalLink size={11} aria-hidden />
            </a>
          </p>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border pt-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[12.5px] font-medium">Updates</h3>
            {/* A live region: a check started here reports its result without moving focus. */}
            <p role="status" className={`mt-0.5 text-ui ${state?.status === 'error' ? 'text-error' : 'text-muted'}`} data-update-status={state?.status ?? 'unavailable'}>
              {state ? updateStatusText(state) : 'Updates are only available in the app.'}
            </p>
            {state && state.status !== 'disabled' && <p className="mt-0.5 text-[11.5px] text-muted">{lastChecked(state.checkedAt, now)}</p>}
            {state?.status === 'downloading' && (
              <div role="progressbar" aria-label="Downloading the update" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.downloadPercent ?? 0)} className="mt-2 h-1 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${state.downloadPercent ?? 0}%` }} />
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {state?.status === 'available' && (
              <Button onClick={() => window.switchboard?.update('download')} data-update-download>
                Download
              </Button>
            )}
            {(state?.status === 'downloaded' || (state?.status === 'error' && state.downloadedVersion)) && (
              <Button variant="primary" onClick={install} data-update-install>
                Restart to update
              </Button>
            )}
            {state?.status === 'error' && state.canRetry && !state.downloadedVersion && (
              <Button onClick={() => window.switchboard?.update('retry')} data-update-retry>
                Retry
              </Button>
            )}
            <Button disabled={off || busy} onClick={() => window.switchboard?.update('check')} data-check-updates>
              Check for Updates
            </Button>
          </div>
        </div>

        {notesVersion && state?.releaseNotes && (
          <div className="rounded-md border border-border bg-card px-3 py-2.5" data-about-release-notes>
            <p className="text-ui font-semibold">What’s new in v{notesVersion}</p>
            <p className="mt-1 max-h-60 overflow-y-auto text-ui leading-relaxed whitespace-pre-wrap text-muted">{state.releaseNotes}</p>
          </div>
        )}

        <Toggle
          label="Check for updates automatically"
          detail="Shortly after Switchboard opens, then every few hours. Nothing downloads until you choose to."
          checked={prefs.autoUpdate}
          attr="data-auto-update"
          onChange={(autoUpdate) => update({ autoUpdate })}
        />

        <div className="grid gap-2">
          <p className="text-[12.5px]" aria-hidden>
            Channel
          </p>
          <RadioGroup label="Update channel" className="grid gap-2.5">
            {CHANNELS.map(({ value, label, detail }) => (
              <Radio
                key={value}
                checked={prefs.updateChannel === value}
                onSelect={() => {
                  // The preference saves through main, which also checks the new channel right away.
                  usePreferences.getState().replace({ ...prefs, updateChannel: value });
                  window.switchboard?.setUpdateChannel(value);
                }}
                dataAttrs={{ 'data-update-channel': value }}
              >
                <span className="block text-[12.5px] text-text">{label}</span>
                <span className="block text-ui text-muted">{detail}</span>
              </Radio>
            ))}
          </RadioGroup>
        </div>
      </div>

      <ClaudeCodeUpdates now={now} />
      {dialog}
    </div>
  );
}

/** The version, quietly at the bottom of Settings' sidebar; it links to its release notes. */
export function SettingsVersion() {
  const info = window.switchboard?.appInfo;
  if (!info) return null;
  const label = versionLabel(info);
  const className = 'mx-2.5 mt-auto truncate pt-2 text-meta text-faint';
  return info.dev ? (
    <p className={className} data-tooltip="A development build, not a release" data-settings-version>
      {label}
    </p>
  ) : (
    <a href={releaseUrl(info.version)} target="_blank" rel="noreferrer" className={`${className} hover:text-muted hover:underline`} data-tooltip="Release notes" data-settings-version>
      {label}
    </a>
  );
}
