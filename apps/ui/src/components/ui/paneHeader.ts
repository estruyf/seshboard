/**
 * The 52px header over a session, a remote session, a computer or a project: no border, only the
 * scroll-edge hairline (`edge-b`) while the content scrolls under it, so set `data-scrolled` from
 * `useScrollEdge` on the view's scroller. Shared so the headers stay in step.
 */
export const PANE_HEADER = 'drag edge-b flex h-13 shrink-0 items-center gap-3 overflow-hidden px-6 @max-[860px]:gap-2 @max-[860px]:px-4';
