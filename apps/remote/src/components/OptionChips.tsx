import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderGit2, Folder, Gauge, GitBranch, WandSparkles } from 'lucide-react';
import { AUTO_MODEL, type Effort, type PermissionMode, type RemoteBranches, type RemoteOptions, type RemotePermissionMode, type RemoteSession, type RemoteProfile } from '@seshboard/protocol/remote-client';
import { branchChoices } from '../lib/branches.ts';
import { autoDescription, autoFace, EFFORT_LABEL, MODE_DESCRIPTION, MODE_DOT, MODE_LABEL, MODE_SHORT, modelLabel, PROFILE_DOT, profilesOf, projectProfile, takesEffort } from '../lib/options.ts';
import { ChoiceChip } from './ChoiceChip.tsx';
import { Sheet } from './Sheet.tsx';

/**
 * The chips for a session's choices (AGENTS.md, Message box chips): the value only, the full meaning in the label.
 * `look="row"` makes each a row of a phone's list (New session's Options, a session's Model and mode).
 */

type Look = 'chip' | 'row';

const DEFAULT = '__default__';

/**
 * The Claude profile (login) a new session runs with, as on the computer: only with more than one profile. The
 * project's own (or the default) says so in the list.
 */
export function ProfileChip({ options, projectId, value, onPick, look }: { options: RemoteOptions; projectId: string; value: string; onPick: (profileId: string) => void; look?: Look }) {
  const profiles = profilesOf(options);
  if (profiles.length < 2) return null;
  const current = profiles.find((p) => p.id === value);
  const base = projectProfile(options, projectId);
  const own = Boolean(options.projects.find((p) => p.id === projectId)?.profileId);
  return (
    <ChoiceChip
      label="Claude profile"
      face={current?.name ?? 'Profile'}
      icon={<span aria-hidden className={`size-2 rounded-full ${current ? PROFILE_DOT[current.color] : 'bg-faint'}`} />}
      selected={value}
      look={look}
      rowLabel="Profile"
      hook="profile"
      // A profile of another provider (GitHub Copilot) says who runs it.
      options={profiles.map((p) => ({ value: p.id, label: p.id === base ? `${p.name} (${own ? 'project' : 'default'})` : p.name, dot: PROFILE_DOT[p.color], ...(p.provider ? { description: `Runs with ${p.provider.name}` } : {}) }))}
      onPick={onPick}
    />
  );
}

/** Auto's wand, on the chip and in the list. */
const Wand = ({ className = 'size-3.5' }: { className?: string }) => <WandSparkles className={`${className} shrink-0 text-accent-ink`} aria-hidden />;

/**
 * The model. New session offers Auto first while it is on in Settings (`offerAuto`): Haiku picks the model from the
 * first prompt. A running session's chip says what Auto picked (`auto`) until you pick a model yourself; Auto isn't
 * in its list, as on the computer, because it only picks once, when a session starts.
 */
export function ModelChip({
  options,
  value,
  onPick,
  disabled,
  placement,
  offerAuto = false,
  auto,
  look,
}: {
  options: RemoteOptions;
  value: string | null;
  onPick: (model: string | null) => void;
  disabled?: boolean;
  placement?: 'above' | 'below';
  offerAuto?: boolean;
  auto?: RemoteSession['auto'];
  look?: Look;
}) {
  const known = options.models.some((m) => m.value === value) || (offerAuto && value === AUTO_MODEL);
  const picked = autoFace(auto);
  const isAuto = Boolean(picked) || value === AUTO_MODEL;
  // The list's own "default" stands for no model chosen.
  const listDefault = options.models.some((m) => m.value === 'default') ? 'default' : null;
  return (
    <ChoiceChip
      label="Model"
      face={picked ?? modelLabel(options.models, value)}
      icon={isAuto ? <Wand /> : undefined}
      spoken={picked ? `Model: ${picked.replace(' · ', ' picked ')}` : undefined}
      selected={value ?? listDefault ?? DEFAULT}
      disabled={disabled}
      placement={placement}
      look={look}
      hook="model"
      options={[
        ...(offerAuto ? [{ value: AUTO_MODEL, label: 'Auto', description: autoDescription(options.auto?.allowed ?? []), icon: <Wand className="mt-0.5 size-3.5" />, separatorAfter: true }] : []),
        // The default (null) only when the list has no "default" of its own.
        ...(listDefault ? [] : [{ value: DEFAULT, label: 'Default model', description: 'What Seshboard starts sessions with' }]),
        ...(value && !known ? [{ value, label: modelLabel(options.models, value) }] : []),
        ...options.models.map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
      ]}
      onPick={(picked) => onPick(picked === DEFAULT || picked === listDefault ? null : picked)}
    />
  );
}

