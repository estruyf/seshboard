import { FOCUS_LIMIT_DEFAULT, FOCUS_LIMIT_MAX, FOCUS_LIMIT_MIN } from '@seshboard/protocol/bridge';

/** The limit is remembered while it's off, so turning it back on keeps the number you chose. */
const LAST_LIMIT_KEY = 'focus.lastLimit';

/** The limit last chosen (Settings or the palette), or the default. */
export const lastLimit = () => {
  try {
    const value = Number(localStorage.getItem(LAST_LIMIT_KEY));
    return value >= FOCUS_LIMIT_MIN && value <= FOCUS_LIMIT_MAX ? value : FOCUS_LIMIT_DEFAULT;
  } catch {
    return FOCUS_LIMIT_DEFAULT;
  }
};

export const rememberLimit = (limit: number) => {
  try {
    localStorage.setItem(LAST_LIMIT_KEY, String(limit));
  } catch {
    // Remembering is a convenience.
  }
};
