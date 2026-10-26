import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import type { CompanionContextItemInput as ContextItemInput, CompanionSessions, CompanionTarget } from '@seshboard/protocol/companion-client';
import { SeshboardConnection, type CompanionClient } from './connection.ts';
import { deniedByRead, excludedBy, readRules, type ClaudeSettingsFile } from './exclusions.ts';
import { describeItems, itemPaths, problemsItem, resourceItems, selectionItem, terminalItem, type EditorSelection, type Problem } from './payload.ts';
import { PromptNotifier } from './promptNotifier.ts';
import { focusedTarget, folderFor, isWithin, sessionRow, statusBarView } from './targets.ts';

/** Seshboard's bundle id, to open it without changing what it shows. */
const APP_ID = 'dev.switchboard.app';
const DOWNLOAD_URL = 'https://github.com/estruyf/switchboard/releases/latest';

const config = () => vscode.workspace.getConfiguration('switchboard');
const workspaceFolders = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);

/**
 * A path for reading, relative to its workspace folder (with the folder's name when there are several). The workspace
 * folder itself is '' with one folder, since saying so adds nothing.
 */
function shortPath(path: string): string {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(path));
  if (!folder) return path.replace(homedir(), '~');
  const inside = relative(folder.uri.fsPath, path);
  if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) return inside ? `${folder.name}/${inside}` : folder.name;
  return inside;
}

const run = (command: string, args: string[], cwd?: string) =>
  new Promise<boolean>((resolve) => execFile(command, args, { cwd, timeout: 5_000 }, (error) => resolve(!error)));

/**
 * Opens a `switchboard://` link with whichever Seshboard the system knows: `open` on macOS, the shell's URL handler
 * on Windows (no shell in between, so nothing in the link is read as a command), `xdg-open` on Linux.
 */
const openLink = (link: string) =>
  process.platform === 'win32' ? run('rundll32.exe', ['url.dll,FileProtocolHandler', link]) : run(process.platform === 'darwin' ? 'open' : 'xdg-open', [link]);

