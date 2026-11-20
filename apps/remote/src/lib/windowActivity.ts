/**
 * The phone has no window to put in the background (the app's `apps/ui/src/lib/windowActivity.ts` pauses the animations
 * that never end while its window is not in front), so it is always active here. `WorkingPanel` is a copy of the app's
 * and reads this.
 */
export const useWindowActive = (): boolean => true;
