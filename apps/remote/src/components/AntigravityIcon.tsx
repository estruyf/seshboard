import type { SVGProps } from 'react';

/**
 * Google Antigravity's mark: an arch, drawn for Seshboard (not Google's own artwork), in the text colour
 * (`currentColor`) so it follows the theme.
 */
export function AntigravityIcon({ size = 14, ...rest }: { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" {...rest}>
      <path d="M12 2.5c-1.6 0-2.9 1-3.6 2.7L2.3 19.6c-.5 1.2.4 2.4 1.6 2.1 1.1-.3 1.9-1.1 2.4-2.2l3.9-8.9c.4-.9 1-1.4 1.8-1.4s1.4.5 1.8 1.4l3.9 8.9c.5 1.1 1.3 1.9 2.4 2.2 1.2.3 2.1-.9 1.6-2.1L15.6 5.2C14.9 3.5 13.6 2.5 12 2.5z" />
    </svg>
  );
}