/** Brings Seshboard up without changing what it shows: by its bundle id on macOS, with `switchboard://show` elsewhere. */
const showApp = () => (process.platform === 'darwin' ? run('open', ['-b', APP_ID]) : openLink('switchboard://show'));

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Seshboard', { log: true });
  const connection = new SeshboardConnection({
    appDataFolder: () => config().get<string>('appDataFolder', ''),
    version: String(context.extension.packageJSON.version ?? '0.0.0'),
    log: (message) => output.info(message),
  });
  const prompts = new PromptNotifier(connection, () => config().get<boolean>('prompts', true));
  const statusBar = new StatusBar(connection, (snapshot) => prompts.update(snapshot));
  context.subscriptions.push(output, prompts, statusBar, { dispose: () => connection.dispose() });

  /** Opens Seshboard (it isn't running), then waits for its engine. */
  const launch = async (folder: string | null): Promise<CompanionClient | null> => {
    const opened = await showApp();
    // Not installed under that id (a build from source): a switchboard:// link still starts whichever copy macOS knows.
    if (!opened) await openLink(folder ? `switchboard://new-session?cwd=${encodeURIComponent(folder)}` : 'switchboard://new-session');
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Starting Seshboard…' }, () => connection.waitForStart());
  };

  /** Asks which session to add to: this workspace's sessions, then New session in each workspace folder. */
  const pickTarget = async (snapshot: CompanionSessions, folders: string[], preferred: string | null, title: string): Promise<CompanionTarget | undefined> => {
    type Item = vscode.QuickPickItem & { target?: CompanionTarget };
    const now = Date.now();
    const sessions: Item[] = snapshot.sessions.map((session) => ({ ...sessionRow(session, now, shortPath), target: { kind: 'session', sessionId: session.id } }));
    const roots = preferred ? [preferred, ...folders.filter((f) => f !== preferred)] : folders;
    const fresh: Item[] = roots.map((folder) => ({ label: `$(add) New session in ${basename(folder)}`, target: { kind: 'new', cwd: folder } }));
    const items: Item[] = [...sessions, ...(sessions.length ? [{ label: '', kind: vscode.QuickPickItemKind.Separator }] : []), ...fresh];
    const picked = await vscode.window.showQuickPick(items, { title, placeHolder: sessions.length ? 'Pick a session, or start a new one' : 'No sessions for this workspace yet', matchOnDescription: true, matchOnDetail: true });
    return picked?.target;
  };

  /**
   * Adds context to a session in Seshboard: the focused session when its folder holds the files, otherwise the one
   * you pick. Nothing is sent to Claude; it shows as chips in the message box until you press send.
   */
  const send = async (items: ContextItemInput[], anchor: string | null = null) => {
    if (items.length === 0) return;
    const folders = workspaceFolders();
    const paths = itemPaths(items);
    const first = paths[0] ?? anchor;
    const folder = (first && folderFor(first, folders)) ?? folders[0] ?? (first ? dirname(first) : null);
    try {
      let client = (await connection.connect()) ?? (connection.state.kind === 'offline' && connection.state.reason === 'incompatible' ? null : await launch(folder));
      if (!client) return void showOffline(connection);
      let snapshot = await client.call('sessions.list', { folders });
      // Running without a window (closed with ⌘W): opening it brings one back.
      if (snapshot.windows === 0) {
        await showApp();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        client = (await connection.connect()) ?? client;
        snapshot = await client.call('sessions.list', { folders });
      }
      const focused = focusedTarget(snapshot, paths.length ? paths : folder ? [folder] : []);
      const target = focused ? ({ kind: 'session', sessionId: focused.id } as const) : await pickTarget(snapshot, folders.length ? folders : folder ? [folder] : [], folder, `Add ${describeItems(items)} to…`);
      if (!target) return;
      await client.call('context.add', { target, items, reveal: config().get<boolean>('bringToFront', true) });
      const where = target.kind === 'new' ? `New session in ${basename(target.cwd)}` : (snapshot.sessions.find((s) => s.id === target.sessionId) ?? snapshot.focused)?.title;
      vscode.window.setStatusBarMessage(`$(check) Added ${describeItems(items)} to ${where ?? 'Seshboard'}`, 4_000);
    } catch (error) {
      void vscode.window.showErrorMessage(`Couldn't add to Seshboard: ${(error as Error).message}`);
    }
  };

  const command = (id: string, handler: (...args: never[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  command('switchboard.addSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return void vscode.window.showInformationMessage('Open a file first.');
    const { document } = editor;
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') return void vscode.window.showInformationMessage('Only files on this computer can be added to Seshboard.');
    const selections = editor.selections.filter((s) => !s.isEmpty);
    await send(await rangeItems(document, selections.length ? selections : [editor.selection]));
  });

  // The quick fix on an error or warning: the problem, and the lines it is on.
  command('switchboard.fixProblems', async (uri?: vscode.Uri, diagnostics?: vscode.Diagnostic[]) => {
    const editor = vscode.window.activeTextEditor;
    const target = uri ?? editor?.document.uri;
    if (!target || target.scheme !== 'file') return void vscode.window.showInformationMessage('Open a file first.');
    // From the command palette: the problems where the cursor is, else every problem in the file.
    const all = vscode.languages.getDiagnostics(target).filter(isProblem);
    const atCursor = editor && editor.document.uri.toString() === target.toString() ? all.filter((d) => editor.selections.some((s) => d.range.intersection(s) !== undefined)) : [];
    const picked = diagnostics?.length ? diagnostics : atCursor.length ? atCursor : all;
    const problems = problemsItem(toProblems([[target, picked]]), shortPath, target.fsPath);
    if (!problems) return void vscode.window.showInformationMessage(`No errors or warnings in ${basename(target.fsPath)}.`);
    const document = await vscode.workspace.openTextDocument(target);
    // The whole lines the problems are on (a problem on an empty line leaves the whole file).
    const span = picked.reduce((range, d) => range.union(d.range), picked[0]!.range);
    const lines = new vscode.Selection(span.start.line, 0, span.end.line, document.lineAt(span.end.line).text.length);
    await send([...(await rangeItems(document, [lines])), problems]);
  });

  command('switchboard.addFile', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
    const picked = uris?.length ? uris : uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
    await send(await resources(picked));
  });

  command('switchboard.addOpenEditors', async () => send(await resources(vscode.window.tabGroups.all.flatMap((group) => group.tabs.map(tabUri)))));
  command('switchboard.addEditorGroup', async () => send(await resources(vscode.window.tabGroups.activeTabGroup.tabs.map(tabUri))));

  command('switchboard.addProblems', async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== 'file') return void vscode.window.showInformationMessage('Open a file first.');
    const item = problemsItem(toProblems([[target, vscode.languages.getDiagnostics(target)]]), shortPath, target.fsPath);
    if (!item) return void vscode.window.showInformationMessage(`No errors or warnings in ${basename(target.fsPath)}.`);
    await send([item]);
  });

  command('switchboard.addWorkspaceProblems', async () => {
    const folders = workspaceFolders();
    const all = vscode.languages.getDiagnostics().filter(([uri]) => uri.scheme === 'file' && (folders.length === 0 || folderFor(uri.fsPath, folders)));
    const item = problemsItem(toProblems(all), shortPath, null);
    if (!item) return void vscode.window.showInformationMessage('No errors or warnings in the workspace.');
    await send([item], folders[0] ?? null);
  });

  command('switchboard.addTerminalSelection', async () => {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) return void vscode.window.showInformationMessage('Open a terminal first.');
    const item = terminalItem((await terminalSelection(terminal)) ?? '', terminal.name);
    if (!item) return void vscode.window.showInformationMessage('Select some output in the terminal first.');
    const cwd = terminal.shellIntegration?.cwd?.scheme === 'file' ? terminal.shellIntegration.cwd.fsPath : null;
    await send([item], cwd ?? workspaceFolders()[0] ?? null);
  });

  command('switchboard.addChanges', async (...args: unknown[]) => {
    const uris = args.length ? scmUris(args) : await gitChanges();
    if (uris.length === 0) return void vscode.window.showInformationMessage('No changed files to add.');
    await send(await resources(uris));
  });

  /** Shows a session in Seshboard: the status bar's click, and Seshboard: Show Sessions. */
  const showSessions = async () => {
    const client = (await connection.connect()) ?? (await launch(workspaceFolders()[0] ?? null));
    if (!client) return void showOffline(connection);
    const folders = workspaceFolders();
    const snapshot = await client.call('sessions.list', { folders });
    const target = await pickTarget(snapshot, folders, null, 'Show in Seshboard');
    if (target?.kind === 'session') await client.call('session.reveal', { sessionId: target.sessionId });
    else if (target?.kind === 'new') await openLink(`switchboard://new-session?cwd=${encodeURIComponent(target.cwd)}`);
  };
  command('switchboard.showSessions', () => showSessions().catch((error: Error) => vscode.window.showErrorMessage(`Couldn't reach Seshboard: ${error.message}`)));
  command('switchboard.answerPrompts', async () => {
    const client = await connection.connect();
    if (!client) return void showOffline(connection);
    const snapshot = await client.call('sessions.list', { folders: workspaceFolders() });
    if (prompts.showAll(snapshot) === 0) void vscode.window.showInformationMessage('Nothing in this workspace is waiting for you in Seshboard.');
  });
  command('switchboard.reconnect', async () => {
    const client = await connection.reconnect();
    if (client) vscode.window.setStatusBarMessage('$(check) Connected to Seshboard', 3_000);
    else showOffline(connection);
  });
  command('switchboard.statusBarClick', async () => {
    const reveal = statusBar.view.reveal;
    const client = connection.client;
    if (reveal && client) await client.call('session.reveal', { sessionId: reveal }).catch(() => showSessions());
    else await showSessions().catch(() => {});
  });

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new FixInSeshboard(), { providedCodeActionKinds: FixInSeshboard.kinds }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => statusBar.watch()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('switchboard.appDataFolder')) void connection.reconnect();
      if (event.affectsConfiguration('switchboard.statusBar')) statusBar.render();
    }),
  );
  void connection.connect();
}

