/**
 * Text people may want to copy that isn't marked `.select-text`: error and status messages, and code or
 * command blocks. The window is `user-select: none`, so styles.css opts these back in and main.tsx and
 * SelectionMenu use the same selector to treat them like `.select-text`. Controls are left out, so a click
 * on a button never starts a selection.
 */
export const SELECTABLE = ".select-text, [role='alert'], [role='status'], pre, code";
