/**
 * The look of a field in a form (settings, dialogs): an input, a text area or a dropdown. The `field` utility in
 * styles.css draws its edge in `field-border` (3:1 against every surface), darker on hover, in the accent ink when
 * focused or open, and it keeps all of that in Minimal mode. Add the size: `${FIELD} h-7 px-2.5 text-ui`.
 * `fields.test.ts` fails on a form field drawn with its own border instead.
 */
export const FIELD = 'field outline-none placeholder:text-faint';