export function deactivate(): void {}

/** The status bar item: what needs you in Seshboard for this workspace, kept up to date by the engine. */
class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('switchboard.status', vscode.StatusBarAlignment.Left, 0);
  private snapshot: CompanionSessions | null = null;
  private off: (() => void) | null = null;
  private readonly stop: () => void;
  view = statusBarView(null);

  constructor(
    private readonly connection: SeshboardConnection,
    private readonly onSnapshot: (snapshot: CompanionSessions | null) => void,
  ) {
    this.item.name = 'Seshboard';
    this.item.command = 'switchboard.statusBarClick';
    this.stop = connection.onChange(() => this.watch());
    this.render();
  }

  /** Asks the engine for this workspace's sessions, and to say when they change. */
  watch(): void {
    this.off?.();
    this.off = null;
    const client = this.connection.client;
    if (!client) {
      this.snapshot = null;
      this.onSnapshot(null);
      return this.render();
    }
    const folders = workspaceFolders();
    this.off = client.on('sessions.changed', (snapshot) => {
      this.snapshot = snapshot;
      this.onSnapshot(snapshot);
      this.render();
    });
    void client
      .call('sessions.list', { folders })
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.onSnapshot(snapshot);
        this.render();
        return client.call('sessions.watch', { folders });
      })
      .catch(() => {});
  }

  render(): void {
    this.view = statusBarView(this.connection.client ? this.snapshot : null);
    if (!config().get<boolean>('statusBar', true)) return this.item.hide();
    this.item.text = this.view.text;
    this.item.tooltip = this.view.tooltip;
    this.item.backgroundColor = this.view.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.show();
  }

  dispose(): void {
    this.off?.();
    this.stop();
    this.item.dispose();
  }
}

