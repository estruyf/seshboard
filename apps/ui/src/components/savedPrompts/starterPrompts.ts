/** A prompt Settings › Prompts offers to add with one click. Nothing is added until you press Add. */
export interface StarterPrompt {
  /** Stable, for the Add button's data hook. */
  id: string;
  name: string;
  /** What it is for, one line, shown under the name. */
  description: string;
  /** The prompt, in the saved-prompt syntax (`{{name}}` is a blank). */
  text: string;
}

export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    id: 'best-judgment',
    name: 'Use your best judgment',
    description: 'Stops a session from waiting on small decisions.',
    text: "Just build and use your best judgment. Make any call that's reversible yourself, and check in later with the calls you made.",
  },
  {
    id: 'throwaway-build',
    name: 'Throwaway build',
    description: 'Tests whether a design holds up. Asks for the feature.',
    text: "In a separate worktree, do a throwaway build of {{feature}} on top of this design. Don't polish it, just tell me where the design got in the way.",
  },
];

/** Compares prompts by their text, ignoring the whitespace around it. */
const normal = (text: string) => text.trim();

/** The starters that aren't saved yet: none of `existing` (in any place) has the same text. */
export function pendingStarters(existing: readonly { text: string }[], starters: readonly StarterPrompt[] = STARTER_PROMPTS): StarterPrompt[] {
  const have = new Set(existing.map((p) => normal(p.text)));
  return starters.filter((s) => !have.has(normal(s.text)));
}
