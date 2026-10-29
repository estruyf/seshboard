import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { ShellCommandState } from '@seshboard/protocol/bridge';

/**
 * The shell commands Seshboard installs: `seshboard .` opens New session in that folder, like `code .`. `sesh` is its
 * short form, and `switchboard` the app's name before the rename, which betas of 1.2.0 installed. `sesh` is also a
 * tmux session manager's command: where another program has the name, it is skipped.
 */
export const SHELL_COMMAND_NAMES = ['seshboard', 'sesh', 'switchboard'] as const;

/** `a`, `a and b`, `a, b and c`. */
const listed = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? ''));
/** In every script Seshboard writes, so it can tell its own from another program's file with the same name. */
const MARKER = 'Written by Seshboard (Settings › General › Shell command), which updates or removes it.';

/** Where the commands go: a folder on the PATH, or (Windows) one Seshboard adds to the user's PATH. */
export function shellCommandDir(platform: string, places: { home: string; userData: string }): string {
  if (platform === 'darwin') return '/usr/local/bin';
  if (platform === 'win32') return path.win32.join(places.userData, 'bin');
  return path.posix.join(places.home, '.local', 'bin');
}

/** The file of one command in `dir`: a `.cmd` on Windows, a script without an extension elsewhere. */
export function shellCommandFile(platform: string, dir: string, name: string): string {
  return platform === 'win32' ? path.win32.join(dir, `${name}.cmd`) : path.posix.join(dir, name);
}

/** Quotes a value for sh: in single quotes, each `'` closed, escaped and reopened. */
const shQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The script for one command. `target` is what it opens: the app bundle on macOS (`open -a`, which hands a running
 * Seshboard the link), the executable elsewhere, which passes the folder to a running Seshboard and exits.
 * `env` is only read on Windows, to write the executable's folder as `%LOCALAPPDATA%\…`: a `.cmd` is read in the
 * console's code page, which can't spell every user name.
 */
export function shellCommandScript(platform: string, name: string, target: string, env: Record<string, string | undefined> = {}): string {
  if (platform === 'win32') {
    const inLocal = env.LOCALAPPDATA ? path.win32.relative(env.LOCALAPPDATA, target) : '';
    const exe = inLocal && !inLocal.startsWith('..') && !path.win32.isAbsolute(inLocal) ? `%LOCALAPPDATA%\\${inLocal.replaceAll('%', '%%')}` : target.replaceAll('%', '%%');
    return [
      '@echo off',
      `rem ${name}: opens New session in Seshboard for a folder, the current one by default (${name} .).`,
      `rem ${MARKER}`,
      'setlocal',
      'if "%~1"=="-h" goto usage',
      'if "%~1"=="--help" goto usage',
      'if not "%~2"=="" goto usage',
      'if "%~1"=="" (set "dir=%CD%") else (set "dir=%~f1")',
      'if not exist "%dir%\\*" goto notfolder',
      // A path ending in \ would escape the closing quote: C:\ goes as C:\. instead.
      'if "%dir:~-1%"=="\\" set "dir=%dir%."',
      `start "" "${exe}" "%dir%"`,
      'exit /b 0',
      ':notfolder',
      // Quoted: unquoted, `R&D` would echo `R` and run `D`.
      `echo ${name}: "%~1" is not a folder 1>&2`,
      'exit /b 1',
      ':usage',
      `echo Usage: ${name} [folder]`,
      'echo Opens New session in Seshboard for the folder, the current one by default.',
      'exit /b 0',
      '',
    ].join('\r\n');
  }
  // macOS hands the folder over as a seshboard:// link, through Launch Services, so a running Seshboard takes it
  // and permission prompts name Seshboard rather than the terminal. Each byte goes as %XX, so any name survives.
  // Elsewhere the executable gets the folder; started on its own, it leaves the terminal free.
  const open =
    platform === 'darwin'
      ? [`cwd=$(printf '%s' "$dir" | od -An -v -tx1 | tr -d ' \\n' | sed 's/../%&/g')`, `exec open -a ${shQuote(target)} "seshboard://new-session?cwd=$cwd"`]
      : [`nohup ${shQuote(target)} "$dir" >/dev/null 2>&1 &`];
  return [
    '#!/bin/sh',
    `# ${name}: opens New session in Seshboard for a folder, the current one by default (${name} .).`,
    `# ${MARKER}`,
    'case "$1" in',
    `  -h|--help) echo "Usage: ${name} [folder]"; echo "Opens New session in Seshboard for the folder, the current one by default."; exit 0 ;;`,
    'esac',
    `[ $# -le 1 ] || { echo "Usage: ${name} [folder]" >&2; exit 2; }`,
    'folder=${1:-.}',
    `[ -d "$folder" ] || { echo "${name}: $folder is not a folder" >&2; exit 1; }`,
    // The physical path, as Claude Code keys its sessions by it. CDPATH would make cd print the folder.
    'dir=$(CDPATH= cd -- "$folder" && pwd -P) || exit 1',
    ...open,
    '',
  ].join('\n');
}