const isProblem = (d: vscode.Diagnostic) => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning;

/** "Fix in Seshboard" in the light bulb of an error or warning. */
class FixInSeshboard implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    if (!config().get<boolean>('quickFix', true)) return [];
    const diagnostics = context.diagnostics.filter(isProblem);
    if (diagnostics.length === 0) return [];
    const action = new vscode.CodeAction('Fix in Seshboard', vscode.CodeActionKind.QuickFix);
    action.diagnostics = diagnostics;
    action.command = { command: 'switchboard.fixProblems', title: 'Fix in Seshboard', arguments: [document.uri, diagnostics] };
    return [action];
  }
}

/**
 * Selections in a document as context: references to their lines, or their text when the document has unsaved
 * changes (unless the file's text must not be sent; then a warning says the reference went without them). An empty
 * selection is the whole document.
 */
async function rangeItems(document: vscode.TextDocument, selections: readonly vscode.Selection[]): Promise<ContextItemInput[]> {
  const path = document.uri.scheme === 'file' ? document.uri.fsPath : null;
  const withhold = path && document.isDirty ? await withholdReason(path) : null;
  const results = selections.map((selection) =>
    selectionItem(
      {
        path,
        name: basename(document.fileName),
        startLine: selection.start.line,
        endLine: selection.end.line,
        endCharacter: selection.end.character,
        isEmpty: selection.isEmpty,
        dirty: document.isDirty,
        text: selection.isEmpty ? document.getText() : document.getText(selection),
        languageId: document.languageId,
      } satisfies EditorSelection,
      withhold,
    ),
  );
  const withheld = results.find((r) => r.kind === 'withheld');
  if (withheld?.kind === 'withheld') void vscode.window.showWarningMessage(`Sent a reference without your unsaved changes: ${withheld.reason}. Save the file for Claude to see them.`);
  return results.map((r) => r.item);
}

function showOffline(connection: SeshboardConnection): void {
  const state = connection.state;
  if (state.kind === 'offline' && state.reason === 'incompatible') return void vscode.window.showErrorMessage(state.detail);
  void vscode.window.showErrorMessage("Seshboard didn't start. Is it installed?", 'Download Seshboard').then((choice) => {
    if (choice) void vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
  });
}

/** The file an editor tab shows (the changed side of a diff), when it is a file on disk. */
function tabUri(tab: vscode.Tab): vscode.Uri | null {
  const input = tab.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook) return input.uri;
  if (input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff) return input.modified;
  return null;
}

/** Files and folders on disk as references (folders end up as folders). */
async function resources(uris: ReadonlyArray<vscode.Uri | null>): Promise<ContextItemInput[]> {
  const files = uris.filter((uri): uri is vscode.Uri => uri?.scheme === 'file');
  const found = await Promise.all(files.map(async (uri) => ({ path: uri.fsPath, stats: await stat(uri.fsPath).catch(() => null) })));
  return resourceItems(found.filter((f) => f.stats).map((f) => ({ path: f.path, directory: f.stats!.isDirectory() })));
}

