import { FolderGit2, Folder, Gauge, GitBranch, WandSparkles } from 'lucide-react';
import { AUTO_MODEL, type Effort, type PermissionMode, type RemoteBranches, type RemoteOptions, type RemotePermissionMode, type RemoteSession } from '@switchboard/protocol/remote-client';
import { branchChoices } from '../lib/branches.ts';
import { autoDescription, autoFace, EFFORT_LABEL, MODE_DESCRIPTION, MODE_DOT, MODE_LABEL, MODE_SHORT, modelLabel, PROFILE_DOT, profilesOf, projectProfile } from '../lib/options.ts';
import { ChoiceChip } from './ChoiceChip.tsx';

/** The chips for a session's choices (AGENTS.md, Message box chips): the value only, the full meaning in the label. */

const DEFAULT = '__default__';

/**
 * The Claude profile (login) a new session runs with, as on the computer: only with more than one profile. The
 * project's own (or the default) says so in the list.
 */
export function ProfileChip({ options, projectId, value, onPick }: { options: RemoteOptions; projectId: string; value: string; onPick: (profileId: string) => void }) {
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
      hook="profile"
      options={profiles.map((p) => ({ value: p.id, label: p.id === base ? `${p.name} (${own ? 'project' : 'default'})` : p.name, dot: PROFILE_DOT[p.color] }))}
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
}: {
  options: RemoteOptions;
  value: string | null;
  onPick: (model: string | null) => void;
  disabled?: boolean;
  placement?: 'above' | 'below';
  offerAuto?: boolean;
  auto?: RemoteSession['auto'];
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
      hook="model"
      options={[
        ...(offerAuto ? [{ value: AUTO_MODEL, label: 'Auto', description: autoDescription(options.auto?.allowed ?? []), icon: <Wand className="mt-0.5 size-3.5" />, separatorAfter: true }] : []),
        // The default (null) only when the list has no "default" of its own.
        ...(listDefault ? [] : [{ value: DEFAULT, label: 'Default model', description: 'What Switchboard starts sessions with' }]),
        ...(value && !known ? [{ value, label: modelLabel(options.models, value) }] : []),
        ...options.models.map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
      ]}
      onPick={(picked) => onPick(picked === DEFAULT || picked === listDefault ? null : picked)}
    />
  );
}

export function EffortChip({ options, value, onPick, disabled, placement }: { options: RemoteOptions; value: Effort | null; onPick: (effort: Effort | null) => void; disabled?: boolean; placement?: 'above' | 'below' }) {
  return (
    <ChoiceChip<Effort | typeof DEFAULT>
      label="Effort"
      face={value ? EFFORT_LABEL[value] : 'Default'}
      icon={<Gauge className="size-3.5 text-muted" aria-hidden />}
      selected={value ?? DEFAULT}
      disabled={disabled}
      placement={placement}
      hook="effort"
      options={[{ value: DEFAULT, label: 'Default', description: "The model's own" }, ...options.efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))]}
      onPick={(picked) => onPick(picked === DEFAULT ? null : picked)}
    />
  );
}

export function ModeChip({ options, value, onPick, disabled, placement }: { options: RemoteOptions; value: PermissionMode; onPick: (mode: RemotePermissionMode) => void; disabled?: boolean; placement?: 'above' | 'below' }) {
  return (
    <ChoiceChip<PermissionMode>
      label="Permission mode"
      face={MODE_SHORT[value]}
      icon={<span aria-hidden className={`size-2 rounded-full ${MODE_DOT[value]}`} />}
      selected={value}
      disabled={disabled}
      placement={placement}
      hook="mode"
      options={options.modes.map((m) => ({ value: m, label: MODE_LABEL[m], description: MODE_DESCRIPTION[m], dot: MODE_DOT[m] }))}
      onPick={(picked) => onPick(picked as RemotePermissionMode)}
    />
  );
}

export function WorkspaceChip({ value, onPick, disabled }: { value: boolean; onPick: (worktree: boolean) => void; disabled?: boolean }) {
  return (
    <ChoiceChip
      label="Where it works"
      face={value ? 'New worktree' : 'This folder'}
      icon={value ? <FolderGit2 className="size-3.5 text-muted" aria-hidden /> : <Folder className="size-3.5 text-muted" aria-hidden />}
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
export function BranchChip({ branches, value, onPick }: { branches: RemoteBranches; value: string | null; onPick: (branch: string | null) => void }) {
  const STAY = '';
  const choices = branchChoices(branches);
  return (
    <ChoiceChip
      label="Branch"
      face={value ?? branches.current ?? 'detached'}
      icon={<GitBranch className="size-3.5 text-muted" aria-hidden />}
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
