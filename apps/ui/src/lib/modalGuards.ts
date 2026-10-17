/** A dialog, menu or popover is open: it keeps Tab for itself, so ⌃⇥ doesn't switch sessions behind it. */
export const overlayOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-popover]') !== null;

/** The palette, Search and the shortcuts sheet: their shortcuts close them or switch between them. */
const OWN_OVERLAYS = '[data-command-palette], [data-search], [data-shortcuts-sheet]';

/**
 * Another modal is open (Add context, Rename session…). The palette, Search and the shortcuts sheet would
 * open under it, half hidden, and take the keys, so their shortcuts do nothing until it closes.
 */
export const otherModalOpen = () => Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => !el.matches(OWN_OVERLAYS));
