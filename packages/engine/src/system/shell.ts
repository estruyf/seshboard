import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';

/** The shell terminal tabs and shell actions run in, and how to talk to it. */
export interface UserShell {
  file: string;
  kind: 'posix' | 'powershell';
  /** Arguments for an interactive shell in a terminal tab. */
  interactive: string[];
  /** Arguments that run one command line, with the user's shell config read so aliases and nvm work. */
  run(command: string): string[];
  /** Quotes a value so the shell passes it on as one argument and never runs it as code. */
  quote(value: string): string;
  /** Commands that run one after the other, each only when the one before it succeeded. */
  sequence(commands: string[]): string;
  /**
   * The character that makes `value` unsafe to put in an action, or null when it is safe. Only on Windows, where
   * no quoting is safe for every program (see `windowsUnsafe`).
   */
  unsafe(value: string): string | null;
}

const andAnd = (commands: string[]) => commands.join(' && ');

/**
 * Windows PowerShell 5.1 has no `&&`: each next command runs when `$?` says the last one succeeded, and otherwise
 * the command line ends there with that one's exit code (an `if` that skipped the rest would itself succeed).
 */
const powershell5Sequence = (commands: string[]) => commands.reduce((line, command) => `${line}; if ($?) { ${command} } else { ${EXIT_FAILED} }`);

/** Quotes a value for POSIX shells: `it's` → `'it'\''s'`. */
export const posixQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Quotes a value for PowerShell: `it's` → `'it''s'`. Inside single quotes nothing expands, and PowerShell also
 * ends the string at the typographic single quotes (‘ ’ ‚ ‛), so those are doubled too.
 */
export const powershellQuote = (value: string) => `'${value.replace(/['‘’‚‛]/g, '$&$&')}'`;

/**
 * Quotes a value for Windows PowerShell 5.1. It hands an argument to a program without escaping its double quotes,
 * so `a "b" --amend` arrived as several arguments. They are escaped here the way programs read them (`\"`, with any
 * backslashes before them doubled), and a trailing backslash is doubled when PowerShell wraps the value in quotes
 * for its spaces. PowerShell 7.0 to 7.2 do the same. 7.3 and later escape them themselves: there `powershellQuote`
 * is right.
 */
export const windowsPowershellQuote = (value: string) =>
  powershellQuote(value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, (tail) => (/\s/.test(value) ? tail + tail : tail)));

/** PowerShell 7's version as `[major, minor]`, from the `pwsh.deps.json` next to `pwsh.exe` (`"pwsh/7.4.6"`), or null. */
export function pwshVersion(deps: string | null): [number, number] | null {
  const match = deps ? /"pwsh\/(\d+)\.(\d+)/.exec(deps) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** pwsh.deps.json files read so far: they don't change while the app runs, and each is about 100 KB. */
const depsFiles = new Map<string, string | null>();
const readDeps = (path: string) => {
  if (!depsFiles.has(path)) {
    let text: string | null = null;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      // Not there: a Store install's pwsh.exe is an alias in WindowsApps.
    }
    depsFiles.set(path, text);
  }
  return depsFiles.get(path)!;
};

/**
 * Whether this `pwsh.exe` escapes double quotes in what it hands a program, as PowerShell 7.3 and later do. 7.0 to
 * 7.2 pass them on as Windows PowerShell does. A version that can't be read (a Store install) is taken as current.
 */
const escapesQuotes = (file: string, read: (path: string) => string | null) => {
  const version = pwshVersion(read(win32.join(win32.dirname(file), 'pwsh.deps.json')));
  return !version || version[0] > 7 || (version[0] === 7 && version[1] >= 3);
};

/**
 * What an action may not put in a command on Windows. When an action calls a `.cmd` or `.bat` program (gradlew.bat,
 * mvnw.cmd), `cmd.exe` reads the arguments again, whatever PowerShell's quoting: `&` and `|` would run a command,
 * `%` and `!` expand variables, and `"` ends the quoting. A NUL or a line break cuts the argument short.
 */
const WINDOWS_UNSAFE = /[&|<>^%!"\r\n\0]/;

/** The first character of `value` an action may not use on Windows, or null. */
export const windowsUnsafe = (value: string) => WINDOWS_UNSAFE.exec(value)?.[0] ?? null;

/**
 * After the command, PowerShell's exit code: the program's own when the last one failed (PowerShell would say 1),
 * 1 when a cmdlet failed, else 0, as a POSIX shell reports the last command's.
 */
const EXIT_FAILED = 'exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 })';
const EXIT_CODE = `\nif (-not $?) { ${EXIT_FAILED} }`;

/**
 * The user's shell. On macOS and Linux it is `$SHELL` as a login shell. On Windows there is no `$SHELL`:
 * PowerShell 7 (`pwsh.exe`) when it is on PATH, else the Windows PowerShell every Windows has. A command runs
 * as `-EncodedCommand`, so no quoting between Node, the Windows command line and PowerShell can change it.
 *
 * PowerShell runs with `-ExecutionPolicy Bypass`, for that process only: Windows PowerShell refuses scripts by
 * default, and `npm`, `npx` and `pnpm` are `.ps1` scripts there, so `npm run …` actions and the user's profile
 * would fail. A policy set by Group Policy still wins.
 *
 * Values are quoted for how this PowerShell hands arguments to programs: `powershellQuote` for 7.3 and later, which
 * escape double quotes themselves, `windowsPowershellQuote` for Windows PowerShell and 7.0 to 7.2.
 */
export function userShell(
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  read: (path: string) => string | null = readDeps,
): UserShell {
  if (platform !== 'win32') {
    return { file: env.SHELL || '/bin/zsh', kind: 'posix', interactive: ['-l'], run: (command) => ['-ilc', command], quote: posixQuote, sequence: andAnd, unsafe: () => null };
  }
  const pwsh = (env.PATH ?? '')
    .split(win32.delimiter)
    .filter(Boolean)
    .map((dir) => win32.join(dir, 'pwsh.exe'))
    .find(exists);
  const file = pwsh ?? win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return {
    file,
    kind: 'powershell',
    interactive: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
    run: (command) => ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command + EXIT_CODE, 'utf16le').toString('base64')],
    quote: pwsh && escapesQuotes(pwsh, read) ? powershellQuote : windowsPowershellQuote,
    unsafe: windowsUnsafe,
    // PowerShell 7 has `&&`; the Windows PowerShell every Windows has (5.1) doesn't.
    sequence: pwsh ? andAnd : powershell5Sequence,
  };
}
