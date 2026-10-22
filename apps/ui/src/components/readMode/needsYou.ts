import type { PermissionRequest } from '@switchboard/protocol/client';

/** The request the banner shows: the one that has waited longest (a stable choice while others come in), or null. */
export function bannerRequest(requests: Iterable<PermissionRequest>): PermissionRequest | null {
  let best: PermissionRequest | null = null;
  for (const request of requests) {
    if (!best || request.createdAt < best.createdAt || (request.createdAt === best.createdAt && request.requestId < best.requestId)) best = request;
  }
  return best;
}
