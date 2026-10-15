/**
 * The remote app's entry: the RPC client, the line transport, the Noise handshake and framing, and the remote
 * contracts' types, without the zod schemas (the engine validates what the phone sends).
 */
export { createRpcClient, RpcError, type RpcClient, type ParamsOf, type ResultOf, type EventPayload } from './rpc.ts';
export { lineTransport, LineDecoder, type TextStream } from './lineTransport.ts';
export type { Transport, WireMessage } from './wire.ts';
export type * from './remote.ts';
export type { CompanionStatus } from './companion.ts';
export type { Effort, ModelOption, PermissionDecision, PermissionMode, QueuedMessage, SendMode, StreamDelta } from './host.ts';
export type { CatchUp, CatchUpNeedKind, CatchUpTests } from './catchUp.ts';
export * from './remoteConstants.ts';
export * from './remoteNoise.ts';
export * from './remoteChannel.ts';