export function EffortChip({ options, value, onPick, disabled, placement, look }: { options: RemoteOptions; value: Effort | null; onPick: (effort: Effort | null) => void; disabled?: boolean; placement?: 'above' | 'below'; look?: Look }) {
  return (
    <ChoiceChip<Effort | typeof DEFAULT>
      label="Effort"
      face={value ? EFFORT_LABEL[value] : 'Default'}
      icon={look === 'row' ? undefined : <Gauge className="size-3.5 text-muted" aria-hidden />}
      selected={value ?? DEFAULT}
      disabled={disabled}
      placement={placement}
      look={look}
      hook="effort"
      options={[{ value: DEFAULT, label: 'Default', description: "The model's own" }, ...options.efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))]}
      onPick={(picked) => onPick(picked === DEFAULT ? null : picked)}
    />
  );
}

export function ModeChip({ options, value, onPick, disabled, placement, look }: { options: RemoteOptions; value: PermissionMode; onPick: (mode: RemotePermissionMode) => void; disabled?: boolean; placement?: 'above' | 'below'; look?: Look }) {
  return (
    <ChoiceChip<PermissionMode>
      label="Permission mode"
      face={MODE_SHORT[value]}
      icon={<span aria-hidden className={`size-2 rounded-full ${MODE_DOT[value]}`} />}
      selected={value}
      disabled={disabled}
      placement={placement}
      look={look}
      rowLabel="Mode"
      hook="mode"
      options={options.modes.map((m) => ({ value: m, label: MODE_LABEL[m], description: MODE_DESCRIPTION[m], dot: MODE_DOT[m] }))}
      onPick={(picked) => onPick(picked as RemotePermissionMode)}
    />
  );
}

export function WorkspaceChip({ value, onPick, disabled, look }: { value: boolean; onPick: (worktree: boolean) => void; disabled?: boolean; look?: Look }) {
  const icon = value ? <FolderGit2 className="size-3.5 text-muted" aria-hidden /> : <Folder className="size-3.5 text-muted" aria-hidden />;
  return (
    <ChoiceChip
      label="Where it works"
      face={value ? 'New worktree' : 'This folder'}
      icon={look === 'row' ? undefined : icon}
      look={look}
      rowLabel="Where"
      rowIcon={<Folder aria-hidden />}
      selected={value}
      disabled={disabled}
      hook="worktree"
      options={[
        { value: false, label: 'This folder', description: 'Edits land in your working copy' },
        { value: true, label: 'New worktree', description: 'An isolated copy; your checkout stays untouched' },
      ]}
      onPick={onPick}
    />
  );
}

/**
 * The branch a session in the project's folder starts on: the one checked out there, or another to check out first.
 * Detached, the first choice keeps it so.
 */
export function BranchChip({ branches, value, onPick, look }: { branches: RemoteBranches; value: string | null; onPick: (branch: string | null) => void; look?: Look }) {
  const STAY = '';
  const choices = branchChoices(branches);
  return (
    <ChoiceChip
      label="Branch"
      face={value ?? branches.current ?? 'detached'}
      icon={look === 'row' ? undefined : <GitBranch className="size-3.5 text-muted" aria-hidden />}
      look={look}
      rowIcon={<GitBranch aria-hidden />}
      selected={value ?? branches.current ?? STAY}
      hook="branch"
      options={[
        ...(branches.current ? [] : [{ value: STAY, label: 'Stay on the current checkout' }]),
        ...choices.map((b) => ({ value: b, label: b, description: b === branches.current ? 'Checked out now' : undefined })),
      ]}
      onPick={(b) => onPick(b === STAY || b === branches.current ? null : b)}
    />
  );
}

