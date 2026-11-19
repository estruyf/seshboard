/**
 * The parts of the Agent Client Protocol (https://agentclientprotocol.com/protocol/schema, version 1) Seshboard uses.
 * Only what is read is typed: an agent may send more, and every field it sends is checked where it is read.
 */

export interface AcpInitializeResponse {
  protocolVersion?: number;
  agentInfo?: { name?: string; title?: string; version?: string };
  agentCapabilities?: { loadSession?: boolean; promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean } };
  authMethods?: Array<{ id: string; name?: string; description?: string }>;
}

export interface AcpMode {
  id: string;
  name?: string;
  description?: string;
}

/** An agent's model (`unstable` in ACP: `session/new`'s `models`). */
export interface AcpModel {
  modelId: string;
  name?: string;
  description?: string;
}

/** What `session/new` and `session/load` answer: the session's modes and models. */
export interface AcpSessionResponse {
  sessionId?: string;
  modes?: { availableModes?: AcpMode[]; currentModeId?: string } | null;
  models?: { availableModels?: AcpModel[]; currentModelId?: string } | null;
}

/** One block of a prompt or a message. */
export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string; uri?: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string }
  | { type: string; [key: string]: unknown };

/** What a tool call shows: content, a file's diff, or a terminal. */
export type AcpToolCallContent =
  | { type: 'content'; content: AcpContentBlock }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string; _meta?: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

/** A tool call (`tool_call`), or what changed in one (`tool_call_update`, where every field but the id may be left out). */
export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  /** `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode` or `other`. */
  kind?: string;
  /** `pending`, `in_progress`, `completed` or `failed`. */
  status?: string;
  content?: AcpToolCallContent[];
  locations?: Array<{ path: string; line?: number | null }>;
  rawInput?: unknown;
  rawOutput?: unknown;
  _meta?: Record<string, unknown>;
}

/** `session/update`'s `update`, by its `sessionUpdate`. */
export type AcpSessionUpdate =
  | { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk'; content: AcpContentBlock }
  | ({ sessionUpdate: 'tool_call' | 'tool_call_update' } & AcpToolCall)
  | { sessionUpdate: 'plan'; entries: Array<{ content: string; status?: string; priority?: string }> }
  | { sessionUpdate: 'available_commands_update'; availableCommands: Array<{ name: string; description?: string; input?: { hint?: string } | null }> }
  | { sessionUpdate: 'current_mode_update'; currentModeId: string }
  | { sessionUpdate: 'usage_update'; used?: number; size?: number }
  | { sessionUpdate: string; [key: string]: unknown };

/** One choice a permission request offers. */
export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  /** `allow_once`, `allow_always`, `reject_once` or `reject_always`. */
  kind: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

/** The answer to `session/request_permission`. */
export type AcpPermissionOutcome = { outcome: { outcome: 'selected'; optionId: string } } | { outcome: { outcome: 'cancelled' } };

/** How `session/prompt` ended. */
export interface AcpPromptResponse {
  stopReason?: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | string;
}
