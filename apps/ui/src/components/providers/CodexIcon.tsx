import type { SVGProps } from 'react';

/** OpenAI Codex's mark, in the text colour (`currentColor`) so it follows the theme. Placeholder until the real mark. */
export function CodexIcon({ size = 14, ...rest }: { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" {...rest}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16z" />
    </svg>
  );
}
