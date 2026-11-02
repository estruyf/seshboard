import type { PermissionDecision, PermissionRequest } from '@seshboard/protocol';
import { clipJson, LIMITS } from '../../claude/transcript.ts';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Copilot's permission request (the SDK's `PermissionRequest`, by `kind`) as the permission card shows Claude Code's:
 * a shell command as Bash, a file write as Edit with its diff, a read as Read, a URL as WebFetch, an MCP tool by its
 * `mcp__server__tool` name. Anything else keeps Copilot's kind and fields.
 */
export function toPermissionRequest(requestId: string, request: Record<string, unknown>, now = Date.now()): Omit<PermissionRequest, 'sessionId'> {
  const kind = str(request.kind) ?? 'unknown';
  const intention = str(request.intention);
  let toolName = kind;
  let input: Record<string, unknown> = { ...request };
  switch (kind) {
    case 'shell':
      toolName = 'Bash';
      input = { command: str(request.fullCommandText) ?? '', ...(intention ? { description: intention } : {}) };
      break;
    case 'write':
      toolName = 'Edit';
      input = { file_path: str(request.fileName) ?? '', diff: str(request.diff) ?? '' };
      break;
    case 'read':
      toolName = 'Read';
      input = { file_path: str(request.path) ?? '' };
      break;
    case 'url':
      toolName = 'WebFetch';
      input = { url: str(request.url) ?? '' };
      break;
    case 'mcp':
      toolName = `mcp__${str(request.serverName) ?? 'server'}__${str(request.toolName) ?? 'tool'}`;
      input = (request.args && typeof request.args === 'object' ? request.args : {}) as Record<string, unknown>;
      break;
    default:
      break;
  }
  const { value, truncated } = clipJson(input, LIMITS.toolInputString);
  return {
    requestId,
    toolName,
    toolUseId: str(request.toolCallId),
    input: value,
    ...(truncated ? { truncated } : {}),
    title: intention,
    description: null,
    decisionReason: null,
    blockedPath: null,
    // Copilot can approve the same kind of request for the rest of the session.
    alwaysLabel: request.canOfferSessionApproval === true ? 'Allow for this session' : null,
    agentId: null,
    createdAt: now,
  };
}

/** Seshboard's answer as Copilot's permission decision. */
export function toCopilotDecision(decision: PermissionDecision): { kind: 'approve-once' } | { kind: 'approve-for-session' } | { kind: 'reject'; feedback?: string } {
  if (decision.behavior === 'allow') return decision.always ? { kind: 'approve-for-session' } : { kind: 'approve-once' };
  return decision.message ? { kind: 'reject', feedback: decision.message } : { kind: 'reject' };
}
