/**
 * Renderer-side entry: the RPC client and transport without the zod schemas,
 * so the UI bundle doesn't pay for runtime validation it never runs.
 */
export { createRpcClient, RpcError, type RpcClient, type ClientOptions, type EventPayload, type ParamsOf, type ResultOf } from './rpc.ts';
export { messagePortTransport, type Transport, type WireMessage } from './wire.ts';
export type * from './contract.ts';
export * from './bridge.ts';
export type * from './sessions.ts';
export type * from './host.ts';
export type * from './git.ts';
export type * from './worktrees.ts';
export type * from './branches.ts';
export type * from './capabilities.ts';
export type * from './terminal.ts';
export type * from './actions.ts';
export { ACTION_ICONS, type ActionIcon } from './actionIcons.ts';
export type * from './usage.ts';
export type * from './profiles.ts';
export type * from './claudeUpdate.ts';
export type * from './backup.ts';
export type * from './later.ts';
export { BACKUP_SECTIONS, SETTINGS_FILE_FORMAT, settingsFileName, type BackupSection } from './backupConstants.ts';
export { BUILTIN_PROFILE_ID, PROFILE_COLORS } from './profileConstants.ts';
export { PROJECT_NAME_MAX } from './projectConstants.ts';
export { randomWorktreeName } from './worktreeName.ts';
export type * from './context.ts';
export type * from './companion.ts';
export { CONTINUE_EDITORS, MAX_CONTEXT_ITEMS, type ContinueEditor } from './companionConstants.ts';
export type * from './memory.ts';
export * from './memoryText.ts';