/** The changed files of Source Control rows (resource states) or groups (Changes, Staged Changes). */
function scmUris(args: unknown[]): vscode.Uri[] {
  const out: vscode.Uri[] = [];
  for (const arg of args.flat()) {
    if (arg && typeof arg === 'object' && 'resourceUri' in arg) out.push((arg as vscode.SourceControlResourceState).resourceUri);
    else if (arg && typeof arg === 'object' && 'resourceStates' in arg) out.push(...(arg as vscode.SourceControlResourceGroup).resourceStates.map((s) => s.resourceUri));
  }
  return out;
}

interface GitApi {
  repositories: Array<{ rootUri: vscode.Uri; state: { indexChanges: Array<{ uri: vscode.Uri }>; workingTreeChanges: Array<{ uri: vscode.Uri }>; mergeChanges: Array<{ uri: vscode.Uri }> } }>;
}

/** Every changed file of the repository the active editor is in (or the first one), from VS Code's git extension. */
async function gitChanges(): Promise<vscode.Uri[]> {
  const git = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  const api = (git?.isActive ? git.exports : await git?.activate())?.getAPI(1);
  if (!api?.repositories.length) return [];
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const repo = (active && api.repositories.find((r) => isWithin(active, r.rootUri.fsPath))) || api.repositories[0]!;
  return [...repo.state.mergeChanges, ...repo.state.indexChanges, ...repo.state.workingTreeChanges].map((c) => c.uri);
}

function toProblems(entries: ReadonlyArray<readonly [vscode.Uri, readonly vscode.Diagnostic[]]>): Problem[] {
  return entries.flatMap(([uri, diagnostics]) =>
    diagnostics
      .filter(isProblem)
      .map((d) => ({
        path: uri.fsPath,
        line: d.range.start.line,
        character: d.range.start.character,
        severity: d.severity === vscode.DiagnosticSeverity.Error ? ('error' as const) : ('warning' as const),
        message: d.message,
        ...(d.source ? { source: d.source } : {}),
        ...(d.code !== undefined ? { code: typeof d.code === 'object' ? d.code.value : d.code } : {}),
      })),
  );
}

/** The terminal's selected text. Newer VS Code has it on the terminal; older ones copy it through the clipboard (put back after). */
async function terminalSelection(terminal: vscode.Terminal): Promise<string | undefined> {
  const direct = (terminal as { selection?: unknown }).selection;
  if (typeof direct === 'string') return direct;
  const before = await vscode.env.clipboard.readText();
  await vscode.env.clipboard.writeText('');
  await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
  const text = await vscode.env.clipboard.readText();
  await vscode.env.clipboard.writeText(before);
  return text || undefined;
}

/**
 * Why a file's text must not be sent (null when it may): it is excluded in VS Code's settings, ignored by git, or
 * Claude Code's settings deny reading it. Only text is held back; a reference is fine, since Claude Code applies its
 * own rules when it reads the file.
 */
async function withholdReason(path: string): Promise<string | null> {
  const uri = vscode.Uri.file(path);
  const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? null;
  const name = basename(path);
  if (folder) {
    // The exclude globs are /-separated, also on Windows.
    const inside = relative(folder, path).split(sep).join('/');
    const files = vscode.workspace.getConfiguration('files', uri).get<Record<string, unknown>>('exclude', {});
    const search = vscode.workspace.getConfiguration('search', uri).get<Record<string, unknown>>('exclude', {});
    if (excludedBy(inside, files) || excludedBy(inside, search)) return `${name} is excluded in your settings`;
  }
  if (await run('git', ['check-ignore', '-q', '--', path], dirname(path))) return `${name} is ignored by git`;
  const home = homedir();
  const read = async (file: string, root: string): Promise<ClaudeSettingsFile | null> => {
    try {
      return { root, json: JSON.parse(await readFile(file, 'utf8')) as unknown };
    } catch {
      return null;
    }
  };
  const project = folder ?? dirname(path);
  const settings = await Promise.all([
    read(join(process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'settings.json'), home),
    read(join(project, '.claude', 'settings.json'), project),
    read(join(project, '.claude', 'settings.local.json'), project),
  ]);
  if (deniedByRead(path, readRules(settings.filter((s): s is ClaudeSettingsFile => s !== null), project, home))) return `Claude Code's settings deny reading ${name}`;
  return null;
}