/**
 * A running session's model and mode in one chip, in a phone's message box ("Opus 5.5 · Auto"): it opens a sheet with
 * Model, Effort (for a model that takes one, from a Seshboard that sends it) and Mode as rows, each with its list.
 */
export function ModelModeChip({ options, session, disabled, onModel, onEffort, onMode }: { options: RemoteOptions; session: Pick<RemoteSession, 'model' | 'auto' | 'effort' | 'permissionMode'>; disabled: boolean; onModel: (model: string | null) => void; onEffort: (effort: Effort | null) => void; onMode: (mode: RemotePermissionMode) => void }) {
  const [open, setOpen] = useState(false);
  const model = autoFace(session.auto) ?? modelLabel(options.models, session.model);
  const mode = session.permissionMode ? MODE_SHORT[session.permissionMode] : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={`Model and mode: ${model}${mode ? `, ${mode}` : ''}`}
        className="flex min-h-9 min-w-0 items-center gap-1 rounded-full border border-edge px-3 text-ui text-text enabled:active:bg-selected disabled:opacity-50"
        data-remote-model-mode-chip
      >
        <span className="truncate font-medium">{model}</span>
        {mode && <span className="shrink-0 text-faint">· {mode}</span>}
      </button>
      {open &&
        createPortal(
          <Sheet title="Model and mode" onClose={() => setOpen(false)} done hook="model-mode">
            <div className="-mx-4 flex flex-col divide-y divide-border border-y border-border">
              <ModelChip options={options} value={session.model} auto={session.auto} disabled={disabled} onPick={onModel} look="row" />
              {session.effort !== undefined && takesEffort(options.models, session.model) && <EffortChip options={options} value={session.effort} disabled={disabled} onPick={onEffort} look="row" />}
              {session.permissionMode && <ModeChip options={options} value={session.permissionMode} disabled={disabled} onPick={onMode} look="row" />}
            </div>
          </Sheet>,
          document.body,
        )}
    </>
  );
}

/** Another provider's models (from `providers.ready`), with its own default first. */
export function ProviderModelChip({ provider, models, value, onPick, look }: { provider: string; models: RemoteOptions['models']; value: string | null; onPick: (model: string | null) => void; look?: Look }) {
  return (
    <ChoiceChip
      label="Model"
      face={value ? (models.find((m) => m.value === value)?.displayName ?? value) : 'Default model'}
      selected={value ?? DEFAULT}
      look={look}
      hook="model"
      options={[{ value: DEFAULT, label: 'Default model', description: `What ${provider} picks` }, ...models.map((m) => ({ value: m.value, label: m.displayName, description: m.description }))]}
      onPick={(picked) => onPick(picked === DEFAULT ? null : picked)}
    />
  );
}

/** Another provider's modes, in its words (Copilot's Autopilot). */
export function ProviderModeChip({ modes, value, onPick, look }: { modes: NonNullable<RemoteProfile['provider']>['modes']; value: RemotePermissionMode; onPick: (mode: RemotePermissionMode) => void; look?: Look }) {
  return (
    <ChoiceChip<RemotePermissionMode>
      label="Permission mode"
      face={modes.find((m) => m.value === value)?.label ?? MODE_SHORT[value]}
      icon={<span aria-hidden className={`size-2 rounded-full ${MODE_DOT[value]}`} />}
      selected={value}
      look={look}
      rowLabel="Mode"
      hook="mode"
      options={modes.map((m) => ({ value: m.value, label: m.label, description: m.description, dot: MODE_DOT[m.value] }))}
      onPick={onPick}
    />
  );
}
