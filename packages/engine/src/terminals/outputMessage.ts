/** The most of a command's output that goes to Claude: its end, which is where errors and summaries are. */
export const OUTPUT_MAX_LINES = 200;
export const OUTPUT_MAX_CHARS = 20_000;

// Colours, cursor moves, titles and the like.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Terminal output as text: escape codes gone, and a line redrawn with `\r` (a progress bar) as its last form. */
export function plainText(output: string): string {
  return output
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.includes('\r') ? (line.split('\r').filter(Boolean).at(-1) ?? '') : line))
    .join('\n');
}

/** The end of the output, at most `maxLines` lines and `maxChars` characters, and how many lines there were in all. */
export function outputTail(text: string, maxLines = OUTPUT_MAX_LINES, maxChars = OUTPUT_MAX_CHARS): { text: string; lines: number; kept: number } {
  const lines = text.replace(/\s+$/, '').split('\n');
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  if (lines.length === 0) return { text: '', lines: 0, kept: 0 };
  let kept = lines.slice(-maxLines);
  let joined = kept.join('\n');
  while (joined.length > maxChars && kept.length > 1) {
    kept = kept.slice(1);
    joined = kept.join('\n');
  }
  if (joined.length > maxChars) joined = joined.slice(-maxChars);
  return { text: joined, lines: lines.length, kept: kept.length };
}

/** A fence longer than any run of backticks in `text`, so the output can't close it. */
const fenceFor = (text: string) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

/** The shell a command ran in, as Claude would name it: `PowerShell`, `zsh`, `bash`. */
export function shellName(shell: { file: string; kind: 'posix' | 'powershell' }): string {
  if (shell.kind === 'powershell') return 'PowerShell';
  return shell.file.split(/[\\/]/).at(-1)!.replace(/\.exe$/i, '') || 'sh';
}

export interface CommandRunReport {
  command: string;
  /** The shell it ran in (`shellName`), so Claude writes the next command for it. */
  shell?: string;
  /** A project action's name, when it was one. */
  action?: string;
  exitCode: number;
  /** You pressed Stop before it ended. */
  stopped: boolean;
  /** Everything the run printed, as the terminal got it. */
  output: string;
}

/**
 * The message that tells Claude how a command you ran went: what ran, how it ended and the end of its output. It is
 * your message in the conversation, so it speaks as you.
 */
export function commandRunMessage(run: CommandRunReport): string {
  const command = run.command.trim();
  const inline = !command.includes('\n') && !command.includes('`') && command.length <= 200;
  const what = run.action ? `the project action “${run.action}”` : inline ? `\`${command}\`` : 'this command';
  const ending = run.stopped
    ? `I stopped it before it finished (exit code ${run.exitCode}).`
    : run.exitCode === 0
      ? 'It finished with exit code 0.'
      : `It failed with exit code ${run.exitCode}.`;
  const parts = [`I ran ${what} in the terminal${run.shell ? ` (${run.shell})` : ''}. ${ending}`];
  if (run.action ? true : !inline) {
    const fence = fenceFor(command);
    parts.push(`${fence}${run.shell === 'PowerShell' ? 'powershell' : 'sh'}\n${command}\n${fence}`);
  }
  const tail = outputTail(plainText(run.output));
  if (tail.lines === 0) {
    parts.push('It printed nothing.');
  } else {
    const fence = fenceFor(tail.text);
    parts.push(`${tail.kept < tail.lines ? `The output, last ${tail.kept} of ${tail.lines} lines:` : 'The output:'}\n${fence}text\n${tail.text}\n${fence}`);
  }
  return parts.join('\n\n');
}
