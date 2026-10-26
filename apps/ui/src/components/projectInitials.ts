/**
 * The letters on a project's tile when it has no icon: one, or two for projects on another computer, where the name is
 * all there is to tell them apart. Two are the first letters of the first two words ("Demo Time" → DT,
 * "pf-app-customizer" → PA), or of a single word's humps ("EngageTime" → ET, "FM" → FM); a word without any is one
 * letter ("switchboard" → S). Always upper case; "·" for a name without letters or digits.
 */
export function projectInitials(name: string, count: 1 | 2 = 1): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = words[0];
  if (!first) return '·';
  if (count === 1) return first.charAt(0).toUpperCase();
  if (words.length >= 2) return (first.charAt(0) + words[1]!.charAt(0)).toUpperCase();
  // One word: its first letter and the next capital (camelCase, PascalCase, an acronym).
  const capital = [...first.slice(1)].find((c) => /\p{Lu}/u.test(c));
  return (first.charAt(0) + (capital ?? '')).toUpperCase();
}
