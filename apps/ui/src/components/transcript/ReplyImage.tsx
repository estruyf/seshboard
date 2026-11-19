import type { ReactNode } from 'react';

/**
 * An image in a reply. One whose address `fileUrlTransform` blocked (a share, a relative path) arrives with an empty `src`:
 * it shows its alt text, as an image does in another computer's transcript, instead of an `<img>` that loads nothing.
 */
export function ReplyImage({ src, alt }: { src?: string | Blob; alt?: string }): ReactNode {
  if (typeof src !== 'string' || !src) return alt ? <span className="text-muted">[{alt}]</span> : null;
  // A full-size screenshot stays inside the column, in its proportions.
  return <img src={src} alt={alt ?? ''} className="h-auto max-w-full" />;
}
