import type { ReactNode } from 'react';

/** A section's title on Settings › Theme, with the line under it and its buttons on the right. */
export function Heading({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-body font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-ui text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