/** What is in one command's file: nothing, this exact script, an older one of Seshboard's, or another program's. */
export function readCommandFile(file: string, expected: string): 'missing' | 'current' | 'outdated' | 'taken' {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return 'missing';
  }
  if (text === expected) return 'current';
  return text.includes(MARKER) ? 'outdated' : 'taken';
}

/** Where to install and what each file holds. */
export interface ShellCommandPlan {
  platform: string;
  dir: string;
  /** What the scripts start: another program's command is never this. */
  target: string;
  files: { name: string; file: string; script: string }[];
  /** Other folders where a command of the same name would win or lose against ours: the PATH and the usual bin folders. */
  lookIn: string[];
}

/**
 * The usual folders for commands besides the PATH, which a GUI app on macOS gets without Homebrew's or Go's: a
 * Homebrew `sesh` (a tmux session manager) is in /opt/homebrew/bin on Apple silicon, a `go install` one in ~/go/bin.
 */
export function commandFolders(platform: string, home: string, pathVariable: string | undefined): string[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const fromPath = (pathVariable ?? '').split(platform === 'win32' ? ';' : ':').filter((dir) => dir && paths.isAbsolute(dir));
  const usual = platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', paths.join(home, '.local', 'bin'), paths.join(home, 'go', 'bin'), paths.join(home, 'bin')];
  return [...new Set([...fromPath, ...usual])];
}

export function shellCommandPlan(platform: string, dir: string, target: string, env: Record<string, string | undefined> = {}, lookIn: string[] = []): ShellCommandPlan {
  return {
    platform,
    dir,
    target,
    files: SHELL_COMMAND_NAMES.map((name) => ({ name, file: shellCommandFile(platform, dir, name), script: shellCommandScript(platform, name, target, env) })),
    lookIn,
  };
}

const realPath = (file: string) => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

/**
 * Another program's command of this name in the other folders, or null. Seshboard's own executable doesn't count
 * (a Linux package puts it on the PATH as `seshboard`), nor a script Seshboard wrote.
 */
