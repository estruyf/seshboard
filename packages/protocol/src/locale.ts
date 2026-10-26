/**
 * A locale `Intl` takes, or undefined for the system's. `Intl` throws a RangeError on a tag it can't parse, and
 * Electron's `app.getLocale()` returns '' when the app ships no locale file for the system's language (the Windows
 * build keeps only English ones), so a locale from outside goes through here before it reaches `Intl.*` or a
 * `toLocale…String` call.
 */
export function safeLocale(locale?: string): string | undefined {
  if (!locale) return undefined;
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}
