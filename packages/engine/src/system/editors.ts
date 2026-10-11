import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import type { ContinueEditor, EditorInfo } from '@switchboard/protocol';
import { needsCmd, viaCmd } from './windowsCommand.ts';

interface EditorSpec extends EditorInfo {
  /** macOS app bundle name (without .app). */
  app?: string;
  /** CLI that can jump to a line, when on PATH. */
  cli?: string;
  /** Where Windows installers put the CLI when it isn't on PATH (from `%LOCALAPPDATA%`, `%ProgramFiles%`). */
  windowsCli?: (env: Record<string, string>) => string[];
  gotoArgs?: (path: string, line: number | undefined) => string[];
  /**
   * Opens a file in the window of the folder given before it (focusing that window when it's already
   * open) instead of the window used last.
   */
  folderFirst?: boolean;
  /** Only offered on these platforms (all when left out). */
  platforms?: readonly NodeJS.Platform[];
}

const dashG = (path: string, line: number | undefined) => ['-g', line ? `${path}:${line}` : path];
const colon = (path: string, line: number | undefined) => [line ? `${path}:${line}` : path];
const jetbrains = (path: string, line: number | undefined) => (line ? ['--line', String(line), path] : [path]);

/** `%LOCALAPPDATA%\Programs\<rest>` and `%ProgramFiles%\<rest>`, for the per-user and per-machine installs. */
const programs = (...rest: string[]) => (env: Record<string, string>) =>
  [env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', ...rest), env.ProgramFiles && win32.join(env.ProgramFiles, ...rest)].filter((p): p is string => !!p);

/** Known apps, in the order they are offered. Only installed ones are shown. */
export const EDITOR_SPECS: readonly EditorSpec[] = [
  { id: 'vscode', name: 'VS Code', kind: 'editor', app: 'Visual Studio Code', cli: 'code', windowsCli: programs('Microsoft VS Code', 'bin', 'code.cmd'), gotoArgs: dashG, folderFirst: true },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    kind: 'editor',
    app: 'Visual Studio Code - Insiders',
    cli: 'code-insiders',
    windowsCli: programs('Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'),
    gotoArgs: dashG,
    folderFirst: true,
  },
  { id: 'cursor', name: 'Cursor', kind: 'editor', app: 'Cursor', cli: 'cursor', windowsCli: programs('cursor', 'resources', 'app', 'bin', 'cursor.cmd'), gotoArgs: dashG, folderFirst: true },
  { id: 'windsurf', name: 'Windsurf', kind: 'editor', app: 'Windsurf', cli: 'windsurf', windowsCli: programs('Windsurf', 'bin', 'windsurf.cmd'), gotoArgs: dashG, folderFirst: true },
  { id: 'zed', name: 'Zed', kind: 'editor', app: 'Zed', cli: 'zed', gotoArgs: colon, folderFirst: true },
  { id: 'sublime', name: 'Sublime Text', kind: 'editor', app: 'Sublime Text', cli: 'subl', windowsCli: programs('Sublime Text', 'subl.exe'), gotoArgs: colon },
  { id: 'webstorm', name: 'WebStorm', kind: 'editor', app: 'WebStorm', cli: 'webstorm', gotoArgs: jetbrains },
  { id: 'idea', name: 'IntelliJ IDEA', kind: 'editor', app: 'IntelliJ IDEA', cli: 'idea', gotoArgs: jetbrains },
  { id: 'xcode', name: 'Xcode', kind: 'editor', app: 'Xcode', cli: 'xed', gotoArgs: (p, l) => (l ? ['-l', String(l), p] : [p]), platforms: ['darwin'] },
  // The file manager keeps the id `finder` everywhere (the UI asks for it by id); its name follows the platform.
  { id: 'finder', name: 'Finder', kind: 'finder' },
  { id: 'terminal', name: 'Terminal', kind: 'terminal', app: 'Terminal', platforms: ['darwin'] },
  { id: 'iterm', name: 'iTerm', kind: 'terminal', app: 'iTerm', platforms: ['darwin'] },
  { id: 'ghostty', name: 'Ghostty', kind: 'terminal', app: 'Ghostty', platforms: ['darwin'] },
  { id: 'warp', name: 'Warp', kind: 'terminal', app: 'Warp', platforms: ['darwin'] },
  { id: 'windows-terminal', name: 'Windows Terminal', kind: 'terminal', cli: 'wt', platforms: ['win32'] },
];

/** What the file manager is called: Finder on macOS, File Explorer on Windows. */
export const fileManagerName = (platform: NodeJS.Platform) => (platform === 'win32' ? 'File Explorer' : platform === 'darwin' ? 'Finder' : 'Files');

function appInstalled(app: string, home: string): boolean {
  return [
    `/Applications/${app}.app`,
    posix.join(home, 'Applications', `${app}.app`),
    `/System/Applications/Utilities/${app}.app`,
    `/System/Applications/${app}.app`,
  ].some((p) => existsSync(p));
}

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Where `binary` is on PATH, or null. On Windows a command is a file with one of the PATHEXT endings (`code.cmd`,
 * `wt.exe`), so each is tried.
 */
