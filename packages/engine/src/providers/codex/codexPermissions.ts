import type { PermissionDecision, PermissionRequest } from '@seshboard/protocol';
import type { ServerRequest } from './protocol.ts';

/**
 * A request of Codex's (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
 * `item/tool/requestUserInput`) as the permission or question card Claude Code's would show. Null for a request
 * Seshboard doesn't show, which the driver refuses.
 */
export function codexPermissionRequest(_requestId: string, _request: ServerRequest, _now = Date.now()): Omit<PermissionRequest, 'sessionId'> | null {
  throw new Error('codexPermissionRequest: not built yet');
}

/** The answer Codex expects for its request, from the card's decision. */
export function codexAnswer(_request: ServerRequest, _decision: PermissionDecision): unknown {
  throw new Error('codexAnswer: not built yet');
}
