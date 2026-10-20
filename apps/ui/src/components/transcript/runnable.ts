/** Fenced-block languages that are shell commands, so the block gets a Run button. */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'shellsession', 'terminal']);
/** On Windows the terminal runs PowerShell, so its blocks run as written too. */
const POWERSHELL_LANGUAGES = new Set(['powershell', 'pwsh', 'ps1', 'ps', 'posh']);

/** Whether a code block in this language can be run in the session's terminal on `platform`. */
export function isRunnable(language: string | undefined, platform: string): boolean {
  if (language === undefined) return false;
  const name = language.toLowerCase();
  return SHELL_LANGUAGES.has(name) || (platform === 'win32' && POWERSHELL_LANGUAGES.has(name));
}

/** A prompt line of a transcript: `$ npm test`, or PowerShell's `PS C:\repo> npm test`. */
const PROMPT = /^\s*(?:\$|PS [^>\n]*>) /;

/**
 * What to type into the shell for a block: in a transcript-style block (`console`, or lines that
 * start with `$ ` or a PowerShell prompt) only the prompt lines, without the prompt, since the rest
 * is output. Blank lines and trailing whitespace are dropped. Empty when there is nothing to run.
 */
export function commandToRun(code: string): string {
  const lines = code.split('\n').map((line) => line.trimEnd());
  const prompted = lines.filter((line) => PROMPT.test(line));
  const commands = prompted.length > 0 ? prompted.map((line) => line.replace(PROMPT, '')) : lines;
  return commands.filter((line) => line.trim() !== '').join('\n');
}
