/**
 * Smoke steps and the screenshot tour press the app's main modifier (the registry's `mod`) as `'meta'`, the way they
 * were written on macOS. That is ⌘ there and Ctrl elsewhere, so a step runs the same shortcut on every platform.
 */
export const MOD_MODIFIER = process.platform === 'darwin' ? 'meta' : 'control';

/** The same for a DOM event made in the page: `metaKey` on macOS, `ctrlKey` elsewhere. */
export const MOD_KEY_PROPERTY = process.platform === 'darwin' ? 'metaKey' : 'ctrlKey';

/** Modifiers for `sendInputEvent`, with `'meta'` read as the platform's main modifier. */
export const platformModifiers = <T extends string>(modifiers: readonly T[]): Array<T | 'control'> => modifiers.map((m) => (m === 'meta' ? (MOD_MODIFIER as T | 'control') : m));
