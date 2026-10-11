/**
 * Running a `.cmd` or `.bat` on Windows, such as the `code.cmd` VS Code puts on PATH. Node won't start one without a
 * shell, and `cmd.exe` reads its command line by rules of its own (`&`, `|`, `%VAR%`, `^`…), so a file name could
 * otherwise run a command. Every argument is quoted for the program and its special characters escaped for
 * `cmd.exe`, twice for a `.cmd`/`.bat` (which `cmd.exe` reads a second time), the way the cross-spawn package does.
 */

/** What `cmd.exe` treats specially, escaped with `^`. */
const META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument: quoted by the rules programs read their command line with, then escaped for `cmd.exe`. */
export function cmdArgument(arg: string, doubleEscape: boolean): string {
  // Backslashes before a quote are doubled and the quote escaped; trailing ones too, as the closing quote follows.
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  quoted = `"${quoted}"`.replace(META, '^$1');
  return doubleEscape ? quoted.replace(META, '^$1') : quoted;
}

/** Whether `file` must be run through `cmd.exe`: a batch file. */
export const needsCmd = (file: string) => /\.(cmd|bat)$/i.test(file);

/**
 * The program and arguments that run `file` with `args` through `cmd.exe`, unchanged; spawn it with `windowsVerbatimArguments`.
 * `/d` skips AutoRun commands, and `/v:off` turns off delayed expansion, which a user may have turned on for every
 * `cmd.exe` in the registry: with it, `!PATH!` in a file name would become the value of PATH.
 */
export function viaCmd(file: string, args: readonly string[], env: Record<string, string | undefined>): { command: string; args: string[] } {
  const line = [file.replace(META, '^$1'), ...args.map((arg) => cmdArgument(arg, needsCmd(file)))].join(' ');
  return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', `"${line}"`] };
}
