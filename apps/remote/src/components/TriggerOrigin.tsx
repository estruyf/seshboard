import { Zap } from 'lucide-react';
import { triggerOriginOf } from '@seshboard/protocol/remote-client';
import { age } from '../lib/groups.ts';

/**
 * Under the header of a session or a run a trigger started (#180), as on the computer: "Started by CI fails on main ·
 * CI #4512 · 14m ago", with the link to the CI run or the issue. Nothing when no trigger started it, or when what the
 * computer sent can't be read.
 */
export function TriggerOrigin({ value, now }: { value: unknown; now: number }) {
  const origin = triggerOriginOf(value);
  if (!origin) return null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 border-b border-border px-5 py-1.5 text-meta text-muted" data-remote-trigger-origin>
      <Zap className="size-3 shrink-0 text-trigger" aria-hidden />
      <span>
        Started by <span className="font-semibold text-text">{origin.name}</span>
      </span>
      <span aria-hidden>·</span>
      {origin.url ? (
        <a href={origin.url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline" data-remote-trigger-link>
          {origin.ref}
        </a>
      ) : (
        <span>{origin.ref}</span>
      )}
      <span aria-hidden>·</span>
      <span>{age(origin.at, now) === 'now' ? 'just now' : `${age(origin.at, now)} ago`}</span>
    </p>
  );
}

/** The bolt after the title of a session or a run a trigger started, on a row or a card; nothing for the rest. */
export function TriggerBolt({ value }: { value: unknown }) {
  const origin = triggerOriginOf(value);
  return origin ? <Zap className="size-3 shrink-0 text-trigger" aria-label={`Started by ${origin.name}`} role="img" data-remote-row-triggered /> : null;
}
