import { describe, expect, it } from 'vitest';
import type { PermissionRequest } from '@seshboard/protocol/client';
import { bannerRequest } from './needsYou.ts';

const request = (requestId: string, createdAt: number) => ({ requestId, createdAt }) as PermissionRequest;

describe('the needs-you banner', () => {
  it('shows nothing when nothing waits', () => {
    expect(bannerRequest([])).toBeNull();
  });

  it('shows the request that has waited longest', () => {
    expect(bannerRequest([request('b', 30), request('a', 10), request('c', 20)])?.requestId).toBe('a');
  });

  it('breaks a tie by id, so the choice does not flip', () => {
    expect(bannerRequest([request('z', 5), request('m', 5)])?.requestId).toBe('m');
  });
});
