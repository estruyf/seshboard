import type { ComponentProps, ReactNode } from 'react';
import { Home } from './Home.tsx';

/**
 * A phone's Home, from the drawer's Home row: what needs you, what finished and every profile's full usage cards, as
 * the wide layout's Home. Its header keeps the drawer button where a session's has it.
 */
export function PhoneHome({ lead, banner, ...home }: { lead: ReactNode; banner: ReactNode } & ComponentProps<typeof Home>) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-remote-phone-home>
      <header className="safe-top flex items-center gap-2 border-b border-border bg-bg px-2 pb-2">
        {lead}
        <h1 className="min-w-0 flex-1 truncate text-title font-semibold">Home</h1>
      </header>
      {banner}
      <div className="min-h-0 flex-1">
        <Home {...home} />
      </div>
    </div>
  );
}
