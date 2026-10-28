import { Puzzle } from 'lucide-react';
import type { ReactNode } from 'react';
import { MOD_LIMITS } from '@seshboard/protocol/client';
import { RpcError } from '@seshboard/protocol/client';
import { toast } from '../../state/toastStore.ts';
import type { ModRenderError } from './useModRender.ts';

/**
 * The frame around everything a mod draws: a 24px header with the puzzle icon and the mod's name, a 1px border and a
 * 10px radius, the body on `card`. The header is Seshboard's, so a mod can never draw its own or pass for one of
 * Seshboard's cards (it never has the pink frame of a permission card).
 */
export function ModFrame({
  plugin,
  title,
  end,
  error,
  onRetry,
  bodyClassName = '',
  children,
  ...data
}: {
  plugin: string;
  /** The header's text; the mod's name when left out. */
  title?: ReactNode;
  /** What sits on the right of the header: the kind of surface, or Show the built-in view. */
  end?: ReactNode;
  error?: ModRenderError | null;
  onRetry?(): void;
  bodyClassName?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[10px] border border-border bg-card text-body text-text" data-mod-frame={plugin} aria-label={`From ${plugin}`} {...data}>
      <header className="flex h-6 items-center gap-1.5 border-b border-border px-2.5 text-meta text-muted select-none">
        <Puzzle size={11} className="shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{title ?? plugin}</span>
        {end && <span className="ml-auto flex shrink-0 items-center">{end}</span>}
      </header>
      <div className={`min-w-0 px-2.5 py-2 ${bodyClassName}`}>{error ? <ModError plugin={plugin} error={error} onRetry={onRetry} /> : children}</div>
    </section>
  );
}

/** A press, an input or a pick that Claude Code didn't take: said in a toast with the mod's name. */
export function modActionFailed(plugin: string, error: unknown): void {
  if (error instanceof RpcError && error.code === 'MODS_OFF') return;
  const text = error instanceof RpcError && error.code === 'MOD_TIMEOUT' ? `${plugin} didn't answer in ${MOD_LIMITS.requestMs / 1000}s.` : `${plugin} couldn't do that.`;
  toast(text, { source: plugin, data: { 'data-mod-error-toast': plugin } });
}

/** A request that failed shows in its frame, never as a blank one. */
export function ModError({ plugin, error, onRetry }: { plugin: string; error: ModRenderError; onRetry?(): void }) {
  return (
    <p className="text-ui text-muted" role="status" data-mod-error={error.kind}>
      {error.kind === 'timeout' ? `${plugin} didn't answer in ${MOD_LIMITS.requestMs / 1000}s.` : `${plugin} couldn't draw this.`}{' '}
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-sm font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring" data-mod-retry>
          Try again
        </button>
      )}
    </p>
  );
}
