import { FolderGit2, Folder } from 'lucide-react';
import type { Effort, PermissionMode, RemoteOptions, RemotePermissionMode } from '@switchboard/protocol/remote-client';
import { EFFORT_LABEL, MODE_DESCRIPTION, MODE_DOT, MODE_LABEL, MODE_SHORT, modelLabel } from '../lib/options.ts';
import { ChoiceChip } from './ChoiceChip.tsx';

/** The chips for a session's choices (AGENTS.md, Message box chips): the value only, the full meaning in the label. */

const DEFAULT = '__default__';

export function ModelChip({ options, value, onPick, disabled, placement }: { options: RemoteOptions; value: string | null; onPick: (model: string | null) => void; disabled?: boolean; placement?: 'above' | 'below' }) {
  const known = options.models.some((m) => m.value === value);
  // The list's own "default" stands for no model chosen.
  const listDefault = options.models.some((m) => m.value === 'default') ? 'default' : null;
  return (
    <ChoiceChip
      label="Model"
      face={modelLabel(options.models, value)}
      selected={value ?? listDefault ?? DEFAULT}
      disabled={disabled}
      placement={placement}
      hook="model"
      options={[
        // The default (null) only when the list has no "default" of its own.
        ...(listDefault ? [] : [{ value: DEFAULT, label: 'Default model', description: 'What Switchboard starts sessions with' }]),
        ...(value && !known ? [{ value, label: modelLabel(options.models, value) }] : []),
        ...options.models.map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
      ]}
      onPick={(picked) => onPick(picked === DEFAULT || picked === listDefault ? null : picked)}
    />
  );
}

export function EffortChip({ options, value, onPick, disabled }: { options: RemoteOptions; value: Effort | null; onPick: (effort: Effort | null) => void; disabled?: boolean }) {
  return (
    <ChoiceChip<Effort | typeof DEFAULT>
      label="Effort"
      face={`Effort: ${value ? EFFORT_LABEL[value].toLowerCase() : 'default'}`}
      selected={value ?? DEFAULT}
      disabled={disabled}
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