export function findOnPath(binary: string, env: Record<string, string>, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = isExecutable): string | null {
  const windows = platform === 'win32';
  const { join, delimiter } = windows ? win32 : posix;
  const endings = windows ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase()) : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ending of endings) {
      const candidate = join(dir, binary + ending);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** The editor's CLI: on PATH, or (on Windows) where its installer puts it. */
function findCli(spec: EditorSpec, env: Record<string, string>, platform: NodeJS.Platform, exists?: (path: string) => boolean): string | null {
  if (!spec.cli) return null;
  const onPath = findOnPath(spec.cli, env, platform, exists);
  if (onPath || platform !== 'win32' || !spec.windowsCli) return onPath;
  return spec.windowsCli(env).find(exists ?? existsSync) ?? null;
}

const offeredOn = (spec: EditorSpec, platform: NodeJS.Platform) => !spec.platforms || spec.platforms.includes(platform);

/** Editors, terminals and the file manager installed here. */
export function detectEditors(env: Record<string, string>, home = homedir(), platform: NodeJS.Platform = process.platform, exists?: (path: string) => boolean): EditorInfo[] {
  const named = ({ id, name, kind }: EditorSpec): EditorInfo => ({ id, name: kind === 'finder' ? fileManagerName(platform) : name, kind });
  const specs = EDITOR_SPECS.filter((e) => offeredOn(e, platform));
  if (platform === 'darwin') return specs.filter((e) => e.kind === 'finder' || (e.app && appInstalled(e.app, home)) || (e.cli && findOnPath(e.cli, env, platform, exists))).map(named);
  // Elsewhere only what can be started: File Explorer always on Windows, the rest by their CLI.
  return specs.filter((e) => (e.kind === 'finder' && platform === 'win32') || findCli(e, env, platform, exists)).map(named);
}

/** A program to start: `verbatim` arguments are passed as written (Windows), not quoted again by Node. */
export interface Launch {
  command: string;
  args: string[];
  verbatim?: boolean;
}

/** Runs `file` with `args`; on Windows a `.cmd` goes through `cmd.exe`, every argument escaped for it. */
function launch(file: string, args: string[], env: Record<string, string>, platform: NodeJS.Platform): Launch {
  return platform === 'win32' && needsCmd(file) ? { ...viaCmd(file, args, env), verbatim: true } : { command: file, args };
}

/**
 * The command that opens `path` (optionally at `line`) in an editor. `folder` is the project the file
 * belongs to: editors that can, open the file in that project's window. Pure, for testing.
 */
export function openCommand(
  editorId: string,
  path: string,
  line: number | undefined,
  env: Record<string, string>,
  isDirectory: boolean,
  folder?: string,
  platform: NodeJS.Platform = process.platform,
  exists?: (path: string) => boolean,
): Launch {
  const spec = EDITOR_SPECS.find((e) => e.id === editorId);
  if (!spec) throw new Error(`Unknown editor: ${editorId}`);
  const windows = platform === 'win32';
  if (spec.kind === 'finder') {
    // Explorer reads `/select,"C:\a b\c.txt"` itself; Node's quoting of the whole argument would break it.
    if (windows) return { command: 'explorer.exe', args: [isDirectory ? `"${path}"` : `/select,"${path}"`], verbatim: true };
    return { command: 'open', args: isDirectory ? [path] : ['-R', path] };
  }
  const where = isDirectory ? path : (windows ? win32 : posix).dirname(path);
  if (spec.id === 'windows-terminal') {
    const wt = findCli(spec, env, platform, exists) ?? 'wt.exe';
    // Windows Terminal splits its command line at `;`, so one in a folder name is escaped.
    return { command: wt, args: ['-d', where.replace(/;/g, '\\;')] };
  }
  if (spec.kind === 'terminal') return { command: 'open', args: ['-a', spec.app!, where] };
  const cli = findCli(spec, env, platform, exists);
  if (cli && spec.gotoArgs) return launch(cli, [...(spec.folderFirst && folder && !isDirectory ? [folder] : []), ...spec.gotoArgs(path, line)], env, platform);
  // Without the CLI we can still open the file or folder, just not jump to a line (macOS only: detection needs the CLI elsewhere).
  return { command: 'open', args: ['-a', spec.app!, path] };
}

function start(target: Launch, env: Record<string, string>, options: { detached?: boolean } = {}) {
  return spawn(target.command, target.args, { env, stdio: 'ignore', windowsHide: true, ...(target.verbatim ? { windowsVerbatimArguments: true } : {}), ...options });
}

export function openInEditor(editorId: string, path: string, line: number | undefined, env: Record<string, string>, folder?: string): void {
  const isDirectory = statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  const child = start(openCommand(editorId, path, line, env, isDirectory, folder), env, { detached: true });
  child.on('error', () => {});
  child.unref();
}

/** The link that opens a session in an editor's Claude Code extension (the extension's own `open` handler). */
export function claudeExtensionUrl(editorId: ContinueEditor, sessionId: string): string {
  return `${editorId}://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`;
}

/** Runs a command and waits for it to exit (at most `limitMs`); a command that can't start counts as done. */
function run(target: Launch, env: Record<string, string>, limitMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const child = start(target, env);
    const timer = setTimeout(resolve, limitMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.on('error', done);
    child.on('exit', done);
  });
}

/** The command that opens a link in the app registered for it: `open` on macOS, Explorer on Windows. */
export const openUrlCommand = (url: string, platform: NodeJS.Platform = process.platform): Launch =>
  platform === 'win32' ? { command: 'explorer.exe', args: [url] } : { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [url] };

/**
 * Continues a session in an editor's Claude Code extension: opens the folder first (the extension only resumes
 * sessions of the folder that's open), waits for the window, then opens the session there.
 */
export async function continueInEditor(editorId: ContinueEditor, cwd: string, sessionId: string, env: Record<string, string>, settleMs = 1_500): Promise<void> {
  const spec = EDITOR_SPECS.find((e) => e.id === editorId)!;
  const platform = process.platform;
  const cli = findCli(spec, env, platform);
  if (cli) await run(launch(cli, [cwd], env, platform), env);
  else await run({ command: 'open', args: ['-a', spec.app!, cwd] }, env);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  await run(openUrlCommand(claudeExtensionUrl(editorId, sessionId), platform), env);
}
