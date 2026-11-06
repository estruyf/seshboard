/** New session's three layouts, by the width of its content (the view less its padding). */
export type NewSessionMode = 'three' | 'two' | 'stack';

export interface NewSessionLayout {
  mode: NewSessionMode;
  /** The projects' column; null when stacked, where everything is one column. */
  left: number | null;
  /** The message box's column. */
  centre: number;
  /** The context's column; null when it sits under the box. */
  right: number | null;
  /** Between the columns. */
  gap: number;
}

export const THREE_COLUMNS_FROM = 1120;
export const TWO_COLUMNS_FROM = 780;
/** The content stops growing here (a 1920 window with the sidebar open), and centres in the view after. */
export const CONTENT_MAX = 1540;
export const SIDE_MIN = 280;
export const SIDE_MAX = 320;
export const COLUMN_GAP = 32;
export const VIEW_PADDING = 40;
export const VIEW_PADDING_NARROW = 24;
/** Below this view width the padding is `VIEW_PADDING_NARROW`. */
export const NARROW_VIEW = 780;

/**
 * The layouts as container queries on the view (`@container/new-session`), so the sidebar and side panels count. A
 * container query only sees the view's width, so the breakpoints are the content's plus the padding: 860 and 1200 are
 * 780 and 1120 of content, 1620 is the most content there is, and the sides grow by 40px over the 420px from 1120 to
 * 1540 of content. A test keeps these in step with `newSessionLayout`.
 */
export const NEW_SESSION_GRID =
  'mx-auto my-auto grid w-full max-w-[1620px] grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12 @min-[780px]/new-session:px-10 ' +
  '@min-[860px]/new-session:my-0 @min-[860px]/new-session:min-h-0 @min-[860px]/new-session:flex-1 @min-[860px]/new-session:grid-cols-[280px_minmax(0,1fr)] @min-[860px]/new-session:grid-rows-[minmax(0,auto)_minmax(auto,1fr)] @min-[860px]/new-session:gap-x-8 @min-[860px]/new-session:gap-y-4 @min-[860px]/new-session:pb-6 ' +
  '@min-[1200px]/new-session:grid-cols-[clamp(280px,calc(280px+(100cqw-1200px)*0.0952381),320px)_minmax(0,1fr)_clamp(280px,calc(280px+(100cqw-1200px)*0.0952381),320px)] @min-[1200px]/new-session:grid-rows-[minmax(0,1fr)]';

/**
 * Home's width and padding: New session's, so nothing jumps going from one to the other. The same numbers as
 * `NEW_SESSION_GRID`, for Home's own `@container`. A test keeps them in step.
 */
export const HOME_WIDTH = 'max-w-[1620px] px-6 @min-[780px]:px-10';

/** The content's width in a view this wide. */
export function contentWidthOf(viewWidth: number): number {
  return viewWidth - 2 * (viewWidth < NARROW_VIEW ? VIEW_PADDING_NARROW : VIEW_PADDING);
}

/**
 * Which layout a content width gets, and its columns: three from 1120px, two from 780px, stacked below. The CSS lays
 * it out (`NEW_SESSION_GRID`); this is for what code needs to know, such as how many projects show.
 */
export function newSessionLayout(contentWidth: number): NewSessionLayout {
  const content = Math.min(contentWidth, CONTENT_MAX);
  if (content >= THREE_COLUMNS_FROM) {
    const side = SIDE_MIN + ((content - THREE_COLUMNS_FROM) / (CONTENT_MAX - THREE_COLUMNS_FROM)) * (SIDE_MAX - SIDE_MIN);
    return { mode: 'three', left: side, centre: content - 2 * side - 2 * COLUMN_GAP, right: side, gap: COLUMN_GAP };
  }
  if (content >= TWO_COLUMNS_FROM) return { mode: 'two', left: SIDE_MIN, centre: content - SIDE_MIN - COLUMN_GAP, right: null, gap: COLUMN_GAP };
  return { mode: 'stack', left: null, centre: content, right: null, gap: 0 };
}

/** The most projects the column lists: as far as ⌘9 reaches. */
const MOST_PROJECTS = 9;
/** Fewer than this in a very short window would hide the list: it scrolls instead. */
const FEWEST_PROJECTS = 3;

/** How many project rows the column shows in this much height: as many as fit, from 3 up to 9. */
export function projectsThatFit(height: number, rowHeight: number, gap: number): number {
  const fits = Math.floor((height + gap) / (rowHeight + gap));
  return Math.min(MOST_PROJECTS, Math.max(FEWEST_PROJECTS, fits));
}
