/** The next question without an answer: after `from` first, then from the top. Never `from` itself. */
export function nextOpenQuestion(answered: boolean[], from: number): number | undefined {
  for (let i = from + 1; i < answered.length; i++) if (!answered[i]) return i;
  for (let i = 0; i < from && i < answered.length; i++) if (!answered[i]) return i;
  return undefined;
}
