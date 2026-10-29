/**
 * The remote app's entry: the RPC client, the line transport, the Noise handshake and framing, and the remote
 * contracts' types, without the zod schemas (the engine validates what the phone sends).
 */
export { createRpcClient, RpcError, type RpcClient, type ParamsOf, type ResultOf, type EventPayload } from './rpc.ts';
export { lineTransport, LineDecoder, type TextStream } from './lineTransport.ts';
export type { Transport, WireMessage } from './wire.ts';
export type * from './remote.ts';
export type { CompanionStatus } from './companion.ts';
export type { BackgroundTask, Effort, ModelOption, PermissionDecision, PermissionMode, QueuedMessage, SendMode, StreamDelta } from './host.ts';
export type { UsageLimit, UsageSnapshot } from './usage.ts';
export type { RemoteLimitStanding } from './usageLimit.ts';
export { clockTime, limitKindName } from './queueStates.ts';
export { safeLocale } from './locale.ts';
export type { AskEvent, AskItem, AskThread, AskThreadList } from './sideQuestions.ts';
export { MAX_SIDE_QUESTION_LENGTH, threadTitle } from './sideQuestionConstants.ts';
export { AUTO_MODEL, AUTO_TIERS, tierLabel, type AutoTier } from './autoModel.ts';
export type { CatchUp, CatchUpNeedKind, CatchUpTests } from './catchUp.ts';
export * from './remoteConstants.ts';
export { APP_ICON_KEYS, appIconKey, DEFAULT_APP_ICON, remoteIconUrl, remoteManifestUrl, type AppIconKey } from './appIcons.ts';
export { COLOR_PATTERN } from './color.ts';
export { overlayShadow } from './themeShadow.ts';
export * from './remoteNoise.ts';
export * from './remoteChannel.ts';
export { checkRemoteSessions, unreadableLine, type CheckedSessions } from './remoteSessionsCheck.ts';
export { parseBriefs, withoutBriefs, type Brief } from './sessionLinks.ts';
export { parseGithubBlocks, withoutContext, type GithubBlock } from './githubContext.ts';
export type { Pipeline, PipelineClaudeStep, PipelinePushStep, PipelineRunStatus, PipelineStep, PipelineStepStatus, PipelineWait, PushPreview, StepVerdict } from './pipelineSchema.ts';
export { mostUrgent, outOfRounds, roundOf, runProgress, sidebarTree, stepStateWord, stepTitle, type SidebarTree, type TreeRow, type TreeStatus } from './pipelines.ts';
export * from './pipelineView.ts';
export { gerund, toolStepLabel, type StepLabel } from './toolSteps.ts';
