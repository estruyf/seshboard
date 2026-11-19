import { useState } from 'react';
import { MAX_PREVIEW_IMAGE_BYTES, type DiffImage } from '@seshboard/protocol/client';
import { formatBytes, imageFacts, type Size } from '../transcript/imageLayout.ts';

/** One side of an image's diff: the image with its type, size and pixel size under it, or why it doesn't show. */
function Side({ label, image }: { label: string; image: DiffImage }) {
  const [natural, setNatural] = useState<Size | null>(null);
  return (
    <figure className="flex min-w-0 flex-col gap-1.5" data-diff-image={label.toLowerCase()}>
      <figcaption className="flex items-baseline gap-2 font-sans text-meta">
        <span className="font-semibold text-muted">{label}</span>
        {image.mediaType && <span className="truncate text-faint">{imageFacts(image.mediaType, image.size, natural)}</span>}
      </figcaption>
      {image.mediaType && image.data ? (
        <div className="flex items-center justify-center rounded-md bg-text/6 p-2">
          <img
            src={`data:${image.mediaType};base64,${image.data}`}
            alt={label}
            className="max-h-80 max-w-full object-contain"
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
        </div>
      ) : (
        <p className="rounded-md bg-text/6 p-3 font-sans text-meta text-muted">
          {image.size > MAX_PREVIEW_IMAGE_BYTES ? `Too large to show (${formatBytes(image.size)}).` : 'Not an image Seshboard can show.'}
        </p>
      )}
    </figure>
  );
}

/** An image's diff: before and after side by side, stacked in a narrow panel. A new or deleted image shows one side. */
export function DiffImages({ id, before, after }: { id: string; before: DiffImage | null; after: DiffImage | null }) {
  return (
    <div id={id} className="@container/diff mx-1 mb-1 rounded-md bg-bg p-2" data-file-diff data-diff-images="">
      <div className={`grid gap-3 ${before && after ? '@md/diff:grid-cols-2' : ''}`}>
        {before && <Side label={after ? 'Before' : 'Deleted'} image={before} />}
        {after && <Side label={before ? 'After' : 'Added'} image={after} />}
      </div>
    </div>
  );
}