function otherCommand(plan: ShellCommandPlan, entry: ShellCommandPlan['files'][number]): string | null {
  const paths = plan.platform === 'win32' ? path.win32 : path.posix;
  const same = plan.platform === 'win32' ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase() : (a: string, b: string) => a === b;
  const files = plan.platform === 'win32' ? ['.exe', '.cmd', '.bat'].map((ext) => entry.name + ext) : [entry.name];
  const ours = realPath(plan.target);
  for (const dir of plan.lookIn) {
    if (same(paths.resolve(dir), paths.resolve(plan.dir))) continue;
    for (const name of files) {
      const file = paths.join(dir, name);
      try {
        if (!statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      if (same(realPath(file), ours) || readCommandFile(file, entry.script) !== 'taken') continue;
      return file;
    }
  }
  return null;
}

/**
 * One command: its own file's state, or `taken` with the other program's file. A command elsewhere only counts while
 * Seshboard's own isn't there yet: one it already wrote stays its own, to update or remove.
 */
function commandState(plan: ShellCommandPlan, entry: ShellCommandPlan['files'][number]): { state: ReturnType<typeof readCommandFile>; takenBy?: string } {
  const state = readCommandFile(entry.file, entry.script);
  if (state === 'taken') return { state, takenBy: entry.file };
  if (state !== 'missing') return { state };
  const other = otherCommand(plan, entry);
  return other ? { state: 'taken', takenBy: other } : { state };
}

/** The plan without the names another program has, which are never written or removed. */
function ownFiles(plan: ShellCommandPlan): ShellCommandPlan['files'] {
  return plan.files.filter((entry) => commandState(plan, entry).state !== 'taken');
}

/**
 * How the commands stand, leaving out names another program has: installed when each of the others is this build's
 * script (and, on Windows, the folder is on the PATH).
 */
export async function readShellCommand(plan: ShellCommandPlan, onPath: () => Promise<boolean> = async () => true): Promise<ShellCommandState> {
  const all = plan.files.map((entry) => ({ entry, ...commandState(plan, entry) }));
  const states = all.filter((s) => s.state !== 'taken');
  const base = { names: states.map((s) => s.entry.name), dir: plan.dir, taken: all.flatMap((s) => (s.takenBy ? [s.takenBy] : [])) };
  if (!states.length) return { ...base, status: 'taken' };
  if (states.every((s) => s.state === 'missing')) return { ...base, status: 'missing' };
  if (states.some((s) => s.state !== 'current')) return { ...base, status: 'outdated' };
  return (await onPath()) ? { ...base, status: 'installed' } : { ...base, status: 'outdated' };
}

/** Whether this process can write in `dir` (creating it if needed) without asking for an administrator. */
function canWrite(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: env ?? process.env, timeout: 120_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: String(stderr) }));
      else resolve(String(stdout));
    });
  });
}

/** Thrown when the user cancels the administrator prompt; nothing changed then. */
export class Cancelled extends Error {}

/**
 * Runs a shell command as an administrator through macOS's own password prompt, for a folder this user can't write
 * (/usr/local/bin belongs to root on a fresh Mac).
 */
async function asAdministrator(command: string, prompt: string): Promise<void> {
  const quote = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  try {
    await run('/usr/bin/osascript', ['-e', `do shell script ${quote(command)} with prompt ${quote(prompt)} with administrator privileges`]);
  } catch (error) {
    // -128 is "User canceled."
    if (String((error as { stderr?: string }).stderr).includes('-128')) throw new Cancelled('Cancelled');
    throw error;
  }
}

/**
 * The PowerShell that reads, adds or removes `$env:SESHBOARD_BIN_DIR` in the user's PATH. It goes through the
 * registry, not [Environment]::SetEnvironmentVariable, so the other entries keep their %VARIABLES% unexpanded; setting
 * and clearing a variable through .NET afterwards tells Explorer, so new terminals see the change.
 */
export function windowsPathScript(mode: 'read' | 'add' | 'remove'): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$dir = $env:SESHBOARD_BIN_DIR.TrimEnd([char]92)',
    "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
    "$parts = @(([string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')) -split ';' | Where-Object { $_ -ne '' })",
    '$others = @($parts | Where-Object { $_.TrimEnd([char]92) -ine $dir })',
    '$has = $others.Count -ne $parts.Count',
    mode === 'read'
      ? "if ($has) { 'yes' } else { 'no' }"
      : [
          mode === 'add' ? 'if ($has) { exit 0 }' : 'if (-not $has) { exit 0 }',
          mode === 'add' ? '$others += $dir' : '',
          "$key.SetValue('Path', ($others -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)",
          "[Environment]::SetEnvironmentVariable('SESHBOARD_PATH_CHANGED', '1', 'User')",
          "[Environment]::SetEnvironmentVariable('SESHBOARD_PATH_CHANGED', $null, 'User')",
        ]
          .filter(Boolean)
          .join('\n'),
  ].join('\n');
}

