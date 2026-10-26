import type { ThemeMode, ThemeTokens } from '@seshboard/protocol/theme-format';

/**
 * A window in miniature, drawn with a theme's own tokens (so each card shows its theme, whatever is
 * active): the sidebar with a selected row, a few lines of conversation, and the message box with
 * its accent button. `tokens: null` is a mode the theme doesn't have: hatched, and labelled with
 * what shows instead.
 */
export function ThemePreview({ tokens, mode, missingLabel = `Demo Time ${mode}`, className = '' }: { tokens: ThemeTokens | null; mode: ThemeMode; missingLabel?: string; className?: string }) {
  if (!tokens)
    return (
      <div
        className={`flex items-center justify-center overflow-hidden rounded-[7px] border border-edge px-2 text-center text-meta text-faint ${className}`}
        style={{ background: 'repeating-linear-gradient(135deg, var(--sb-border) 0 6px, transparent 6px 12px)' }}
        data-theme-preview={mode}
        data-missing
      >
        {missingLabel}
      </div>
    );
  // Values are validated colours (see parseColor), so they are safe in a style attribute.
  const line = (width: string, color: string, opacity = 1) => <div className="h-[6px] rounded-full" style={{ width, background: color, opacity }} />;
  return (
    <div className={`flex overflow-hidden rounded-[7px] ${className}`} style={{ background: tokens.bg, boxShadow: `inset 0 0 0 1px ${tokens.border}` }} data-theme-preview={mode} aria-hidden>
      <div className="flex w-[31%] shrink-0 flex-col gap-[5px] px-[5px] pt-2" style={{ background: tokens.sidebar }}>
        <div className="h-3 rounded-[3px]" style={{ background: tokens.selected, boxShadow: `inset 2px 0 0 ${tokens['accent-ink']}` }} />
        {line('100%', tokens.faint, 0.6)}
        {line('60%', tokens.faint, 0.6)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px] px-1.5 pt-2.5 pb-1.5">
        {line('70%', tokens.text)}
        {line('55%', tokens.muted, 0.55)}
        {line('62%', tokens.muted, 0.55)}
        <div className="mt-auto flex items-center gap-1 rounded-[5px] p-1" style={{ background: tokens.card, boxShadow: `inset 0 0 0 1px ${tokens.border}` }}>
          <div className="h-1 flex-1 rounded-sm" style={{ background: tokens.faint, opacity: 0.5 }} />
          <div className="h-[9px] w-[18px] rounded-[3px]" style={{ background: tokens.accent }} />
        </div>
      </div>
    </div>
  );
}
