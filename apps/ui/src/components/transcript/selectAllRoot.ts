/** What the choice of area for Select all needs of a clean-copy root: it can tell whether another element is inside it. */
export interface RootLike {
  contains(other: RootLike | null): boolean;
}

export interface SelectAllInput<T extends RootLike> {
  /** Focus (or the key's target) is in a text field, the message box or the terminal, which select their own text. */
  fieldFocused: boolean;
  /** The clean-copy area that holds the current selection, if any. */
  selection: T | null;
  /** The one the last pointer-down landed in. */
  pointer: T | null;
  /** The one that holds the focused element. */
  focus: T | null;
  /** When nothing above points at an area, the one on top (reading mode's), if there is one. */
  fallback?: T | null;
  /** Open dialogs, menus, listboxes and popovers. */
  overlays: readonly T[];
}

/** An open overlay that has nothing to do with `root`: it is neither inside the area nor around it (the file preview's dialog holds its own). */
export const overlayBlocks = <T extends RootLike>(root: T, overlays: readonly T[]) => overlays.some((overlay) => !root.contains(overlay) && !overlay.contains(root));

/**
 * The area Select all (⌘A) selects, as an editor does: the one that holds the selection, else the one last clicked in, else the one
 * that holds focus, else the area on top. Null leaves ⌘A to the browser: in a field or the terminal, with no such area, or while a
 * dialog, menu or list is open that does not belong to the area (⌘A then belongs to it).
 */
export function selectAllRoot<T extends RootLike>({ fieldFocused, selection, pointer, focus, fallback = null, overlays }: SelectAllInput<T>): T | null {
  if (fieldFocused) return null;
  const root = selection ?? pointer ?? focus ?? fallback;
  if (!root || overlayBlocks(root, overlays)) return null;
  return root;
}