async function windowsPath(mode: 'read' | 'add' | 'remove', dir: string): Promise<string> {
  const encoded = Buffer.from(windowsPathScript(mode), 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { ...process.env, SESHBOARD_BIN_DIR: dir });
}

/** Reads whether the plan's folder is on the user's PATH; true outside Windows, where the folder is on it already. */
export function pathCheck(plan: ShellCommandPlan, editsPath: boolean): () => Promise<boolean> {
  if (!editsPath) return async () => true;
  return async () => (await windowsPath('read', plan.dir)).trim() === 'yes';
}

/**
 * The shell command an administrator runs to write the commands into `dir`. Each script's text is in the command
 * itself: copied from a temporary folder instead, another program of this user could swap a file there for a link
 * while the password prompt waits, and have a file it can't read published in `dir`.
 */
export function privilegedInstall(dir: string, files: ReadonlyArray<{ file: string; script: string }>): string {
  const writes = files.map((entry) => `/usr/bin/printf '%s' ${shQuote(entry.script)} > ${shQuote(entry.file)} && /bin/chmod 755 ${shQuote(entry.file)}`);
  return `/bin/mkdir -p ${shQuote(dir)} && ${writes.join(' && ')}`;
}

/**
 * Writes the commands, skipping a name another program has a file for (never overwritten). Where the folder isn't writable (macOS's
 * /usr/local/bin), they are written with the administrator's password (`privilegedInstall`).
 * `editsPath` adds the folder to the user's PATH (Windows).
 */
export async function installShellCommand(plan: ShellCommandPlan, editsPath: boolean): Promise<void> {
  const files = ownFiles(plan);
  if (!files.length) return;
  if (canWrite(plan.dir)) {
    for (const entry of files) {
      writeFileSync(entry.file, entry.script, { mode: 0o755 });
      // writeFileSync keeps the mode of a file that was there already.
      if (plan.platform !== 'win32') chmodSync(entry.file, 0o755);
    }
  } else if (plan.platform === 'darwin') {
    await asAdministrator(privilegedInstall(plan.dir, files), `Seshboard wants to add the ${listed(files.map((entry) => entry.name))} commands to ${plan.dir}.`);
  } else {
    throw new Error(`Seshboard can't write to ${plan.dir}.`);
  }
  if (editsPath) await windowsPath('add', plan.dir);
}

/** Removes the commands Seshboard wrote (never another program's file), and on Windows its folder from the PATH. */
export async function removeShellCommand(plan: ShellCommandPlan, editsPath: boolean): Promise<void> {
  const ours = plan.files.filter((entry) => {
    const state = readCommandFile(entry.file, entry.script);
    return state === 'current' || state === 'outdated';
  });
  if (ours.length) {
    if (canWrite(plan.dir)) for (const entry of ours) rmSync(entry.file, { force: true });
    else if (plan.platform === 'darwin') await asAdministrator(`/bin/rm -f ${ours.map((entry) => shQuote(entry.file)).join(' ')}`, `Seshboard wants to remove the ${listed(ours.map((entry) => entry.name))} commands from ${plan.dir}.`);
    else throw new Error(`Seshboard can't write to ${plan.dir}.`);
  }
  if (editsPath) await windowsPath('remove', plan.dir);
}

/**
 * The folder in a command line, from the shell command (`seshboard .` on Windows and Linux runs the executable with
 * the folder) or from a person running the executable by hand. `args` come after the executable (and the app's path
 * in a development build); flags (`--…`, which Chromium adds too) and links are skipped. Relative folders are resolved
 * against `workingDirectory`, the one the command ran in. Returns null when there is no folder argument.
 */
export function folderFromArgv(args: string[], workingDirectory: string, platform: string): string | null {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // A scheme has two letters or more, so a Windows drive (C:\…) isn't one.
  const arg = args.find((value) => value !== '' && !value.startsWith('-') && !/^[a-z][a-z0-9+.-]+:/i.test(value));
  return arg === undefined ? null : paths.resolve(workingDirectory, arg);
}
