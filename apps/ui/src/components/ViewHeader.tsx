import type { HTMLAttributes, ReactNode } from 'react';
import { PANE_HEADER } from './ui/paneHeader.ts';

/**
 * The header of a view (Home, Upcoming, Activity, Usage, Browser, New session, Projects): the view's name, then its
 * controls (`children`; give them `no-drag`, the header is a window drag handle). The same height, padding and title
 * size as a session's header (`PANE_HEADER`), so the title sits in one place whatever the view. A view's own heading in its content (Home's greeting, the day in Activity) is an `h2` under it.
 */
export function ViewHeader({ title, children, className = '', ...rest }: { title: ReactNode; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <header className={`${PANE_HEADER} ${className}`} {...rest}>
      <h1 className="min-w-0 truncate text-title font-semibold text-text" data-view-title="">
        {title}
      </h1>
      {children}
    </header>
  );
}
