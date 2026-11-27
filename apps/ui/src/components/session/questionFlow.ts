/** The next question without an answer: after `from` first, then from the top. Never `from` itself. */
export function nextOpenQuestion(answered: boolean[], from: number): number | undefined {
  for (let i = from + 1; i < answered.length; i++) if (!answered[i]) return i;
  for (let i = 0; i < from && i < answered.length; i++) if (!answered[i]) return i;
  return undefined;
}

/** The answers after a click on `label`: a picked answer is let go, a new one joins a multi-select or replaces a single choice. */
export function toggleAnswer(picked: readonly string[], label: string, multi: boolean): string[] {
  if (picked.includes(label)) return picked.filter((l) => l !== label);
  return multi ? [...picked, label] : [label];
}
