import { Check, ChevronRight, Copy, FolderOpen, LogIn, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { expandHome, isAbsolutePath, PROFILE_COLORS, separatorOf, type ClaudeProfile, type ProfileColor, type ProjectDefaults } from '@switchboard/protocol/client';
import type { EngineClient } from '../../engine/connection.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tildify } from '../../lib/format.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { openTerminal } from '../../state/terminalsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { describeDefaults, ProjectDefaultsEditor } from '../projects/ProjectDefaultsEditor.tsx';
import { APP_TERMINAL } from '../terminal/appTerminal.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { PROFILE_DOT } from './ProfileBadge.tsx';

const field = 'h-7 min-w-0 rounded-md border border-border bg-bg px-2 text-ui text-text outline-none focus:border-accent-ink/60';

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'work';

/** Shell-quotes a path for the sign-in command (paths with spaces are common on macOS). */
const quote = (path: string) => (/^[\w./~-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

/** The command that signs Claude Code in for one config folder. Switchboard never handles credentials itself. */
export const loginCommand = (profile: Pick<ClaudeProfile, 'configDir' | 'builtin'>) => (profile.builtin ? 'claude' : `CLAUDE_CONFIG_DIR=${quote(profile.configDir)} claude`);

/**
 * Starts Claude Code with a profile's folder in the window's own terminal, which docks next to Settings, so you sign
 * in there. The engine sets the folder, so nothing is typed or quoted for the shell.
 */
const signInHere = (client: EngineClient, profileId: string) => openTerminal(client, APP_TERMINAL, null, 'claude', false, profileId);

const COLOR_NAME: Record<ProfileColor, string> = {
  yellow: 'Yellow',
  blue: 'Blue',
  green: 'Green',
  purple: 'Purple',
  red: 'Red',
  orange: 'Orange',
  gray: 'Grey',
};

/** The profile's colour as a radio group: arrow keys move between swatches, and each one says its colour name. */
function ColorPicker({ value, onChange }: { value: ProfileColor; onChange(color: ProfileColor): void }) {
  return (
    <RadioGroup label="Colour" className="flex items-center gap-1">
      {PROFILE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={COLOR_NAME[color]}
          data-tooltip={COLOR_NAME[color]}
          tabIndex={value === color ? 0 : -1}
          onClick={() => onChange(color)}
          className={`flex size-5 items-center justify-center rounded-full ${value === color ? 'ring-2 ring-accent-ink/70 ring-offset-1 ring-offset-card' : ''}`}
        >
          <span aria-hidden className={`size-3.5 rounded-full ${PROFILE_DOT[color]}`} />
        </button>
      ))}
    </RadioGroup>
  );
}

/**
 * A command to run in Terminal, with a copy button. Long config paths wrap anywhere rather than
 * widening the page; `block` puts it on its own line.
 */
function CopyCommand({ command, block = false }: { command: string; block?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={`${block ? 'flex w-full' : 'inline-flex max-w-full align-middle'} items-start gap-1.5 rounded-md bg-sidebar px-1.5 py-0.5`}>
      <code className="min-w-0 font-mono text-[11.5px] break-all text-text">{command}</code>
      <button
        type="button"
        data-tooltip={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy command'}
        onClick={() => void navigator.clipboard.writeText(command).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="mt-px shrink-0 text-muted hover:text-text"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

/**
 * What new sessions with this profile start with, where their project sets nothing. Folded away under a
 * one-line summary, since most people set them once.
 */
function ProfileDefaultsSection({ profile, onError }: { profile: ClaudeProfile; onError(message: string): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [open, setOpen] = useState(false);
  // The editor works on a project's shape; a profile has no branch. Kept stable so quick changes build on each other.
  const defaults = useMemo<ProjectDefaults>(() => ({ ...profile.defaults, branch: null }), [profile.defaults]);
  const save = ({ branch: _branch, ...next }: ProjectDefaults) => void client?.call('profiles.setDefaults', { id: profile.id, defaults: next }).catch((e: Error) => onError(e.message));
  return (
    <div className="grid min-w-0 gap-2.5 border-t border-border pt-2" data-profile-defaults={profile.id}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 text-left text-ui text-muted hover:text-text"
        data-profile-defaults-toggle
      >
        <ChevronRight size={13} aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="shrink-0">New session defaults</span>
        <span className="min-w-0 truncate text-faint" data-profile-defaults-summary>
          · {describeDefaults(profile.defaults)}
        </span>
      </button>
      {open && (
        <div className="grid min-w-0 gap-2.5 pl-5">
          <p className="text-ui text-muted">New sessions with {profile.name} start with these, unless their project sets its own. The New session view can still change them for one session.</p>
          <ProjectDefaultsEditor root={null} defaults={defaults} isGitRepo profile={null} onSave={save} />
        </div>
      )}
    </div>
  );
}

function ProfileRow({ profile, home, onRemove }: { profile: ClaudeProfile; home: string | null; onRemove(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [name, setName] = useState(profile.name);
  // A rename saved here (or in another window) comes back as a new name; the row stays mounted, so focus stays where Tab put it.
  useEffect(() => setName(profile.name), [profile.name]);
  const [error, setError] = useState<string | null>(null);
  const call = (promise: Promise<unknown> | undefined) => promise?.catch((e: Error) => setError(e.message));
  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) return setName(profile.name);
    if (trimmed !== profile.name) void call(client?.call('profiles.update', { id: profile.id, name: trimmed }));
  };

  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-border bg-card px-3 py-2.5" data-profile={profile.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          className={`${field} w-40 font-medium`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label={`Name of the ${profile.name} profile`}
          data-profile-name
        />
        <ColorPicker value={profile.color} onChange={(color) => void call(client?.call('profiles.update', { id: profile.id, color }))} />
        <span className="flex-1" />
        <span data-tooltip="Projects without a profile of their own use the default">
          <Radio
            checked={profile.isDefault}
            tabbable
            label={`Use ${profile.name} by default`}
            onSelect={() => void call(client?.call('profiles.setDefault', { id: profile.id }))}
            className="items-center text-ui text-muted"
            dataAttrs={{ 'data-profile-default': profile.id }}
          >
            Default
          </Radio>
        </span>
        {!profile.builtin && (
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<X size={14} />}
            onClick={onRemove}
            data-tooltip="Remove from Switchboard (the folder and its login stay on disk)"
            aria-label={`Remove the ${profile.name} profile from Switchboard`}
            // Removing is the one thing this button does, so it warns on hover.
            className="hover:text-error!"
            data-remove-profile
          />
        )}
      </div>
      <p className="truncate text-ui text-muted" data-tooltip={profile.configDir}>
        {tildify(profile.configDir, home)}
        {profile.builtin && <span> · Claude Code’s own folder</span>}
        {!profile.exists && <span className="text-warn"> · folder not found</span>}
      </p>
      {profile.account ? (
        <p className="text-ui text-muted">
          Signed in as <span className="text-text">{profile.account.email ?? 'a claude.ai account'}</span>
          {profile.account.organization && <> · {profile.account.organization}</>}
        </p>
      ) : (
        <div className="grid gap-1.5 text-ui text-muted">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="min-w-0 flex-1">
              Not signed in yet. Sign in opens Claude Code with this profile in Switchboard’s terminal. Follow its steps, or type <code className="font-mono">/login</code>.
            </p>
            <Button
              variant="primary"
              icon={<LogIn size={13} aria-hidden />}
              className="shrink-0"
              disabled={!client}
              onClick={() => client && void signInHere(client, profile.id)}
              data-profile-sign-in={profile.id}
            >
              Sign in
            </Button>
          </div>
          <p>
            Or run this command in your own terminal, then type <code className="font-mono">/login</code>:
          </p>
          <CopyCommand command={loginCommand(profile)} block />
        </div>
      )}
      <ProfileDefaultsSection profile={profile} onError={setError} />
      {error && (
        <p role="alert" className="text-ui text-error">
          {error}
        </p>
      )}
    </li>
  );
}

function AddProfileForm({ home, onDone }: { home: string | null; onDone(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [name, setName] = useState('Work');
  const [color, setColor] = useState<ProfileColor>('blue');
  const [folder, setFolder] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggested = home ? `${home}${separatorOf(home)}.claude-${slug(name)}` : '';
  const path = expandHome((folder ?? suggested).trim(), home);
  // Say why Add profile is unavailable instead of leaving a dimmed button to puzzle over.
  const problem = !name.trim() ? 'Give the profile a name.' : !path ? 'Choose a config folder.' : !isAbsolutePath(path) ? 'Use a full path to the folder, or one that starts with ~.' : null;

  const submit = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await client.call('profiles.add', { name: name.trim(), color, configDir: path });
      onDone();
      if (!signIn) return;
      // An existing folder may have its login already.
      const { profiles } = await client.call('profiles.list', {});
      if (!profiles.find((p) => p.id === id)?.account) await signInHere(client, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 rounded-lg border border-dashed border-border px-3 py-3"
      aria-label="Add a profile"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-add-profile-form
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input className={`${field} w-40`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" autoFocus data-new-profile-name />
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <input
          className={`${field} min-w-0 flex-1 font-mono`}
          value={folder ?? suggested}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="Config folder, e.g. ~/.claude-work"
          aria-label="Config folder"
          spellCheck={false}
          data-new-profile-folder
        />
        <Button icon={<FolderOpen size={13} aria-hidden />} className="shrink-0" onClick={() => void window.switchboard?.pickFolder(path || undefined).then((picked) => picked && setFolder(picked))}>
          Choose…
        </Button>
      </div>
      <p className="text-ui text-muted">
        Claude Code keeps a separate login, settings, plugins and sessions in each folder. A new folder is created. Use an existing one (for example where you already
        run <code className="font-mono">CLAUDE_CONFIG_DIR=… claude</code>) to see its sessions.
      </p>
      <Checkbox checked={signIn} onChange={setSignIn} className="w-fit text-ui text-text" dataAttrs={{ 'data-new-profile-sign-in': true }}>
        Sign in now: open Claude Code with this profile in Switchboard’s terminal
      </Checkbox>
      {error && (
        <p role="alert" className="text-ui text-error">
          Couldn't add the profile: {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {problem && (
          <p id="add-profile-problem" className="min-w-0 flex-1 text-ui text-muted">
            {problem}
          </p>
        )}
        <Button className="shrink-0" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !!problem} aria-describedby={problem ? 'add-profile-problem' : undefined} data-add-profile-submit>
          Add profile
        </Button>
      </div>
    </form>
  );
}

/** Step by step, how to make a second Claude Code login on this Mac and use it for some projects. Folded away by default. */
function SetupGuide() {
  const [open, setOpen] = useState(false);
  const folder = '~/.claude-work';
  // Not a grid: list items need display: list-item to keep their numbers.
  const step = 'space-y-1 pl-1 *:block';
  return (
    <div className="min-w-0 rounded-lg border border-border" data-profile-guide>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-ui text-muted hover:text-text"
        data-profile-guide-toggle
      >
        <ChevronRight size={13} aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        How to set up another profile
      </button>
      {open && (
        <ol className="grid list-decimal gap-3 border-t border-border py-3 pr-3 pl-8 text-ui text-muted marker:text-faint">
          <li className={step}>
            <span className="font-medium text-text">Create a config folder and sign in.</span>
            <span>
              Open Terminal and run <CopyCommand command={`CLAUDE_CONFIG_DIR=${folder} claude`} />. Claude Code creates the folder the first time. Type{' '}
              <code className="font-mono">/login</code> and sign in with the other account.
            </span>
          </li>
          <li className={step}>
            <span className="font-medium text-text">Add it here.</span>
            <span>
              Choose <span className="text-text">Add profile</span>, give it a name and colour, and pick the folder <code className="font-mono">{folder}</code>. Its sessions
              show up in the sidebar. You can also add the profile first: Switchboard creates the folder and opens Claude Code in its terminal, so you sign in there.
            </span>
          </li>
          <li className={step}>
            <span className="font-medium text-text">Link your projects.</span>
            <span>
              In the Projects view, set a project’s <span className="text-text">Claude profile</span>, or use <span className="text-text">⋯</span> next to the project in the
              sidebar’s project list. New sessions there use that account; other projects use the default. New session also lets you choose a profile for one session.
            </span>
          </li>
          <li className={step}>
            <span className="font-medium text-text">Optional: a shortcut for the terminal.</span>
            <span>
              Add <CopyCommand command={`alias claude-work='CLAUDE_CONFIG_DIR=${folder} claude'`} /> to <code className="font-mono">~/.zshrc</code> to start Claude Code with that
              account outside Switchboard too.
            </span>
          </li>
        </ol>
      )}
    </div>
  );
}

/** Settings → Claude profiles: one Claude Code login per config folder, and which one is the default. */
export function ProfilesSettings() {
  const profiles = useProfiles((s) => s.profiles);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ClaudeProfile | null>(null);
  const home = useHomeFolder();

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-profiles>
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" aria-label="Claude profiles">
        {profiles.map((profile) => (
          <ProfileRow key={profile.id} profile={profile} home={home} onRemove={() => setRemoving(profile)} />
        ))}
      </ul>
      {adding ? (
        <AddProfileForm home={home} onDone={() => setAdding(false)} />
      ) : (
        <Button icon={<Plus size={13} aria-hidden />} className="w-fit" onClick={() => setAdding(true)} data-add-profile>
          Add profile
        </Button>
      )}
      <SetupGuide />
      {removing && (
        <ConfirmDialog
          title={`Remove the ${removing.name} profile?`}
          confirmLabel="Remove"
          body={
            <>
              Its sessions leave the sidebar and its projects use the default profile again. The folder {removing.configDir}, its login and its sessions stay on disk; add it
              again to get them back.
            </>
          }
          onConfirm={async () => {
            await client?.call('profiles.remove', { id: removing.id });
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
