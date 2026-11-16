import { Globe, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BROWSER_PROFILE_NAME_MAX, DEFAULT_BROWSER_PROFILE_NAME, PROFILE_COLORS, type BrowserProfile, type ProfileColor } from '@seshboard/protocol/client';
import { askDeleteProfile, askResetProfile, createBrowserProfile, updateBrowserProfile, useBrowserProfiles } from '../../state/browserProfilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ColorPicker, field } from '../profiles/ProfilesSettings.tsx';
import { Button } from '../ui/Button.tsx';
import { Select, type SelectOption } from '../ui/Select.tsx';

/*
 * Settings › Browser › Browser profiles (docs/browser.md): the built-in Default profile, then yours, each with its
 * name, colour and where it is offered (a project or everywhere), Reset… and Delete…. Not Claude profiles
 * (Settings › Profiles).
 */

/** The scope picker's value for everywhere: a project's value is its root, which is never this. */
const EVERYWHERE = '*';

/** Where a profile can be offered: everywhere, or one of your added projects (and the one it has, if no longer added). */
function useScopeOptions(current: string | null): Array<SelectOption<string>> {
  const projects = useProjects((s) => s.projects);
  return useMemo(() => {
    const added = [...projects.values()].filter((p) => p.added || p.root === current).sort((a, b) => a.name.localeCompare(b.name));
    return [{ value: EVERYWHERE, label: 'Everywhere' }, ...added.map((p) => ({ value: p.root, label: p.name }))];
  }, [projects, current]);
}

function ScopeSelect({ value, onChange, label }: { value: string | null; onChange(projectRoot: string | null): void; label: string }) {
  const options = useScopeOptions(value);
  return (
    <Select<string>
      label={label}
      value={value ?? EVERYWHERE}
      options={options}
      onChange={(next) => onChange(next === EVERYWHERE ? null : next)}
      menuWidth={200}
      className="h-7 max-w-48 shrink-0 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60"
      dataAttrs={{ 'data-browser-profile-scope': true }}
    />
  );
}

/** The browser profiles in Settings › Browser: Default first, then yours, then New profile. */
export function BrowserProfilesSettings() {
  const profiles = useBrowserProfiles((s) => s.profiles);
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-browser-profiles>
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <li className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5" data-browser-profile="default">
          <Globe size={14} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-ui font-medium text-text">{DEFAULT_BROWSER_PROFILE_NAME}</span>
            <span className="block text-meta text-muted">Every tab uses it unless you pick another profile.</span>
          </span>
          <Button size="sm" icon={<RotateCcw size={12} aria-hidden />} onClick={() => askResetProfile(null)} data-browser-profile-reset="default">
            Reset…
          </Button>
        </li>
        {profiles.map((profile) => (
          <ProfileRow key={profile.id} profile={profile} />
        ))}
      </ul>
      {adding ? (
        <NewProfileForm onDone={() => setAdding(false)} />
      ) : (
        <Button className="w-fit" icon={<Plus size={13} aria-hidden />} onClick={() => setAdding(true)} data-new-browser-profile>
          New profile
        </Button>
      )}
    </div>
  );
}

/** One of your browser profiles: its name (saved as you leave the field), colour and place, Reset… and Delete…. */
function ProfileRow({ profile }: { profile: BrowserProfile }) {
  const [name, setName] = useState(profile.name);
  // A rename saved here (or in another window) comes back as a new name.
  useEffect(() => setName(profile.name), [profile.name]);
  const [error, setError] = useState<string | null>(null);
  const save = async (change: { name?: string; color?: ProfileColor; projectRoot?: string | null }) => {
    const failed = await updateBrowserProfile(profile.id, change);
    setError(failed);
    // A name that clashes: the field shows the name it still has, under the reason.
    if (failed && change.name !== undefined) setName(profile.name);
  };
  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) return setName(profile.name);
    if (trimmed !== profile.name) void save({ name: trimmed });
  };
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-border bg-card px-3 py-2.5" data-browser-profile={profile.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          className={`${field} w-40 font-medium`}
          value={name}
          maxLength={BROWSER_PROFILE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={`Name of the ${profile.name} browser profile`}
          data-browser-profile-name
        />
        <ColorPicker value={profile.color} onChange={(color) => void save({ color })} />
        <span className="flex-1" />
        <ScopeSelect label={`Where ${profile.name} is offered`} value={profile.projectRoot} onChange={(projectRoot) => void save({ projectRoot })} />
        <Button size="sm" icon={<RotateCcw size={12} aria-hidden />} onClick={() => askResetProfile(profile.id)} data-browser-profile-reset={profile.id}>
          Reset…
        </Button>
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={<X size={14} aria-hidden />}
          onClick={() => askDeleteProfile(profile.id)}
          data-tooltip="Delete profile"
          aria-label={`Delete the ${profile.name} browser profile`}
          className="hover:text-error!"
          data-browser-profile-delete={profile.id}
        />
      </div>
      {error && (
        <p role="alert" className="text-ui text-error">
          {error}
        </p>
      )}
    </li>
  );
}

/** New profile: a name, a colour (the next one not taken) and where it is offered. */
function NewProfileForm({ onDone }: { onDone(): void }) {
  const profiles = useBrowserProfiles((s) => s.profiles);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ProfileColor>(() => PROFILE_COLORS.find((c) => !profiles.some((p) => p.color === c)) ?? 'blue');
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy) return;
    if (!name.trim()) return setError('Give the profile a name.');
    setBusy(true);
    const result = await createBrowserProfile({ name, color, projectRoot });
    setBusy(false);
    if ('error' in result) return setError(result.error);
    onDone();
  };
  return (
    <form
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 rounded-lg border border-dashed border-border px-3 py-3"
      aria-label="New browser profile"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onDone();
      }}
      data-new-browser-profile-form
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          className={`${field} w-40`}
          value={name}
          maxLength={BROWSER_PROFILE_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Name, such as Admin"
          aria-label="Name"
          autoFocus
          data-new-browser-profile-name
        />
        <ColorPicker value={color} onChange={setColor} />
        <span className="flex-1" />
        <ScopeSelect label="Where it is offered" value={projectRoot} onChange={setProjectRoot} />
      </div>
      <p className="text-ui text-muted">A profile keeps its own logins, site data, cache and history. A project's profile is offered only in its sessions.</p>
      {error && (
        <p role="alert" className="text-ui text-error">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined} data-new-browser-profile-create>
          {busy ? 'Creating…' : 'Create profile'}
        </Button>
      </div>
    </form>
  );
}
