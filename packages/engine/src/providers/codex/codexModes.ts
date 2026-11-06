import type { PermissionMode, ProviderMode } from '@seshboard/protocol';
import type { AskForApproval, SandboxMode, SandboxPolicy } from './protocol.ts';

/**
 * Seshboard's modes for a Codex session, named as Claude Code's. Codex splits each into a sandbox (what a command may
 * touch without asking) and an approval policy (when it asks), set on every turn (`codexTurnSettings`), so a change here
 * applies from the next message, to sessions already running too. Seshboard never offers `danger-full-access`.
 */
export const CODEX_MODES: ProviderMode[] = [
  { value: 'default', label: 'Ask before edits', description: 'Approve every edit, and commands that leave the sandbox' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'Edits in the folder apply, commands outside it still ask' },
  { value: 'plan', label: 'Plan mode', description: 'Codex plans before it changes anything' },
  { value: 'auto', label: 'Auto mode', description: "Codex keeps going in the folder's sandbox, without asking" },
];

/** What one of Seshboard's modes is in Codex. */
export interface CodexModeSettings {
  sandbox: SandboxMode;
  approvalPolicy: AskForApproval;
  /** Codex's own plan mode, through `turn/start`'s experimental `collaborationMode`. */
  plan: boolean;
}

const MODES: Record<'default' | 'acceptEdits' | 'plan' | 'auto', CodexModeSettings> = {
  default: { sandbox: 'read-only', approvalPolicy: 'on-request', plan: false },
  acceptEdits: { sandbox: 'workspace-write', approvalPolicy: 'on-request', plan: false },
  plan: { sandbox: 'read-only', approvalPolicy: 'on-request', plan: true },
  auto: { sandbox: 'workspace-write', approvalPolicy: 'never', plan: false },
};

/**
 * A mode's sandbox and approval policy. A read-only session (a pipeline's read-only step, Ask about this session) is
 * read-only whatever its mode, and never asks: Codex's sandbox refuses what would write. A mode Codex has no row for
 * (Claude Code's `dontAsk`, `bypassPermissions`) is Ask before edits.
 */
export function codexModeSettings(mode: PermissionMode, readOnly = false): CodexModeSettings {
  if (readOnly) return { sandbox: 'read-only', approvalPolicy: 'never', plan: false };
  return mode in MODES ? MODES[mode as keyof typeof MODES] : MODES.default;
}

/** A sandbox as `turn/start` takes it: Codex's own defaults, with the network off as in its CLI. */
export function sandboxPolicy(sandbox: SandboxMode): SandboxPolicy {
  return sandbox === 'read-only' ? { type: 'readOnly', networkAccess: false } : { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}
