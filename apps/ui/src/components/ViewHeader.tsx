import type { HTMLAttributes, ReactNode } from 'react';
import { SidebarToggle } from './sidebar/SidebarToggle.tsx';
import { PANE_HEADER } from './ui/paneHeader.ts';

/**
 * The header of a view (Home, Upcoming, Activity, Usage, Browser, New session, Projects): the sidebar toggle, the view's
 * name, then its controls (`children`; give them `no-drag`, the header is the window's drag handle). The same height,
 * padding and title size as a session's header (`PANE_HEADER`), so the toggle and the title sit in one place whatever
 * the view. A view's own heading in its content (Home's greeting, the day in Activity) is an `h2` under it.
 */
export function ViewHeader({ title, children, className = '', ...rest }: { title: ReactNode; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <header className={`${PANE_HEADER} ${className}`} {...rest}>
      <SidebarToggle />
      <h1 className="min-w-0 truncate text-title font-semibold text-text" data-view-title="">
        {title}
      </h1>
      {children}
    </header>
  );
}
