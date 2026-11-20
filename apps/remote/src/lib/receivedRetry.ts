import { useRef } from 'react';
import type { ApiRetry } from '@seshboard/protocol/remote-client';

/**
 * Another computer's API retry with its clock turned into this one's: `at` is when this window first saw it, so the
 * countdown runs from the wait's length instead of from a clock that may be minutes off. Null while it isn't retrying.
 */
export function useReceivedRetry(retry: ApiRetry | null | undefined): ApiRetry | null {
  const seen = useRef<{ key: string; at: number } | null>(null);
  if (!retry) {
    seen.current = null;
    return null;
  }
  const key = `${retry.at}:${retry.attempt}`;
  if (seen.current?.key !== key) seen.current = { key, at: Date.now() };
  return { ...retry, at: seen.current.at };
}
