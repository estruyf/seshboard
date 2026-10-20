/**
 * Commands in a few words, for the steps of the conversation and the catch-up's lines: plain TypeScript, so the
 * renderer and the engine share it.
 */

/** Programs that run a script given inline, named the way a person would say it. */
const SCRIPTS: Record<string, string> = {
  python: 'a Python script',
  python3: 'a Python script',
  node: 'a Node script',
  bun: 'a Bun script',
  deno: 'a Deno script',
  ruby: 'a Ruby script',
  perl: 'a Perl script',
  php: 'a PHP script',
  osascript: 'an AppleScript',
  bash: 'a shell script',
  sh: 'a shell script',
  zsh: 'a shell script',
  pwsh: 'a PowerShell script',
  powershell: 'a PowerShell script',
};

/**
 * What a command without a description runs. A short one-line command is shown as
 * written ("npm test"); a long one, a heredoc or an inline script by what it starts
 * ("a Python script", "git"), since its text means nothing in one line.
 */
export function commandLabel(command: string): string {
  // `cd somewhere && …` only says where it runs.
  const text = command.trim().replace(/^(cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/, '');
  const firstLine = text.split('\n')[0]!.trim();
  if (firstLine === text && !firstLine.includes('<<') && firstLine.length <= 60) return firstLine;
  // Skip `FOO=1`, `sudo`, `env` and `time` to the program itself.
  const words = firstLine.split(/\s+/);
  const program = words.find((w) => !/^\w+=/.test(w) && !/^(sudo|env|time|exec|command)$/.test(w)) ?? '';
  const name = program.split('/').at(-1)!.replace(/\.exe$/i, '').toLowerCase();
  const runner = SCRIPTS[name] ?? SCRIPTS[name.replace(/[\d.]+$/, '')];
  if (runner) return runner;
  return /^[\w.-]+$/.test(name) ? name : 'a command';
}
