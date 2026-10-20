import { ChevronRight } from 'lucide-react';
import { openUpcoming, useUpcoming } from '../../state/upcomingStore.ts';

/** "See all in Upcoming ›" in a card's header (Home, a project's Sessions tab): Upcoming on that card's filter, all projects. */
export function SeeAllInUpcoming({ kind, label = 'See all in Upcoming' }: { kind: 'queue' | 'schedules'; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        useUpcoming.getState().setProject(null);
        openUpcoming({ kind });
      }}
      className="flex shrink-0 items-center gap-0.5 rounded text-meta text-link hover:underline"
      data-see-all-upcoming={kind}
    >
      {label}
      <ChevronRight size={12} aria-hidden />
    </button>
  );
}
