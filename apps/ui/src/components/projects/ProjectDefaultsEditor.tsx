import { useEffect, useRef, useState } from 'react';
import { AUTO_MODEL, branchOfBase, isBranchBase, type BranchBase, type Effort, type PermissionMode, type ProfileDefaults, type ProjectDefaults, type WorktreeBase } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { globalModeLabel, MODE_CHOICES, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { AUTO_OFF_NOTE, modelLabel } from '../../lib/autoModel.ts';
import { EFFORT_LABEL, EFFORTS } from '../newSession/route.ts';
import { Select } from '../ui/Select.tsx';
import { Button } from '../ui/Button.tsx';
import { useSessions } from '../../state/sessionsStore.ts';
import { jumpToSetting } from '../settingsSearch/SettingsSearch.tsx';
import { settingsIndex } from '../settingsSearch/settingsIndex.ts';

const field = 'h-7 min-w-0 rounded-md border border-border bg-bg px-2 text-ui text-text outline-none focus:border-accent-ink/60 disabled:opacity-50';
/** The value an unset field shows; unset fields use the profile's defaults, else the global ones in Settings › General. */
const UNSET = '';
/** A project's permission mode that skips its profile's and follows the global one (`globalPermissionMode`). */
const GLOBAL = 'global';

/** Opens Settings on a setting from its search entry, `target` narrowing where it lands (one profile among several). */
function openSetting(id: string, target?: string): void {
  const entry = settingsIndex().find((e) => e.id === id);
  if (!entry) return;
  useSessions.getState().openSettings(entry.page);
  jumpToSetting(target ? { ...entry, target } : entry);
}

/** Shows a summary of the defaults a project or profile sets, e.g. "Opus · high effort · worktree"; `fallback` when it sets none. */
export function describeDefaults(d: Omit<ProjectDefaults, 'branch' | 'defaultBranch'> & { branch?: string | null; defaultBranch?: string | null }, fallback = 'Global defaults'): string {
  const parts = [
    d.model === AUTO_MODEL ? 'Auto' : d.model,
    d.effort && `${d.effort} effort`,
    d.permissionMode && d.permissionMode !== 'default' && d.permissionMode,
    d.workspace === 'worktree' ? `worktree${d.baseRef === 'head' ? ' from HEAD' : isBranchBase(d.baseRef) ? ` from ${branchOfBase(d.baseRef)}` : ''}` : d.workspace === 'current' && 'current folder',
    d.branch && `on ${d.branch}`,
    d.defaultBranch && `default branch ${d.defaultBranch}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : fallback;
}

/** Whether any field is set. */
export const hasDefaults = (d: ProfileDefaults | null | undefined) => !!d && Object.values(d).some((v) => v !== null);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 @max-[560px]:grid-cols-1 @max-[560px]:gap-1">
      <span className="text-ui text-muted">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-2">{children}</span>
    </div>
  );
}

/**
 * A project's or a profile's defaults for new sessions. An unset field leaves it to the level under it: a
 * project's to its profile's (`profile`, named in the option when it sets that field), and both to the
 * global defaults in Settings › General. Without a `root` (a profile) there is no branch to pick.
 * Every change saves at once.
 */
export function ProjectDefaultsEditor({
  root,
  defaults,
  isGitRepo,
  profile,
  profileRef,
  onSave,
}: {
  root: string | null;
  defaults: ProjectDefaults;
  isGitRepo: boolean;
  /** The defaults of the project's profile, which its unset fields fall back to. */
  profile?: ProfileDefaults | null;
  /** The project's profile, which the permission mode's hint names and links to. */
  profileRef?: { id: string; name: string } | null;
  onSave(defaults: ProjectDefaults): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const models = useHosts((s) => s.models);
  const autoEnabled = usePreferences((s) => s.prefs.autoModel.enabled);
  const globalMode = globalModeLabel(usePreferences((s) => s.prefs.newSessionMode));
  const globalModel = usePreferences((s) => s.prefs.newSessionModel);
  const globalEffort = usePreferences((s) => s.prefs.newSessionEffort);
  const [branches, setBranches] = useState<{ current: string | null; branches: string[]; remoteBranches?: string[] }>({ current: null, branches: [] });

  useEffect(() => {
    if (!client || !root || !isGitRepo) return;
    let cancelled = false;
    client.call('git.branches', { cwd: root }).then(
      (r) => !cancelled && setBranches(r),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, isGitRepo]);

  // Changes build on the last one made, not on the props: a quick second change arrives before the
  // first has been saved and reloaded, and would otherwise undo it.
  const latest = useRef(defaults);
  const seen = useRef(defaults);
  if (seen.current !== defaults) {
    seen.current = defaults;
    latest.current = defaults;
  }
  const set = (patch: Partial<ProjectDefaults>) => {
    latest.current = { ...latest.current, ...patch };
    onSave(latest.current);
  };
  const nullable = <T extends string>(value: string) => (value === UNSET ? null : (value as T));
  // What an unset field falls back to: "Profile default (Opus)" when the profile sets it, else the global default,
  // named when Settings › General sets one (`global`).
  const inherit = (label: string, value: string | null | undefined, shown?: string, global?: string) =>
    value ? `Profile ${label} (${shown ?? value})` : global ? `Global ${label} (${global})` : `Global ${label}`;
  const baseLabel = { fresh: 'from origin', head: 'from HEAD' } as const;
  const branchOptions = defaults.branch && !branches.branches.includes(defaults.branch) ? [defaults.branch, ...branches.branches] : branches.branches;
  // A project's worktrees can start from any of its branches; a profile has no repository, so only origin or HEAD.
  const listedBases: BranchBase[] = root ? [...branches.branches.map((b) => `refs/heads/${b}` as const), ...(branches.remoteBranches ?? []).map((b) => `refs/remotes/${b}` as const)] : [];
  const baseOptions = isBranchBase(defaults.baseRef) && !listedBases.includes(defaults.baseRef) ? [defaults.baseRef, ...listedBases] : listedBases;
  // A default branch is a name, here or on a remote: `origin/dev` is offered as `dev`.
  const namedBranches = [...new Set([...(defaults.defaultBranch ? [defaults.defaultBranch] : []), ...branches.branches, ...(branches.remoteBranches ?? []).map((b) => b.slice(b.indexOf('/') + 1))])];

  const modeValue = defaults.permissionMode ?? (root && defaults.globalPermissionMode ? GLOBAL : UNSET);
  // Where an inherited permission mode is set, with a way there.
  const openGlobal = () => openSetting('new-session-mode');
  const modeHint =
    modeValue === GLOBAL || (modeValue === UNSET && !root)
      ? { kind: 'global', text: 'The global permission mode, set in Settings › General.', where: 'Open Settings › General', open: openGlobal }
      : modeValue === UNSET && profileRef
        ? {
            kind: 'profile',
            text: profile?.permissionMode ? `Set in the ${profileRef.name} profile's defaults.` : `The ${profileRef.name} profile sets none, so the global mode applies.`,
            where: 'Open Settings › Claude profiles',
            open: () => openSetting('profile-defaults', `[data-profile-defaults="${CSS.escape(profileRef.id)}"] [data-profile-defaults-toggle]`),
          }
        : null;

  return (
    <div className="grid gap-2.5" data-project-defaults={root ?? undefined}>
      <Row label="Model">
        <Select
          label="Model"
          className={field}
          value={defaults.model ?? UNSET}
          onChange={(value) => set({ model: nullable(value) })}
          options={[
            { value: UNSET, label: inherit('default', profile?.model, profile?.model ? modelLabel(models, profile.model) : undefined, globalModel ? modelLabel(models, globalModel) : undefined) },
            // Auto stays listed while it is the saved choice, also with Auto off (the note says what happens then).
            ...(autoEnabled || defaults.model === AUTO_MODEL ? [{ value: AUTO_MODEL, label: autoEnabled ? 'Auto' : 'Auto (off)' }] : []),
            ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName })),
            ...(defaults.model && defaults.model !== AUTO_MODEL && !models.some((m) => m.value === defaults.model) ? [{ value: defaults.model, label: defaults.model }] : []),
          ]}
          dataAttrs={{ 'data-default-model': true }}
        />
        <Select
          label="Effort"
          className={field}
          value={defaults.effort ?? UNSET}
          onChange={(value) => set({ effort: nullable<Effort>(value) })}
          options={[{ value: UNSET, label: inherit('effort', profile?.effort, profile?.effort ? EFFORT_LABEL[profile.effort] : undefined, globalEffort ? EFFORT_LABEL[globalEffort] : undefined) }, ...EFFORTS.map((e) => ({ value: e, label: `${EFFORT_LABEL[e]} effort` }))]}
          dataAttrs={{ 'data-default-effort': true }}
        />
      </Row>
      {defaults.model === AUTO_MODEL && (
        <p className="ml-[122px] text-meta text-muted @max-[560px]:ml-0" data-default-model-auto>
          {autoEnabled ? 'Queued prompts are routed when they start, not when you add them.' : AUTO_OFF_NOTE}
        </p>
      )}
      <Row label="Permissions">
        <Select
          label="Permission mode"
          className={field}
          value={modeValue}
          onChange={(value) => set(root ? { permissionMode: value === GLOBAL ? null : nullable<PermissionMode>(value), globalPermissionMode: value === GLOBAL || undefined } : { permissionMode: nullable<PermissionMode>(value) })}
          options={[
            // A project inherits its profile's mode, or skips it for the global one; a profile inherits the global one.
            ...(root ? [{ value: UNSET, label: `Profile default (${profile?.permissionMode ? MODE_LABEL[profile.permissionMode] : globalMode})` }] : []),
            { value: root ? GLOBAL : UNSET, label: `Global default (${globalMode})` },
            ...MODE_CHOICES.map((m) => ({ value: m, label: MODE_LABEL[m] })),
          ]}
          menuWidth={240}
          dataAttrs={{ 'data-default-mode': true }}
        />
      </Row>
      {modeHint && (
        <p className="ml-[122px] flex flex-wrap items-center gap-x-2 text-meta text-muted @max-[560px]:ml-0" data-default-mode-hint={modeHint.kind}>
          {modeHint.text}
          <Button variant="quiet" size="sm" onClick={modeHint.open} data-tooltip={modeHint.where} data-default-mode-open={modeHint.kind}>
            Change
          </Button>
        </p>
      )}
      <Row label="Workspace">
        <Select
          label="Workspace"
          className={field}
          value={defaults.workspace ?? UNSET}
          disabled={!isGitRepo && defaults.workspace !== 'worktree'}
          onChange={(value) => set({ workspace: nullable<'current' | 'worktree'>(value), ...(value === 'worktree' ? { branch: null } : {}) })}
          options={[
            { value: UNSET, label: inherit('default', profile?.workspace, profile?.workspace === 'worktree' ? 'New worktree' : 'Current folder') },
            { value: 'current', label: 'Current folder' },
            { value: 'worktree', label: 'New worktree' },
          ]}
          dataAttrs={{ 'data-default-workspace': true }}
        />
        {defaults.workspace !== 'current' && (
          <Select
            label="Worktree base"
            tooltip="What a new worktree branches from. A branch here is also where pull requests go"
            className={field}
            value={defaults.baseRef ?? UNSET}
            disabled={!isGitRepo}
            onChange={(value) => set({ baseRef: nullable<WorktreeBase>(value) })}
            options={[
              { value: UNSET, label: `Worktree base: ${inherit('default', profile?.baseRef, profile?.baseRef ? baseLabel[profile.baseRef] : undefined).toLowerCase()}` },
              { value: 'fresh', label: 'Worktree from origin' },
              { value: 'head', label: 'Worktree from HEAD' },
              ...baseOptions.map((base) => ({ value: base, label: `Worktree from ${branchOfBase(base)}` })),
            ]}
            menuWidth={260}
            dataAttrs={{ 'data-default-base': true }}
          />
        )}
      </Row>
      {root && isGitRepo && (
        <Row label="Default branch">
          <Select
            label="Default branch"
            tooltip="Where worktrees from origin start, what pull requests go into and what changes compare against"
            className={field}
            value={defaults.defaultBranch ?? UNSET}
            onChange={(value) => set({ defaultBranch: nullable(value) })}
            options={[{ value: UNSET, label: "The remote's default branch" }, ...namedBranches.map((b) => ({ value: b, label: b }))]}
            menuWidth={240}
            dataAttrs={{ 'data-default-default-branch': true }}
          />
        </Row>
      )}
      {root && isGitRepo && defaults.workspace !== 'worktree' && (
        <Row label="Branch">
          <Select
            label="Branch"
            className={field}
            value={defaults.branch ?? UNSET}
            onChange={(value) => set({ branch: nullable(value) })}
            options={[{ value: UNSET, label: `Keep what is checked out${branches.current ? ` (${branches.current})` : ''}` }, ...branchOptions.map((b) => ({ value: b, label: `Check out ${b}` }))]}
            menuWidth={240}
            dataAttrs={{ 'data-default-branch': true }}
          />
        </Row>
      )}
    </div>
  );
}
