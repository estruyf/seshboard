/** What the Explain and Fix items put in the message box: the selected output in a code block under the ask. */
export function terminalPrompt(ask: 'explain' | 'fix', output: string): string {
  const lead = ask === 'explain' ? 'Explain this terminal output:' : 'Fix this error from the terminal:';
  const fence = '`'.repeat(Math.max(3, ...[...output.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${lead}\n\n${fence}\n${output.replace(/\s+$/, '')}\n${fence}\n`;
}
