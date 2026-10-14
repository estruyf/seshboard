import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, MessageChannelMain, nativeTheme, screen, shell, type MenuItemConstructorOptions } from 'electron';
import { DEFAULT_PREFERENCES, IMAGE_EXTENSIONS, IpcChannel, isSoundId, isThemeId, resolveSound, sanitizePreferences, type AppInfo, type DeepLinkMessage, type NotificationPermission, type Preferences, type RendererReadyReport, type ThemeCommand, type UpdateCommand } from '@switchboard/protocol/bridge';
import { isAbsolutePath, isLocalAbsolutePath, isSameOrInside } from '@switchboard/protocol/paths';
import { COMPANION_DIR, COMPANION_INFO_FILE, COMPANION_PROTOCOL, createRpcClient, lineTransport, type CompanionContract, type CompanionInfo } from '@switchboard/protocol/companion-client';
import { BUILT_IN_THEMES } from '../../../ui/src/themes/index.ts';
import { EngineProcess } from './engineProcess.ts';
import { DEEP_LINK_SCHEME, isShowLink, linkFromArgv, parseDeepLink } from './deepLink.ts';
import { Notifier, type RecordedAlert } from './notifier.ts';
import { setFieldValue, settle, until, waitInPage } from './pageDriver.ts';
import { PreferencesStore } from './preferences.ts';
import { QuitGuard } from './quitGuard.ts';
import { ReloadLimiter } from './reloadLimiter.ts';
import { RendererQueue } from './rendererQueue.ts';
import { runScreenshotTour } from './screenshotTour.ts';
import { SmokeRun } from './smokeRunner.ts';
import { SoundPlayer } from './sounds.ts';
import { notificationPermission, notificationSettingsUrl } from './notificationPermission.ts';
import { ThemeStore } from './themes.ts';
import { isConfigDir, isTrashableInstructionFile, isTrashableMemoryFile, isTrashableRepoFile, isTrashableSessionPath, isTrashableThemeFile } from './trashGuard.ts';
import { Updater } from './updater.ts';
import { updatesDisabledReason } from './updateState.ts';
import { placeWindow, WindowStateStore } from './windowState.ts';
import { MOD_KEY_PROPERTY, MOD_MODIFIER, platformModifiers } from './smokeKeys.ts';

const here = import.meta.dirname;
const smokeOutDir = process.env.SWITCHBOARD_SMOKE_OUT;
// npm run screenshots: a tour through the app in a made-up home folder, for the README.
const screenshotOutDir = process.env.SWITCHBOARD_SCREENSHOTS_OUT;
// npm run website:screenshots: Playwright drives the window from outside (scripts/website-screenshots.ts); the app
// only has to run on a throwaway profile, like the tours above.
const driven = process.env.SWITCHBOARD_DRIVEN === '1';
const scripted = Boolean(smokeOutDir || screenshotOutDir || driven);

// `Switchboard --version` prints the version for scripts and support, before any window opens.
if (process.argv.includes('--version')) {
  process.stdout.write(`${app.getVersion()}\n`);
  app.exit(0);
}

/** The running build. The commit is baked in at build time (electron.vite.config.ts). */
const appInfo: AppInfo = { version: app.getVersion(), commit: __SWITCHBOARD_COMMIT__ || null, dev: !app.isPackaged };
ipcMain.on(IpcChannel.getAppInfo, (event) => {
  event.returnValue = appInfo;
});

// The smoke test and the screenshots run against a throwaway profile so they never touch real app data. A driven run
// may name its own folder (SWITCHBOARD_DRIVEN_PROFILE), so a restart finds the same profile (scripts/chaos); never one
// inside the app data folder, where the installed app keeps the user's real data.
const drivenProfile = driven ? process.env.SWITCHBOARD_DRIVEN_PROFILE : undefined;
if (drivenProfile && isAbsolutePath(drivenProfile) && !isSameOrInside(drivenProfile, app.getPath('appData'))) {
  mkdirSync(drivenProfile, { recursive: true });
  app.setPath('userData', drivenProfile);
} else if (scripted) app.setPath('userData', mkdtempSync(join(tmpdir(), 'switchboard-smoke-')));
// The engine inherits these: the Claude Code check reads a mock registry that offers a newer version, and an
// update is refused even if one were clicked, so the user's real `claude` is never touched.
if (scripted) {
  process.env.SWITCHBOARD_CLAUDE_REGISTRY ??= `data:application/json,${encodeURIComponent(JSON.stringify({ latest: '999.0.0', stable: '999.0.0' }))}`;
  process.env.SWITCHBOARD_NO_CLAUDE_UPDATE = '1';
  // Auto model never calls a real model here: the engine picks from the prompt's words instead.
  process.env.SWITCHBOARD_STUB_ROUTER = '1';
  // Side questions (/btw) get a made-up answer, so nothing here asks a model.
  process.env.SWITCHBOARD_STUB_BTW = '1';
}

// The single-instance lock belongs to the data folder. Development builds keep their own ("Switchboard Dev"), so
// `npm run dev` starts next to the installed app instead of handing over to it, and a newer migration never touches
// the installed app's database. SWITCHBOARD_DATA_DIR picks another folder, for a second dev build (another worktree).
if (!scripted) {
  const dataDir = process.env.SWITCHBOARD_DATA_DIR || (app.isPackaged ? undefined : join(app.getPath('appData'), 'Switchboard Dev'));
  if (dataDir) {
    const installedPreferences = join(app.getPath('userData'), 'preferences.json');
    mkdirSync(dataDir, { recursive: true });
    // A fresh folder starts with the installed app's theme and layout rather than the defaults.
    if (!existsSync(join(dataDir, 'preferences.json')) && existsSync(installedPreferences)) copyFileSync(installedPreferences, join(dataDir, 'preferences.json'));
    app.setPath('userData', dataDir);
  }
}

// A second launch hands its arguments to the running instance (its second-instance event) and stops here.
// app.quit() would let this module run on: the updater would delete the running instance's update marker and
// whenReady would start a second engine. app.exit() ends the process before the next line.
if (!app.requestSingleInstanceLock()) app.exit(0);

// Windows shows an app's notifications only under an AppUserModelID: the installer's (the appId) once installed,
// Electron's own path in development, where no Start menu entry carries one.
const appUserModelId = app.isPackaged ? 'dev.switchboard.app' : process.execPath;
if (process.platform === 'win32') app.setAppUserModelId(appUserModelId);

// SWITCHBOARD_COLOR_SCHEME=light|dark forces a scheme without saving it (to check both in the smoke test).
const forcedScheme = process.env.SWITCHBOARD_COLOR_SCHEME;
const preferences = new PreferencesStore(join(app.getPath('userData'), 'preferences.json'), sanitizePreferences({ colorScheme: forcedScheme }).colorScheme);
// The smoke steps need sessions to click; on the real ~/.claude most were started elsewhere. Star on GitHub stays out
// of the screenshots (the smoke step that checks it asks for it).
if (scripted) preferences.update({ sessionScope: 'all', githubStar: 'done' });

/** Built-in and imported themes; a change (an import, an edited file) goes to every window. */
const themes = new ThemeStore(join(app.getPath('userData'), 'themes'), BUILT_IN_THEMES, (state) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.themesChanged, state);
  updateWindowBackgrounds();
});

/** The window's background before the page paints: the theme's background for the current mode. */
const windowBackground = () => themes.background(preferences.get().themeId, nativeTheme.shouldUseDarkColors);
const updateWindowBackgrounds = () => {
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(windowBackground());
};

// SWITCHBOARD_MOCK_UPDATES=1 points the updater at a local feed (scripts/mock-update-server.ts).
const mockFeedUrl = process.env.SWITCHBOARD_MOCK_UPDATES === '1' ? (process.env.SWITCHBOARD_MOCK_UPDATES_URL ?? 'http://localhost:8484') : undefined;
const updater = new Updater({
  currentVersion: app.getVersion(),
  channel: preferences.get().updateChannel,
  autoCheck: preferences.get().autoUpdate,
  disabledReason: updatesDisabledReason({
    env: process.env,
    packaged: app.isPackaged,
    devServer: Boolean(process.env.ELECTRON_RENDERER_URL),
    hasFeed: app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')),
    mockFeed: Boolean(mockFeedUrl),
  }),
  markerFile: join(app.getPath('userData'), 'update-marker.json'),
  ...(mockFeedUrl ? { mockFeedUrl } : {}),
  onState: (state) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.updateState, state);
  },
  beforeInstall: () => engine?.stop(),
  // Squirrel didn't restart the app (run from the DMG, a read-only folder): bring the engine back.
  installFailed: () => engine?.resume(),
  log: (message) => console.log(`[updater] ${message}`),
});
ipcMain.on(IpcChannel.getUpdateState, (event) => {
  event.returnValue = updater.state;
});
ipcMain.on(IpcChannel.updateCommand, (_event, command: unknown) => {
  if (command === 'check' || command === 'download' || command === 'install' || command === 'retry' || command === 'dismiss') updater.run(command satisfies UpdateCommand);
});

/** Applies a change from any window or the menu bar, and tells every window. */
function updatePreferences(patch: unknown): void {
  const next = preferences.update(patch);
  updater.setAutoCheck(next.autoUpdate);
  updater.setChannel(next.updateChannel);
  const item = Menu.getApplicationMenu()?.getMenuItemById(`scheme-${next.colorScheme}`);
  if (item) item.checked = true;
  updateWindowBackgrounds();
  sendEngineSettings(next);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.preferencesChanged, next);
}

/** Settings the engine acts on: Settings › Sessions (the archive days, which the VS Code companion lists by, and deleting) and Auto model. */
function sendEngineSettings(prefs: Preferences): void {
  engine?.sendStanding({ type: 'retention', archiveAfterDays: prefs.archiveAfterDays, deleteArchived: prefs.deleteArchived });
  // Settings › Conversation › Auto model: the queue routes its prompts in the engine, with these.
  engine?.sendStanding({ type: 'autoModel', prefs: prefs.autoModel });
}

ipcMain.on(IpcChannel.getPreferences, (event) => {
  event.returnValue = preferences.get();
});
ipcMain.on(IpcChannel.setPreferences, (_event, patch: unknown) => updatePreferences(patch));
// Keep the area behind the page in step (resizing shows it briefly).
nativeTheme.on('updated', updateWindowBackgrounds);

ipcMain.on(IpcChannel.getThemes, (event) => {
  event.returnValue = themes.state();
});

/** The smoke run has no one to answer a file dialog: it imports the file its theme step wrote, and exports into its profile. */
let smokeThemeFile: string | null = null;
const smokeThemeExports = () => join(app.getPath('userData'), 'smoke-theme-export');

ipcMain.handle(IpcChannel.themeCommand, async (event, command: ThemeCommand) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  switch (command?.kind) {
    case 'choose-file': {
      if (smokeOutDir) return smokeThemeFile;
      const options: Electron.OpenDialogOptions = {
        title: 'Import a theme',
        defaultPath: app.getPath('downloads'),
        properties: ['openFile'],
        filters: [{ name: 'Switchboard theme', extensions: ['json', 'jsonc'] }],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    }
    case 'check-file':
      return typeof command.path === 'string' && isLocalAbsolutePath(command.path, process.platform) ? themes.check(command.path) : { ok: false, error: "Switchboard couldn't read this file.", fileName: '' };
    case 'add':
      return themes.add(command.raw, command.how === 'replace' || command.how === 'keep-both' ? command.how : 'add');
    case 'duplicate':
      return isThemeId(command.id) ? themes.duplicate(command.id) : null;
    case 'remove': {
      const entry = isThemeId(command.id) ? themes.get(command.id) : undefined;
      if (!entry?.path || entry.builtIn || !isTrashableThemeFile(entry.path, themes.dir)) throw new Error('Only imported themes can be removed.');
      // The smoke run's copies are in its throwaway profile: deleted there, so they never reach the user's Trash.
      if (smokeOutDir) rmSync(entry.path);
      else await shell.trashItem(entry.path);
      themes.removed(entry.id);
      // Removing the theme in use goes back to Demo Time.
      if (preferences.get().themeId === entry.id) updatePreferences({ themeId: 'demo-time' });
      return null;
    }
    case 'export': {
      const content = typeof command.content === 'string' ? command.content : '';
      // Written only when it is a valid theme, so an export can always be imported again.
      const check = (() => {
        try {
          return themes.validate(JSON.parse(content));
        } catch {
          return 'not JSON';
        }
      })();
      if (check) throw new Error(`The theme couldn't be exported: ${check}`);
      const name = typeof command.fileName === 'string' && /^[a-z0-9][a-z0-9-]*\.json$/.test(command.fileName) ? command.fileName : 'theme.json';
      let path: string;
      if (smokeOutDir) {
        mkdirSync(smokeThemeExports(), { recursive: true });
        path = join(smokeThemeExports(), name);
      } else {
        const options: Electron.SaveDialogOptions = {
          title: 'Export theme',
          defaultPath: join(app.getPath('documents'), name),
          filters: [{ name: 'Switchboard theme', extensions: ['json'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        };
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return null;
        path = result.filePath.toLowerCase().endsWith('.json') ? result.filePath : `${result.filePath}.json`;
      }
      writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
      return path;
    }
    case 'open-folder':
      mkdirSync(themes.dir, { recursive: true });
      void shell.openPath(themes.dir);
      return null;
    case 'show-file': {
      const entry = isThemeId(command.id) ? themes.get(command.id) : undefined;
      if (entry?.path) shell.showItemInFolder(entry.path);
      return null;
    }
    default:
      return null;
  }
});

let engine: EngineProcess;
let notifier: Notifier;
let focusedSession: string | null = null;
const recordedNotifications: RecordedAlert[] = [];
/** Sounds the smoke run would have played (it never makes a sound). */
const recordedSounds: Array<{ id: string; volume: number }> = [];
const sounds = new SoundPlayer(smokeOutDir ? { record: (sound) => void recordedSounds.push(sound) } : {});

ipcMain.handle(IpcChannel.listSounds, () => sounds.list());
ipcMain.on(IpcChannel.playSound, (_event, id: unknown, volume: unknown) => {
  if (isSoundId(id) && typeof volume === 'number' && Number.isFinite(volume)) sounds.play(id, volume);
});
/** What the smoke step makes the system say about notifications; scripted runs never read the real setting. */
let forcedNotificationPermission: NotificationPermission | null = null;
ipcMain.handle(IpcChannel.notificationPermission, () =>
  forcedNotificationPermission ?? (scripted ? 'allowed' : notificationPermission(appUserModelId)),
);
ipcMain.on(IpcChannel.openNotificationSettings, () => {
  if (scripted) return;
  void notificationSettingsUrl().then((url) => {
    if (url) void shell.openExternal(url);
  });
});
ipcMain.on(IpcChannel.testNotification, () => notifier?.test());

/**
 * Where the traffic lights sit: the default, or inside the 80px minimal sidebar. They are 54px wide, and
 * a few pixels more on newer macOS, so the rail leaves room on both sides instead of matching them exactly.
 */
const WINDOW_BUTTONS = { default: { x: 16, y: 18 }, rail: { x: 12, y: 18 } } as const;
ipcMain.on(IpcChannel.windowButtons, (event, position: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (process.platform !== 'darwin' || !win) return;
  win.setWindowButtonPosition(position === 'rail' ? WINDOW_BUTTONS.rail : WINDOW_BUTTONS.default);
});

ipcMain.on(IpcChannel.focusSession, (_event, sessionId: unknown) => {
  focusedSession = typeof sessionId === 'string' ? sessionId : null;
});

// The VS Code companion sent context and asked to see it: the editor is in front, so take focus from it.
ipcMain.on(IpcChannel.focusWindow, (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
});

function openSession(sessionId: string): void {
  sendToWindow(showWindow(), IpcChannel.selectSession, sessionId, { latestOnly: true });
}

async function handleEngineRequest(message: unknown): Promise<unknown> {
  const request = message as { type?: unknown; id?: unknown; paths?: unknown; repoRoot?: unknown; configDir?: unknown; memoryDir?: unknown; instructionsRoot?: unknown } | null;
  if (request?.type !== 'trash' || typeof request.id !== 'number' || !Array.isArray(request.paths)) return undefined;
  // Always answer: the engine waits for a reply to every trash request.
  try {
    if (typeof request.memoryDir === 'string' || typeof request.instructionsRoot === 'string') return await trashMemoryForEngine(request.id, request.paths, request.memoryDir, request.instructionsRoot);
    return await trashForEngine(request.id, request.paths, request.repoRoot, request.configDir);
  } catch (error) {
    return { type: 'trash-result', id: request.id, error: (error as Error).message };
  }
}

/** Moves session files, or (for a git revert) new files in a repository, to the Trash after checking every path. */
async function trashForEngine(id: number, requested: unknown[], requestedRoot: unknown, requestedConfigDir: unknown): Promise<unknown> {
  // Each Claude profile has its own config folder; session files must be inside its projects folder.
  const configDir = isConfigDir(requestedConfigDir) ? requestedConfigDir : process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const paths = requested.filter((p): p is string => typeof p === 'string');
  // Session files, or (for a git revert) new files inside the repository being reverted.
  const repoRoot = typeof requestedRoot === 'string' ? requestedRoot : null;
  const refused = paths.filter((p) => (repoRoot ? !isTrashableRepoFile(p, repoRoot) : !isTrashableSessionPath(p, configDir)));
  if (refused.length > 0 || paths.length !== requested.length) {
    const where = repoRoot ? `the repository ${repoRoot}` : "Claude Code's projects folder";
    return { type: 'trash-result', id, error: `Refusing to move files outside ${where}: ${refused.join(', ')}` };
  }
  for (const path of paths) await shell.trashItem(path);
  return { type: 'trash-result', id };
}

/** Moves a memory file shared with the team, or an instruction file a share made (its undo), to the Trash after checking it. */
async function trashMemoryForEngine(id: number, requested: unknown[], memoryDir: unknown, instructionsRoot: unknown): Promise<unknown> {
  const paths = requested.filter((p): p is string => typeof p === 'string');
  const allowed = (p: string) =>
    typeof memoryDir === 'string' ? isTrashableMemoryFile(p, memoryDir) : typeof instructionsRoot === 'string' && isTrashableInstructionFile(p, instructionsRoot);
  const refused = paths.filter((p) => !allowed(p));
  if (refused.length > 0 || paths.length !== requested.length) {
    return { type: 'trash-result', id, error: `Refusing to move these to the Trash: ${refused.join(', ')}` };
  }
  for (const path of paths) await shell.trashItem(path);
  return { type: 'trash-result', id };
}

/** Windows whose renderer is up and can show the quit prompt. */
const readyRenderers = new Set<number>();
let quitRecorded = false;

const quitGuard = new QuitGuard({
  ask() {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && readyRenderers.has(win.webContents.id)) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(IpcChannel.quitRequested);
      return;
    }
    // No window to ask in (all closed, or still loading): ask natively. This is the one prompt that stays
    // system UI on purpose, since there is no renderer to draw the themed one in.
    void dialog
      .showMessageBox({ type: 'question', message: 'Quit Switchboard?', detail: 'Sessions running in Switchboard will stop.', buttons: ['Quit', 'Cancel'], defaultId: 0, cancelId: 1 })
      .then(({ response }) => quitGuard.answer(response === 0 ? 'quit' : 'cancel'));
  },
  quit: () => quitApp(),
});

ipcMain.on(IpcChannel.quitAnswer, (_event, answer: unknown) => {
  if (answer === 'quit' || answer === 'cancel') quitGuard.answer(answer);
});

/**
 * Messages that arrived before a window could take them: the link that launched the app, a notification
 * clicked after the window was closed (a new one is still loading), Settings… with no window open.
 */
const pendingMessages = new RendererQueue();

/** The window to show something in, created if they were all closed, and brought to the front. */
function showWindow(): BrowserWindow {
  const win = BrowserWindow.getAllWindows()[0] ?? createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

/** Sends now if the window's renderer is listening, otherwise when it reports ready. */
function sendToWindow(win: BrowserWindow, channel: string, payload: unknown, options: { latestOnly?: boolean } = {}): void {
  if (readyRenderers.has(win.webContents.id)) win.webContents.send(channel, payload);
  else pendingMessages.push(channel, payload, options);
}

/**
 * Opens a `switchboard://` link. It is validated here, then handed to the window, which fills in New
 * session (never sends) or shows the session. A refused link only shows why.
 */
function openDeepLink(url: string): void {
  // Only brings the window up (the VS Code companion starting Switchboard); before 'ready' the window opens anyway.
  if (isShowLink(url)) {
    if (app.isReady()) showWindow();
    return;
  }
  const parsed = parseDeepLink(url);
  const message: DeepLinkMessage = parsed.ok ? { link: parsed.link } : { error: parsed.error };
  console.log(`[main] link: ${parsed.ok ? parsed.link.action : `refused (${parsed.error})`}`);
  if (!app.isReady()) {
    pendingMessages.push(IpcChannel.deepLink, message);
    return;
  }
  sendToWindow(showWindow(), IpcChannel.deepLink, message);
}

// The smoke test checks quitting without ending its own run.
const quitApp = () => (smokeOutDir ? (quitRecorded = true) : app.quit());
/** Set once the app is quitting, so closing its windows on the way out doesn't ask again. */
let quitting = false;

function openSettings(section: 'about' | null = null): void {
  sendToWindow(showWindow(), IpcChannel.openSettings, section, { latestOnly: true });
}

/** Switchboard → Check for Updates…: checks, and opens Settings → About where the result shows. */
function checkForUpdates(): void {
  updater.run('check');
  openSettings('about');
}

/**
 * The standard menu, except that quitting goes through the quit guard: on macOS the app menu, on Windows and Linux
 * File, Edit, View, Window and Help (shown with Alt), with Settings in File and About in Help.
 */
function installMenu(): void {
  const mac = process.platform === 'darwin';
  const quit: MenuItemConstructorOptions = { id: 'quit', label: mac ? 'Quit Switchboard' : 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => (preferences.get().confirmQuit ? quitGuard.request() : quitApp()) };
  const settings: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() };
  const checkUpdates: MenuItemConstructorOptions = { id: 'check-updates', label: 'Check for Updates…', click: () => checkForUpdates() };
  const top: MenuItemConstructorOptions[] = mac
    ? [
        {
          label: 'Switchboard',
          submenu: [
            { role: 'about' },
            checkUpdates,
            { type: 'separator' },
            settings,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            quit,
          ],
        },
        { role: 'fileMenu' },
      ]
    : [{ label: 'File', submenu: [settings, { type: 'separator' }, quit] }];
  const template: MenuItemConstructorOptions[] = [
    ...top,
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: (['system', 'light', 'dark'] as const).map((scheme) => ({
            id: `scheme-${scheme}`,
            label: scheme === 'system' ? 'Match System' : scheme === 'light' ? 'Light' : 'Dark',
            type: 'radio' as const,
            checked: preferences.get().colorScheme === scheme,
            click: () => updatePreferences({ colorScheme: scheme }),
          })),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        // The page handles ⌘/ itself (in the terminal and the message box too), so the menu only shows the key.
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', registerAccelerator: false, click: () => sendToWindow(showWindow(), IpcChannel.toggleShortcuts, null, { latestOnly: true }) },
        // On macOS these are in the app menu; Windows and Linux have none.
        ...(mac ? [] : ([{ type: 'separator' }, checkUpdates, { label: 'About Switchboard', click: () => openSettings('about') }] satisfies MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** The window's last size, position and display. Scripted runs always start at the default size. */
const windowState = scripted ? undefined : new WindowStateStore(join(app.getPath('userData'), 'window-state.json'));
const WINDOW_MIN = { width: 900, height: 560 };

/** Saves where the window is, so the next one opens there. A maximized window keeps the size it returns to. */
function rememberWindowState(win: BrowserWindow): void {
  if (!windowState || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  windowState.save({ bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds(), maximized: win.isMaximized() });
}

function createWindow(): BrowserWindow {
  const saved = windowState?.get();
  const placed = saved && placeWindow(saved.bounds, screen.getAllDisplays().map((d) => d.workArea), WINDOW_MIN);
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    ...placed,
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    // Scripted runs keep the default size on a smaller screen (a CI runner's is 1024×768), so the steps see the
    // same layout everywhere. macOS otherwise shrinks the window to fit; other systems allow it as is.
    enableLargerThanScreen: scripted,
    show: false,
    // macOS: the traffic lights over the content. Elsewhere the system's own title bar, which follows light and dark
    // mode, and the menu bar shows with Alt (the command palette has every command).
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: WINDOW_BUTTONS.default } : { autoHideMenuBar: true }),
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    // maximize() shows the window, so it waits for the first paint like show().
    if (placed && saved?.maximized) win.maximize();
    win.show();
    if (scripted) {
      // Windows fits a new window to the screen; set the size again now that it is shown.
      win.setContentSize(1280, 820);
      smokeWindow = { content: win.getContentSize(), workArea: screen.getPrimaryDisplay().workAreaSize };
    }
  });
  // Saved when a move or resize ends and on close, so a crash or a forced quit keeps the last position too.
  const remember = () => rememberWindowState(win);
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  win.on('close', remember);
  // The taskbar button flashes while a session needs you (Notifier); looking at the window is enough.
  if (process.platform !== 'darwin') win.on('focus', () => win.flashFrame(false));
  // On Windows and Linux closing the window quits the app (its sessions stop), so it asks first, as ⌘Q does on macOS.
  // Windows is shutting down, restarting or signing out: closing then mustn't ask, or it would hold that up.
  win.on('session-end', () => {
    quitting = true;
  });
  win.on('close', (event) => {
    if (process.platform === 'darwin' || quitting || scripted || !preferences.get().confirmQuit) return;
    event.preventDefault();
    quitGuard.request();
  });
  const contentsId = win.webContents.id;
  win.webContents.on('did-start-loading', () => readyRenderers.delete(contentsId));
  // A crashed page leaves the window blank: reload it, unless it keeps crashing.
  const reloads = new ReloadLimiter();
  win.webContents.on('render-process-gone', (_event, details) => {
    readyRenderers.delete(contentsId);
    if (win.isDestroyed()) return;
    if (reloads.shouldReload(details.reason)) {
      console.error(`[main] renderer gone (${details.reason}); reloading`);
      win.webContents.reload();
    } else if (details.reason !== 'clean-exit') {
      console.error(`[main] renderer gone (${details.reason}); not reloading, it crashed too often`);
    }
  });
  win.on('closed', () => readyRenderers.delete(contentsId));

  // The renderer is a local app: links open in the browser, never inside the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, '../renderer/index.html'));
  return win;
}

/** Each request gets a fresh channel: one end to the engine, the other to the asking window. */
ipcMain.on(IpcChannel.requestEnginePort, (event) => {
  const { port1, port2 } = new MessageChannelMain();
  engine.connect(port1);
  event.sender.postMessage(IpcChannel.enginePort, null, [port2]);
});

/** Stops the engine supervisor first: app.exit() skips will-quit, and the supervisor would otherwise restart it. */
function exitApp(code: number): void {
  engine?.stop();
  app.exit(code);
}

interface TimedReport extends RendererReadyReport {
  /** ms from process start until the UI could talk to the engine. */
  connectedMs: number;
  /** ms from process start until the full diagnostics (shell env, claude version) were loaded. */
  loadedMs: number;
}
ipcMain.handle(IpcChannel.pickFolder, async (event, defaultPath: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a folder for the new session',
    properties: ['openDirectory', 'createDirectory'],
    ...(typeof defaultPath === 'string' ? { defaultPath } : {}),
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(IpcChannel.pickImage, async (event, defaultPath: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a project icon',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['svg', 'png', 'ico', 'jpg', 'jpeg', 'webp', 'gif'] }],
    ...(typeof defaultPath === 'string' ? { defaultPath } : {}),
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(IpcChannel.pickContextFiles, async (event, defaultPath: unknown) => {
  if (smokeOutDir) return [];
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Add context',
    buttonLabel: 'Add',
    // Windows can't pick files and folders in one dialog: with both it only shows folders.
    properties: process.platform === 'darwin' ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    ...(typeof defaultPath === 'string' ? { defaultPath } : {}),
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return result.filePaths.map((path) => {
    try {
      return { path, directory: statSync(path).isDirectory() };
    } catch {
      return { path, directory: false };
    }
  });
});

/** The smoke run has no one to answer a file dialog: it exports to (and previews) a file in its throwaway profile. */
const smokeSettingsFile = () => join(app.getPath('userData'), 'smoke-settings-export.json');

ipcMain.handle(IpcChannel.chooseExportFile, async (event, defaultName: unknown) => {
  if (smokeOutDir) return smokeSettingsFile();
  const win = BrowserWindow.fromWebContents(event.sender);
  const name = typeof defaultName === 'string' && /^[\w.-]+\.json$/.test(defaultName) ? defaultName : 'switchboard-settings.json';
  const options: Electron.SaveDialogOptions = {
    title: 'Export Switchboard settings',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Switchboard settings', extensions: ['json'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  return result.filePath.toLowerCase().endsWith('.json') ? result.filePath : `${result.filePath}.json`;
});

ipcMain.handle(IpcChannel.chooseImportFile, async (event) => {
  if (smokeOutDir) return smokeSettingsFile();
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Import Switchboard settings',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Switchboard settings', extensions: ['json'] }],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

/** The smoke run has no one to answer a file dialog: it previews a made-up export its memory step wrote in the throwaway profile. */
export const smokeMemoryExport = () => join(app.getPath('userData'), 'smoke-claude-export');

ipcMain.handle(IpcChannel.chooseMemoryExport, async (event) => {
  if (smokeOutDir) return [smokeMemoryExport()];
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Import from a Claude export',
    message: 'Pick memories-000.zip (and projects-000.zip), the unzipped export folder, or the manifest JSON.',
    defaultPath: app.getPath('downloads'),
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Claude export', extensions: ['zip', 'json'] }],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

/** The smoke run has no one to answer the save dialog: images go to a folder in its throwaway profile. */
const smokeImageExports = () => join(app.getPath('userData'), 'smoke-image-exports');
/** Images saved this run: the only paths Show in Finder will reveal. */
const savedImages = new Set<string>();

ipcMain.handle(IpcChannel.saveImage, async (event, request: unknown) => {
  const { mediaType, data, fileName } = (request ?? {}) as Record<string, unknown>;
  const extension = typeof mediaType === 'string' ? IMAGE_EXTENSIONS[mediaType] : undefined;
  if (!extension || typeof data !== 'string' || !data) throw new Error('Not an image that can be saved');
  const name = typeof fileName === 'string' && /^[\w .-]{1,80}$/.test(fileName) && fileName.toLowerCase().endsWith(`.${extension}`) ? fileName : `image.${extension}`;
  let path: string;
  if (smokeOutDir) {
    mkdirSync(smokeImageExports(), { recursive: true });
    path = join(smokeImageExports(), name);
  } else {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Save image',
      defaultPath: join(app.getPath('downloads'), name),
      filters: [{ name: `${extension.toUpperCase()} image`, extensions: extension === 'jpg' ? ['jpg', 'jpeg'] : [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    path = result.filePath;
  }
  writeFileSync(path, Buffer.from(data, 'base64'));
  savedImages.add(path);
  return path;
});

ipcMain.on(IpcChannel.showSavedImage, (_event, path: unknown) => {
  if (typeof path === 'string' && savedImages.has(path)) shell.showItemInFolder(path);
});

const readyReports: TimedReport[] = [];
ipcMain.on(IpcChannel.rendererReady, (event, report: RendererReadyReport) => {
  const timed: TimedReport = {
    ...report,
    connectedMs: Math.round(report.connectedAt - performance.timeOrigin),
    loadedMs: Math.round(performance.now()),
  };
  readyReports.push(timed);
  readyRenderers.add(event.sender.id);
  for (const { channel, payload } of pendingMessages.drain()) event.sender.send(channel, payload);
  if (readyReports.length === 1) {
    console.log(`[main] engine connected ${timed.connectedMs}ms, diagnostics loaded ${timed.loadedMs}ms after process start`);
  }
  if (smokeOutDir) void runSmokeStep(BrowserWindow.fromWebContents(event.sender));
  const win = BrowserWindow.fromWebContents(event.sender);
  if (screenshotOutDir && win && readyReports.length === 1) {
    void runScreenshotTour(win, screenshotOutDir, { setColorScheme: (colorScheme) => updatePreferences({ colorScheme }) })
      .then(() => exitApp(0))
      .catch((error: Error) => {
        console.error(`[screenshots] ${error.message}`);
        exitApp(1);
      });
  }
});

/** Picks an option in one of the app's `Select` dropdowns by clicking, like a user (smoke test only). */
async function chooseOption(win: BrowserWindow, selector: string, value: string): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const option = `document.querySelector('[data-select-list] [data-option-value=${JSON.stringify(JSON.stringify(value)).slice(1, -1)}]')`;
  if (!(await waitInPage(win, option, 3_000))) return false;
  await js(`${option}.click()`);
  return waitInPage(win, `!document.querySelector('[data-select-list]') && document.querySelector(${JSON.stringify(selector)}).dataset.value === ${JSON.stringify(value)}`, 3_000);
}

/**
 * Auto model, without ever calling a model or starting a session: Auto leads the model menu with its wand and a
 * line under it; picked, the chip reads Auto. Start with a prompt the stubbed router holds forever opens the session
 * at once, with the prompt and "Auto is choosing a model…" (the held prompt never reaches Claude Code), and Stop
 * session ends it. Turned
 * off in Settings, Auto leaves the menu and a saved Auto says it starts on the default model. Settings keeps at least
 * one model to pick. Everything is put back.
 */
async function runAutoModelStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const view = '[data-new-session-view]';
  const prompt = `document.querySelector('${view} [data-composer]')`;
  const chip = (value: string) => `document.querySelector('${view} [data-model-chip="${value}"]')`;
  const before = preferences.get().autoModel;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
  if (!(await waitInPage(win, `${prompt}`, 5_000))) return 'New session did not open';
  const previousModel = (await js(`document.querySelector('${view} [data-model-select]').dataset.value`)) as string;
  const restore = async () => {
    updatePreferences({ autoModel: before });
    await setFieldValue(win, `${view} [data-composer]`, '').catch(() => {});
    if (previousModel !== 'auto') await chooseChoice(win, 'model', previousModel, view).catch(() => false);
  };
  try {
    updatePreferences({ autoModel: { ...before, enabled: true } });
    await js(`document.querySelector('${view} [data-model-select]').click()`);
    if (!(await waitInPage(win, "document.querySelector('[data-menu=\"model\"] [role=menuitemradio]')", 2_000))) return 'the model menu did not open';
    const menu = (await js(
      "(() => { const items = [...document.querySelectorAll('[data-menu=\"model\"] [role=menuitemradio]')]; const first = items[0]; return { first: first?.dataset.choice, wand: !!first?.querySelector('svg'), line: first?.nextElementSibling?.getAttribute('role') === 'separator', second: items[1]?.dataset.choice }; })()",
    )) as { first?: string; wand: boolean; line: boolean; second?: string };
    if (menu.first !== 'auto' || !menu.wand || !menu.line || menu.second !== '') return `Auto is not first with its wand and a line before Default model: ${JSON.stringify(menu)}`;
    await js("document.querySelector('[data-menu=\"model\"] [data-choice=\"auto\"]').click()");
    if (!(await waitInPage(win, `${chip('auto')}?.querySelector('svg') && ${chip('auto')}.innerText.includes('Auto')`, 2_000))) return 'picking Auto did not show the wand and Auto on the chip';
    await shot(win, 'auto-model-chip.png');

    // Start on Auto opens the session before Auto has picked. Only with a folder (the prompt is disabled without one),
    // on Auto, and a prompt the stub holds: then Claude Code never gets it, and the session is stopped after.
    let choosing = 'skipped (no folder)';
    const hasFolder = (await js(`!!document.querySelector('[data-folder-select]')?.dataset.value && !${prompt}.disabled`)) as boolean;
    if (hasFolder) {
      const text = 'Smoke Auto check, never started [smoke: hold]';
      await setFieldValue(win, `${view} [data-composer]`, text);
      if (!(await js(`!!${chip('auto')} && ${prompt}.value.includes('[smoke: hold]')`))) return 'not on Auto with the held prompt; not starting';
      await js(`document.querySelector('${view} [data-composer-submit]').click()`);
      const session = '[data-current-session]';
      const opened = `document.querySelector('${session} [data-auto-choosing]')?.innerText.includes('Auto is choosing a model') && [...document.querySelectorAll('${session} [data-item-kind="user"]')].some((el) => el.innerText.includes('[smoke: hold]'))`;
      if (!(await waitInPage(win, opened, 5_000))) {
        const seen = await js(
          `JSON.stringify({ newSession: !!document.querySelector('${view}'), session: document.querySelector('${session}')?.dataset.currentSession ?? null, choosing: document.querySelector('${session} [data-auto-choosing]')?.innerText ?? null, streaming: document.querySelector('${session} [data-streaming]')?.innerText ?? null, userItems: [...document.querySelectorAll('${session} [data-item-kind="user"]')].map((el) => el.innerText.slice(0, 60)), toasts: [...document.querySelectorAll('[data-toast]')].map((t) => t.innerText) })`,
        ).catch(() => 'unknown');
        return `Start on Auto did not open the session with the prompt and Auto is choosing a model…: ${seen}`;
      }
      await shot(win, 'auto-model-choosing.png');
      await js(`document.querySelector('${session} [data-more-menu]').click()`);
      if (!(await waitInPage(win, "document.querySelector('[data-stop-session]:not(:disabled)')", 3_000))) return 'no Stop session while Auto was choosing';
      await js("document.querySelector('[data-stop-session]').click()");
      if (!(await waitInPage(win, `!document.querySelector('${session} [data-auto-choosing]')`, 5_000))) return 'Stop session left Auto choosing';
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
      if (!(await waitInPage(win, `${prompt}`, 5_000))) return 'New session did not open again';
      choosing = 'Start opened the session while Auto chose';
    }

    // Off in Settings: Auto leaves the menu, and the saved Auto starts on the default model, which the note says.
    updatePreferences({ autoModel: { ...before, enabled: false } });
    if (!(await waitInPage(win, `${chip('default')} && document.querySelector('${view} [data-auto-off-note]')`, 3_000))) return 'with Auto off, the chip did not fall back to the default model with a note';
    await js(`document.querySelector('${view} [data-model-select]').click()`);
    if (!(await waitInPage(win, "document.querySelector('[data-menu=\"model\"] [role=menuitemradio]') && !document.querySelector('[data-menu=\"model\"] [data-choice=\"auto\"]')", 2_000))) return 'Auto stayed in the menu while off';
    pressKey(win, 'Escape');
    updatePreferences({ autoModel: { ...before, enabled: true } });

    // Settings › Conversation: the block, and the last model to pick can't be unchecked.
    await js("document.querySelector('[data-open-settings]').click()");
    await waitInPage(win, "document.querySelector('[data-settings]')", 3_000);
    await js("document.querySelector('[data-settings-section=\"conversation\"]').click()");
    if (!(await waitInPage(win, "document.querySelectorAll('[data-auto-model-settings] [data-auto-model-allowed]').length === 3", 3_000))) return 'Settings › Conversation has no Auto model block';
    updatePreferences({ autoModel: { ...before, enabled: true, allowed: ['sonnet'] } });
    if (!(await waitInPage(win, "document.querySelector('[data-auto-model-allowed=\"sonnet\"]')?.disabled === true", 2_000))) return 'the last model to pick could be unchecked';
    await js("document.querySelector('[data-auto-model-allowed=\"opus\"]').click()");
    if (!(await until(() => preferences.get().autoModel.allowed.join() === 'sonnet,opus'))) return 'checking Opus did not save';
    await shot(win, 'auto-model-settings.png');
    await js("document.querySelector('[data-close-settings]').click()");
    return `ok: Auto leads the menu, the chip reads Auto; ${choosing}; off, it falls back with a note; settings keep a model`;
  } finally {
    await restore();
  }
}

/** Picks `value` from a composer chip's menu (`ChoiceMenu`): the chip `[data-<name>-select]` inside `scope`, its menu `[data-menu=<name>]`. */
async function chooseChoice(win: BrowserWindow, name: string, value: string, scope = 'body'): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const chip = `document.querySelector(${JSON.stringify(`${scope} [data-${name}-select]`)})`;
  await js(`${chip}.click()`);
  const option = `document.querySelector(${JSON.stringify(`[data-menu="${name}"] [data-choice="${value}"]`)})`;
  if (!(await waitInPage(win, option, 3_000))) return false;
  await js(`${option}.click()`);
  return waitInPage(win, `!document.querySelector('[data-menu="${name}"]') && ${chip}.dataset.value === ${JSON.stringify(value)}`, 3_000);
}

/**
 * Optional live step (SWITCHBOARD_SMOKE_LIVE_CWD): starts a real Haiku session
 * through the UI, approves its permission prompt and waits for the reply.
 */
async function runLiveSessionStep(win: BrowserWindow, cwd: string): Promise<string> {
  const click = (selector: string) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shot = async (name: string) => writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage()).toPNG());
  await click('[data-new-session]');
  // Pick the sandbox in the folder picker: open it, filter by the path, choose the match.
  await click('[data-folder-select]');
  if (!(await waitInPage(win, "document.querySelector('[data-folder-list] input')", 3_000))) return 'folder picker did not open';
  await setFieldValue(win, '[data-folder-list] input', cwd);
  if (!(await waitInPage(win, `document.querySelector('[data-folder-option=${JSON.stringify(JSON.stringify(cwd)).slice(1, -1)}]')`, 5_000))) return 'folder not offered';
  await shot('folder-picker.png');
  await win.webContents.executeJavaScript(`document.querySelector('[data-folder-option=${JSON.stringify(JSON.stringify(cwd)).slice(1, -1)}]').click()`);
  await click('[data-model-select]');
  if (!(await waitInPage(win, "document.querySelector('[data-menu=\"model\"] [data-choice=\"haiku\"]')", 3_000))) return 'Haiku not offered in the model menu';
  await click('[data-menu="model"] [data-choice="haiku"]');
  // Attach a red square through the attach button's file input, like picking a file.
  await win.webContents.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e03131';
    ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const input = document.querySelector('[data-attach-input]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'square.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  if (!(await waitInPage(win, "document.querySelector('[data-composer]').closest('div').parentElement.querySelector('img')", 3_000))) return 'attached image not shown';
  await setFieldValue(win, '[data-composer]', 'Run exactly this with the Bash tool: touch smoke-ui.txt — then reply with the colour of the attached square in one word, followed by exactly: SMOKE OK');
  if (!(await waitInPage(win, "!document.querySelector('[data-composer-submit]').disabled"))) return 'submit stayed disabled';
  // Never start a session anywhere but the requested sandbox folder.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const chosen = await win.webContents.executeJavaScript("document.querySelector('[data-folder-select]').dataset.value");
  if (chosen !== cwd) return `aborted: folder field shows ${chosen}, not the sandbox`;
  await shot('new-session.png');
  await click('[data-composer-submit]');
  if (!(await waitInPage(win, "document.querySelector('[data-permission-allow]')", 60_000))) return 'no permission prompt';
  await shot('permission.png');
  await click('[data-permission-allow]');
  // The prompt itself contains the phrase, so only an assistant text item counts.
  const replied = "[...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => el.innerText.includes('SMOKE OK'))";
  if (!(await waitInPage(win, replied, 60_000))) return 'no reply';
  await new Promise((resolve) => setTimeout(resolve, 800));
  await shot('session.png');
  if (!(await waitInPage(win, "document.querySelector('[data-transcript-image] img')", 5_000))) return 'the attached image is not shown in the transcript';
  // Save it from its context menu: the smoke run writes it to its throwaway profile instead of asking where.
  await win.webContents.executeJavaScript(`(() => {
    const thumb = document.querySelector('[data-transcript-image]');
    const r = thumb.getBoundingClientRect();
    thumb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
  })()`);
  if (!(await waitInPage(win, "document.querySelector('[data-image-menu-save]')", 3_000))) return 'the image has no Save image… in its context menu';
  await click('[data-image-menu-save]');
  if (!(await waitInPage(win, "document.querySelector('[data-image-saved]')", 5_000))) return 'saving the image did not confirm';
  const savedPath = (await win.webContents.executeJavaScript("document.querySelector('[data-image-saved]').dataset.imageSaved")) as string;
  if (!savedPath.startsWith(smokeImageExports()) || !existsSync(savedPath) || !readFileSync(savedPath).subarray(1, 4).equals(Buffer.from('PNG'))) return `the saved image is not a PNG at ${savedPath}`;
  const colour = await win.webContents.executeJavaScript(
    "[...document.querySelectorAll('[data-item-kind=\"text\"]')].map((el) => el.innerText).find((t) => t.includes('SMOKE OK'))",
  );
  console.log(`[smoke] Claude about the attached image: ${JSON.stringify(colour)}`);

  // Slash commands: "/" opens the palette with the session's commands; pick /context with the keyboard.
  await win.webContents.executeJavaScript("document.querySelector('[data-composer]').focus()");
  await win.webContents.insertText('/');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-palette] [role=option]').length > 5", 15_000))) return 'slash palette did not open';
  const paletteCount = await win.webContents.executeJavaScript("document.querySelectorAll('[data-palette] [role=option]').length");
  await win.webContents.insertText('conte');
  await shot('palette.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const composed = await win.webContents.executeJavaScript("document.querySelector('[data-composer]').value");
  if (!String(composed).startsWith('/context')) return `palette composed ${JSON.stringify(composed)}`;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => /Context Usage/i.test(el.innerText))", 30_000))) return '/context output not shown';
  console.log(`[smoke] palette showed ${paletteCount} commands; /context output rendered`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shot('slash-command.png');
  const js = (code: string) => win.webContents.executeJavaScript(code);

  // Send now: while Claude writes a long reply, the button turns into Queue ▾ with Send now in its menu,
  // and ⌘⇧↩ stops the reply so the new message is answered at once.
  const sentNow = await runSendNowLive(win);
  if (!sentNow.startsWith('ok')) return sentNow;
  console.log(`[smoke] ${sentNow}`);
  const liveId = (await js("document.querySelector('[data-current-session]').dataset.currentSession")) as string;

  // An agent: the header's More menu says "1 running" while it runs, and the dialog shows what it's doing.
  // The prompt has inline code, so the user bubble must render it as code.
  await setFieldValue(win, '[data-composer]', 'Use the Agent tool (subagent_type `general-purpose`) to list the files in this folder with the Glob tool and count them. Then reply with exactly: AGENT OK');
  await js("document.querySelector('[data-composer-submit]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-item-kind=\"user\"] code')].some((c) => c.innerText === 'general-purpose')", 10_000))) return 'inline code in your message is not styled';
  const more = "document.querySelector('[data-current-session] [data-more-menu]')";
  if (!(await waitInPage(win, `${more}?.getAttribute('aria-label').includes('running')`, 60_000))) return 'the More menu did not say an agent was running';
  await js(`${more}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-agents-button]:not(:disabled)')", 3_000))) return 'no Agents item in the More menu while the agent ran';
  const pill = ((await js("document.querySelector('[data-agents-button]').innerText")) as string).replace(/\s+/g, ' ').trim();
  await js("document.querySelector('[data-agents-button]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-agents] [data-agent-run]')", 5_000))) return 'agents dialog empty';
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await shot('agents.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => el.innerText.includes('AGENT OK'))", 90_000))) return 'no reply after the agent';
  if (!(await waitInPage(win, `!${more}.getAttribute('aria-label').includes('running')`, 5_000))) return 'the More menu still says an agent is running after it finished';
  console.log(`[smoke] the More menu's Agents item showed ${JSON.stringify(pill)} and its run; your inline code was styled`);

  // Tools, live: the session runs here, so its MCP servers can be switched.
  await js("document.querySelector('[data-open-tools]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-capabilities]')?.innerText.includes('Live from this session')", 20_000))) return 'Tools did not answer live';
  const switches = await js("document.querySelectorAll('[data-capabilities] [role=switch]').length");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await waitInPage(win, "!document.querySelector('[data-capabilities]')", 2_000);

  // Effort can change mid-session, and the context meter opens a breakdown like /context.
  if (!(await chooseChoice(win, 'effort', 'low', '[data-current-session]'))) return 'effort did not change';
  await chooseChoice(win, 'effort', '', '[data-current-session]');
  if (!(await waitInPage(win, "document.querySelector('[data-context-meter] button')", 15_000))) return 'no context meter for the running session';
  const contextLabel = ((await js("document.querySelector('[data-context-meter] button').innerText")) as string).trim();
  await js("document.querySelector('[data-context-meter] button').click()");
  if (!(await waitInPage(win, "document.querySelectorAll('[data-context-breakdown] li').length > 1", 15_000))) return 'context breakdown did not load';
  const categories = (await js("document.querySelectorAll('[data-context-breakdown] li').length")) as number;
  await shot('context.png');
  await js("document.querySelector('[data-context-meter] button').click()");
  console.log(`[smoke] effort changed to low and back; context ${JSON.stringify(contextLabel)} with ${categories - 1} categories`);

  // Undo file changes since the prompt: the preview answers (Bash's touch isn't a tracked edit).
  await js("document.querySelector('[data-item-kind=\"user\"] [data-message-actions] button[aria-label^=\"Undo file changes\"]').click()");
  if (!(await waitInPage(win, "document.querySelector('[role=alertdialog]') && !document.querySelector('[role=alertdialog]').innerText.includes('Checking what changed')", 20_000))) return 'rewind preview did not answer';
  const rewindPreview = ((await js("document.querySelector('[role=alertdialog]').innerText")) as string).replace(/\s+/g, ' ').slice(0, 120);
  await shot('rewind.png');
  await js("[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText === 'Cancel').click()");

  // Fork from Claude's reply: a new session opens with the conversation up to there.
  await js("[...document.querySelectorAll('[data-item-kind=\"text\"]')].find((el) => el.innerText.includes('SMOKE OK')).querySelector('[data-message-actions] button[aria-label^=\"Fork\"]').click()");
  if (!(await waitInPage(win, `document.querySelector('[data-current-session]') && document.querySelector('[data-current-session]').dataset.currentSession !== '${liveId}' && [...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => el.innerText.includes('SMOKE OK'))`, 20_000))) {
    return 'fork from the reply did not open a new session with the conversation';
  }
  console.log(`[smoke] live tools: ${switches} MCP switches; rewind preview: ${JSON.stringify(rewindPreview)}; forked from the reply`);
  await js(`document.querySelector('[data-session-id="${liveId}"]').click()`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${liveId}"]')`, 5_000))) return 'could not return to the session after forking';

  // Open the same session in the Claude Code TUI from the ⋯ menu: it runs here, so the panel offers to stop it first.
  await js("document.querySelector('[data-current-session] [data-more-menu]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-open-claude-tui]')", 3_000))) return 'no Claude Code item in the ⋯ menu';
  await js("document.querySelector('[role=menuitem][data-open-claude-tui]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-terminal-panel] button')].some((b) => b.innerText === 'Stop it here and open')", 5_000))) {
    return 'expected the stop-and-open choice for a session running here';
  }
  await js("[...document.querySelectorAll('[data-terminal-panel] button')].find((b) => b.innerText === 'Stop it here and open').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-terminal] textarea')", 10_000))) return 'the Claude Code terminal tab did not open';
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await shot('claude-tui.png');
  // Close the TUI (its last tab, so the panel hides too) and give its process time to leave the registry, or delete would (rightly) refuse.
  await js("document.querySelector('[data-terminal-panel] [aria-label^=\"Close\"]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  // Delete it again through the context menu; the transcript must land in the Trash.
  const sessionId = await win.webContents.executeJavaScript("document.querySelector('[data-current-session]')?.getAttribute('data-current-session')");
  if (!sessionId) return 'could not find the new session row';
  await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-session-id="${sessionId}"]');
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 }));
  })()`);
  if (!(await waitInPage(win, "[...document.querySelectorAll('[role=menuitem]')].some((b) => b.innerText.startsWith('Delete session'))", 5_000))) return 'no delete menu item';
  await win.webContents.executeJavaScript("[...document.querySelectorAll('[role=menuitem]')].find((b) => b.innerText.startsWith('Delete session')).click()");
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 5_000))) return 'no confirmation dialog';
  await shot('delete-confirm.png');
  await win.webContents.executeJavaScript("document.querySelector('[data-confirm]').click()");
  if (!(await waitInPage(win, `!document.querySelector('[data-session-id="${sessionId}"]') && !document.querySelector('[role=alertdialog]')`, 15_000))) {
    const message = await win.webContents.executeJavaScript("document.querySelector('[role=alertdialog]')?.innerText ?? ''");
    return `session row still there after delete ${message}`;
  }
  const trashed = existsSync(join(homedir(), '.Trash', `${sessionId}.jsonl`));
  return trashed ? 'ok' : 'deleted, but the transcript is not in ~/.Trash';
}

/**
 * The live part of Send now and Up next (in the sandbox session): a long reply starts, a message sent meanwhile
 * waits in Up next (not in the conversation), the message box offers Queue ▾ with Send now, and ⌘⇧↩ stops the reply
 * and gets the new message answered before the long one could finish. The queued message then goes after it.
 */
async function runSendNowLive(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // A reply's text starts with its "Claude" label: what Claude wrote is the last line.
  const texts = "[...document.querySelectorAll('[data-item-kind=\"text\"]')].map((el) => el.innerText.trim().split('\\n').at(-1).trim())";
  await setFieldValue(win, '[data-composer]', 'Count from 1 to 1000, one number per line, with no other text.');
  await js("document.querySelector('[data-composer-submit]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-send-menu]')", 30_000))) return 'no Queue ▾ while Claude was working';
  const label = ((await js("document.querySelector('[data-current-session] [data-composer-submit]').innerText")) as string).trim();
  if (label !== 'Queue') return `the main button said ${JSON.stringify(label)} while Claude was working, not Queue`;
  // Queued: it waits in Up next, outside the conversation, until the turn ends.
  await setFieldValue(win, '[data-composer]', 'Reply with exactly: QUEUED ONE');
  await js("document.querySelector('[data-current-session] [data-composer-submit]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-current-session] [data-queue] [data-queue-item]')].some((b) => b.getAttribute('aria-label').includes('QUEUED ONE'))", 5_000))) return 'a message sent while Claude works did not show in Up next';
  if (!(await waitInPage(win, "document.querySelector('[data-composer]').value === ''", 3_000))) return 'the queued message stayed in the message box';
  if ((await js(`${texts}.some((t) => t.includes('QUEUED ONE'))`)) as boolean) return 'a queued message was in the conversation before its turn';
  await shot(win, 'up-next.png');
  await setFieldValue(win, '[data-composer]', 'Reply with exactly: SENT NOW');
  await js("document.querySelector('[data-current-session] [data-send-menu]').click()");
  if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-send-now]:not(:disabled)') && document.querySelector('[role=menu] [data-queue-message]')", 3_000))) return 'the ▾ menu did not offer Queue and Send now';
  const hint = ((await js("document.querySelector('[role=menu] [data-send-now]').innerText")) as string).replace(/\s+/g, ' ').trim();
  await shot(win, 'send-now-menu.png');
  // Esc closes the menu only; it must not stop Claude (the reply has to still be running for ⌘⇧↩ to matter).
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'Esc did not close the ▾ menu';
  if (!(await js("!!document.querySelector('[data-current-session] [data-send-menu]')"))) return 'Esc on the menu also stopped Claude';
  await js("document.querySelector('[data-composer]').focus()");
  const sentAt = performance.now();
  pressKey(win, 'Return', ['meta', 'shift']);
  if (!(await waitInPage(win, "document.querySelector('[data-composer]').value === ''", 5_000))) return '⌘⇧↩ did not send the message';
  if (!(await waitInPage(win, `${texts}.some((t) => t === 'SENT NOW')`, 60_000))) return `no answer to the message sent now (last replies: ${JSON.stringify(((await js(`${texts}.slice(-3)`)) as string[]).map((t) => t.slice(0, 60)))})`;
  const seconds = ((performance.now() - sentAt) / 1000).toFixed(1);
  // Stopped: the count never got to 1000.
  if ((await js(`${texts}.some((t) => t === '1000')`)) as boolean) return 'the long reply ran to the end: Send now did not stop it';
  // The message that waited goes once the one sent now is answered, and leaves Up next.
  if (!(await waitInPage(win, `${texts}.some((t) => t === 'QUEUED ONE')`, 60_000))) return 'the message in Up next was never sent after the turn ended';
  if (!(await waitInPage(win, "!document.querySelector('[data-current-session] [data-queue]')", 5_000))) return 'Up next stayed after its message was sent';
  if (!(await waitInPage(win, "!document.querySelector('[data-current-session] [data-send-menu]')", 15_000))) return 'Queue ▾ stayed after Claude finished';
  await shot(win, 'send-now.png');
  return `ok: Send now (${hint}) stopped the count and was answered in ${seconds}s, then the message in Up next went`;
}

/** When the smoke run killed the engine, to time the restart. */
let crashedAt = 0;
/** The session the smoke steps work in (the newest one with messages). */
let smokeSessionId: string | null = null;
/** What was on screen when the steps finished, for the report (not checked). */
let rendering: Record<string, number> = {};
const smokeRun = new SmokeRun({ log: (line) => console.log(line), cleanup: () => closeOverlays(BrowserWindow.getAllWindows()[0]) });

/**
 * Adds a project action through the editor (saving closes it, says "Action saved" and adds its pill),
 * runs it from the header and checks it opened a terminal tab.
 */
async function runActionStep(win: BrowserWindow): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // Actions live in the header's More menu.
  await js("document.querySelector('[data-current-session] [data-actions-menu]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-edit-actions]')", 3_000))) return false;
  await js("document.querySelector('[role=menuitem][data-edit-actions]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-add-action]')", 3_000))) return false;
  await js("document.querySelector('[data-add-action]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-action-name]')", 3_000))) return false;
  await setFieldValue(win, '[data-action-name]', 'Smoke action');
  await setFieldValue(win, '[data-action-command]', 'echo "action ran on ${branch} in $PWD"');
  await shot(win, 'action-editor.png');
  await js("document.querySelector('[data-save-action]').click()");
  // Saving closes the editor and confirms it; the new action gets a pill above the message box.
  if (!(await waitInPage(win, "!document.querySelector('[role=dialog]')", 3_000))) return false;
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-action-status]')?.innerText.includes('Action saved')", 2_000))) return false;
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-action-pills] [data-action-pill=\"smoke-action\"]')", 3_000))) return false;
  await shot(win, 'action-saved.png');
  await js("document.querySelector('[data-current-session] [data-actions-menu]').click()");
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-action=\"smoke-action\"]')", 3_000))) return false;
  await js("document.querySelector('[role=menuitem][data-action=\"smoke-action\"]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-terminal-panel] button')].some((b) => b.innerText.includes('Smoke action'))", 5_000))) return false;
  // A finished action is announced (recorded, not shown, in smoke mode): it ran to the end.
  if (!(await until(() => recordedNotifications.some((n) => n.kind === 'action-done' && n.title.includes('Smoke action')), 10_000))) return false;
  await shot(win, 'action.png');
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  return true;
}

/**
 * Clicks the element like a person would: real mouse events at its centre, so whatever is painted on
 * top there gets the click (a `.click()` from script would skip that). `right` opens its context menu.
 * Returns what was hit, for the report.
 */
async function clickLikeAUser(win: BrowserWindow, selector: string, button: 'left' | 'right' = 'left'): Promise<{ hit: boolean; at: string }> {
  const probe = (await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: !!top && el.contains(top), at: top ? top.tagName.toLowerCase() + (top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\\s+/).join('.') : '') : 'nothing' };
  })()`)) as { x: number; y: number; hit: boolean; at: string } | null;
  if (!probe) return { hit: false, at: 'element not found' };
  win.webContents.sendInputEvent({ type: 'mouseMove', x: probe.x, y: probe.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: probe.x, y: probe.y, button, clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: probe.x, y: probe.y, button, clickCount: 1 });
  return { hit: probe.hit, at: probe.at };
}

/**
 * Runs a long project action from the header menu, then stops and restarts it from the run strip above
 * the terminal: with real mouse events in light, with Tab and Enter in dark. The command only sleeps.
 */
async function runActionTerminalStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const scheme = preferences.get().colorScheme;
  try {
    return await actionTerminalChecks(win, js);
  } finally {
    updatePreferences({ colorScheme: scheme });
  }
}

async function actionTerminalChecks(win: BrowserWindow, js: (code: string) => Promise<unknown>): Promise<string> {
  await setColorScheme(win, 'light');
  const strip = "document.querySelector('[data-terminal-run-strip]')";
  const state = (value: string) => `${strip}?.dataset.terminalRunState === '${value}'`;
  const elapsed = `(${strip}?.querySelector('[data-terminal-run-elapsed]')?.innerText ?? '').trim()`;
  if (!(await addAction(win, 'Smoke wait', 'sleep 60'))) return 'failed: could not add the action, or saving did not close the editor';
  // Run it from the header menu, wherever its pill ended up.
  await js("document.querySelector('[data-current-session] [data-actions-menu]').click()");
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-action=\"smoke-wait\"]')", 3_000))) return 'failed: action not in the menu';
  await js("document.querySelector('[role=menuitem][data-action=\"smoke-wait\"]').click()");
  if (!(await waitInPage(win, `${state('running')} && document.querySelector('[data-terminal-stop]')`, 8_000))) return 'failed: no run strip with Stop on the running action';
  // The strip shows the tab's title until the project's actions are read again, then the command.
  await waitInPage(win, `${strip}.querySelector('[data-terminal-run-command]')?.innerText === 'sleep 60'`, 3_000);
  // The strip sits between the tabs and the terminal, not over it, and says what runs where, for how long.
  const look = (await js(`(() => {
    const s = ${strip}.getBoundingClientRect(), t = document.querySelector('[data-terminal-panel] [role=tabpanel]:not(.hidden)').getBoundingClientRect();
    return { height: Math.round(s.height), above: s.bottom <= t.top + 0.5, status: ${strip}.querySelector('[data-terminal-run-status]').innerText, command: ${strip}.querySelector('[data-terminal-run-command]').innerText, dot: !!document.querySelector('[data-terminal-tab-dot="running"]') };
  })()`)) as { height: number; above: boolean; status: string; command: string; dot: boolean };
  if (look.height !== 34 || !look.above) return `failed: the run strip is ${look.height}px high and ${look.above ? 'above' : 'over'} the terminal`;
  if (look.status !== 'Running' || look.command !== 'sleep 60' || !look.dot) return `failed: the strip says "${look.status}" / "${look.command}", running dot on the tab: ${look.dot}`;
  const firstTick = (await js(elapsed)) as string;
  if (!(await waitInPage(win, `${elapsed} !== ${JSON.stringify(firstTick)}`, 2_500))) return `failed: the elapsed time stayed at ${firstTick}`;
  await shot(win, 'action-running.png');

  // Stop and Restart with the mouse.
  const stop = await clickLikeAUser(win, '[data-terminal-stop]');
  if (!(await waitInPage(win, state('failed'), 8_000))) return `failed: Stop did not end the command (the click landed on ${stop.at})`;
  const stopped = (await js(`${strip}.querySelector('[data-terminal-run-status]').innerText`)) as string;
  // POSIX shells report Ctrl+C as 130; on Windows the console ends with its own non-zero code.
  const stoppedLabel = process.platform === 'win32' ? /^Failed \(exit [1-9]\d*\)$/ : /^Failed \(exit 130\)$/;
  if (!stoppedLabel.test(stopped) || !(await js("!!document.querySelector('[data-terminal-tab-dot=\"failed\"]') && !document.querySelector('[data-terminal-stop]')"))) return `failed: after Stop the strip says "${stopped}"`;
  await shot(win, 'action-stopped.png');
  const restart = await clickLikeAUser(win, '[data-terminal-restart]');
  if (!(await waitInPage(win, `${state('running')} && document.querySelector('[data-terminal-stop]')`, 5_000))) return `failed: Restart did not run it again (the click landed on ${restart.at})`;
  // Restart while it runs stops it first and starts a new run: the clock starts over.
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  const before = (await js(elapsed)) as string;
  const again = await clickLikeAUser(win, '[data-terminal-restart]');
  if (!(await waitInPage(win, `${state('running')} && /^0:0[01]$/.test(${elapsed})`, 8_000))) return `failed: Restart on the running command (at ${before}, the click landed on ${again.at}) did not start a new run`;

  // The same from the keyboard, in the dark theme: Tab from the tab reaches the strip (xterm keeps Tab for the shell), Enter presses.
  if (!(await setColorScheme(win, 'dark'))) return 'failed: the dark theme did not apply';
  // A terminal that becomes active takes focus on the next frame (XTerm.tsx), and xterm keeps Tab for the shell:
  // start from the tab again whenever focus ends up in the terminal, and wait for each Tab to move focus.
  const focused = "(() => { const el = document.activeElement; return el ? (el.closest('.xterm') ? 'xterm' : el.tagName.toLowerCase() + (el.getAttribute('aria-label') ? ` \"${el.getAttribute('aria-label')}\"` : '')) : 'nothing'; })()";
  const tabTo = async (selector: string) => {
    const trail: string[] = [];
    await js("document.querySelector('[data-terminal-panel] [role=tab][aria-selected=true]').focus()");
    for (let i = 0; i < 16; i++) {
      if (await js(`document.activeElement?.matches(${JSON.stringify(selector)})`)) return null;
      const before = (await js(focused)) as string;
      trail.push(before);
      if (before === 'xterm') {
        await js("document.querySelector('[data-terminal-panel] [role=tab][aria-selected=true]').focus()");
        continue;
      }
      await js('window.__smokeFocus = document.activeElement');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await waitInPage(win, 'document.activeElement !== window.__smokeFocus', 500);
    }
    return trail.join(' → ');
  };
  const press = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'char', keyCode: keyCode === 'Return' ? '\r' : keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const toStop = await tabTo('[data-terminal-stop]');
  if (toStop) return `failed: Tab from the terminal tab did not reach Stop (${toStop})`;
  press('Return');
  if (!(await waitInPage(win, state('failed'), 8_000))) return 'failed: Enter on Stop did not end the command';
  await shot(win, 'action-stopped-dark.png');
  const toRestart = await tabTo('[data-terminal-restart]');
  if (toRestart) return `failed: Tab from the terminal tab did not reach Restart (${toRestart})`;
  press('Return');
  if (!(await waitInPage(win, state('running'), 5_000))) return 'failed: Enter on Restart did not run it again';
  await clickLikeAUser(win, '[data-terminal-stop]');
  if (!(await waitInPage(win, state('failed'), 8_000))) return 'failed: the last Stop did not end the command';

  // The selected tab's × closes it.
  const tabs = () => js("document.querySelectorAll('[data-terminal-panel] [role=tab]').length") as Promise<number>;
  const count = await tabs();
  const close = await clickLikeAUser(win, "[data-terminal-panel] [role=tab][aria-selected=true] + [data-terminal-tab-close]");
  if (!(await waitInPage(win, `!document.querySelector('[data-terminal-panel]') || document.querySelectorAll('[data-terminal-panel] [role=tab]').length < ${count}`, 3_000))) return `failed: the tab's × did not close it (the click landed on ${close.at})`;
  return `ok: the 34px strip above the terminal showed Running, the command and a ticking clock; Stop (${stopped}), Restart, and Restart while running worked with the mouse in light, Tab + Enter reached Stop and Restart in dark, and × closed the tab`;
}

/** The current terminal panel's box, its dock and whether it is maximized. */
const PANEL_BOX = `(() => {
  const p = document.querySelector('[data-terminal-panel]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom), dock: p.dataset.terminalDockSide, maximized: p.hasAttribute('data-terminal-maximized') };
})()`;
type PanelBox = { top: number; left: number; width: number; height: number; bottom: number; dock: string; maximized: boolean };

/**
 * The terminal panel's layout: its own darker surface with a grab handle and padding, the footer folded into a
 * ring in the message box, resizing by drag and keys, docking right (and back below while Changes holds the
 * right), maximize with its button, Esc and ⌘⇧J, in light and dark and at the narrowest window. Reads nothing
 * but the session's own shell tab.
 */
async function runTerminalLayoutStep(win: BrowserWindow): Promise<string> {
  const scheme = preferences.get().colorScheme;
  const bounds = win.getBounds();
  try {
    return await terminalLayoutChecks(win);
  } finally {
    updatePreferences({ colorScheme: scheme });
    win.setBounds(bounds);
    // Leave the next steps a closed panel docked below.
    const js = (code: string) => win.webContents.executeJavaScript(code);
    if (await js("document.querySelector('[data-terminal-dock=\"right\"]') !== null")) await js("document.querySelector('[data-terminal-dock]').click()");
    if (await js("document.querySelector('[data-terminal-panel]') !== null")) await js("document.querySelector('[data-terminal-hide]').click()");
  }
}

async function terminalLayoutChecks(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const box = () => js(PANEL_BOX) as Promise<PanelBox | null>;
  const key = (keyCode: string, modifiers: Array<'meta' | 'shift'> = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: platformModifiers(modifiers) });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: platformModifiers(modifiers) });
  };
  await setColorScheme(win, 'light');
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[data-terminal-panel] [data-terminal] textarea')", 5_000))) return 'failed: the panel did not open with a terminal';
  await settle(win);

  // Its own surface: the terminal background, a shadow on the top edge, a 36x4 pill centred on it, and padding round the terminal.
  const look = (await js(`(() => {
    const p = document.querySelector('[data-terminal-panel]'), pill = p.querySelector('[data-terminal-resize] > span');
    const pr = p.getBoundingClientRect(), r = pill.getBoundingClientRect(), pad = getComputedStyle(p.querySelector('[data-terminal]').parentElement);
    return { bg: getComputedStyle(p).backgroundColor, shadow: getComputedStyle(p).boxShadow !== 'none', pill: Math.round(r.width) + 'x' + Math.round(r.height), centred: Math.abs(r.left + r.width / 2 - (pr.left + pr.width / 2)) < 2, padding: pad.paddingTop + ' ' + pad.paddingLeft };
  })()`)) as { bg: string; shadow: boolean; pill: string; centred: boolean; padding: string };
  if (look.bg !== 'rgb(13, 16, 22)' || !look.shadow) return `failed: the panel is ${look.bg}, shadow ${look.shadow}`;
  if (look.pill !== '36x4' || !look.centred) return `failed: the grab handle is ${look.pill}, centred ${look.centred}`;
  if (look.padding !== '10px 16px') return `failed: the terminal's padding is ${look.padding}`;

  // Docked below, the footer row folds into a ring next to Send; it shows every number and opens the same popup.
  if (!(await waitInPage(win, "!document.querySelector('[data-current-session] [data-session-footer]') && document.querySelector('[data-current-session] [data-folded-meter]')", 5_000))) {
    return 'failed: the footer did not fold into a ring in the message box';
  }
  const ring = (await js("document.querySelector('[data-folded-meter]').dataset.tooltip")) as string;
  // A real click, which moves focus off the terminal (xterm keeps the keys, Escape too, while it has focus).
  await clickLikeAUser(win, '[data-folded-meter]');
  if (!(await waitInPage(win, "document.querySelector('[data-context-breakdown]')", 2_000))) return 'failed: the ring did not open the context popup';
  await shot(win, 'terminal-ring.png');
  key('Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-context-breakdown]')", 2_000))) return 'failed: Escape did not close the ring popup';

  // Resize from the handle: ↑ from the keyboard, then a drag.
  const start = (await box())!;
  await js("document.querySelector('[data-terminal-resize]').focus()");
  key('Up');
  if (!(await waitInPage(win, `${PANEL_BOX}.height === ${start.height + 24}`, 2_000))) return `failed: ↑ on the handle did not make the panel taller (${start.height}px)`;
  const grip = (await js("(() => { const r = document.querySelector('[data-terminal-resize] > span').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()")) as { x: number; y: number };
  win.webContents.sendInputEvent({ type: 'mouseMove', x: grip.x, y: grip.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
  for (const dy of [10, 20, 30]) win.webContents.sendInputEvent({ type: 'mouseMove', x: grip.x, y: grip.y - dy, modifiers: ['leftbuttondown'] });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: grip.x, y: grip.y - 30, button: 'left', clickCount: 1 });
  if (!(await waitInPage(win, `${PANEL_BOX}.height === ${start.height + 54}`, 2_000))) return `failed: dragging the handle did not resize the panel (${(await box())?.height}px)`;
  await shot(win, 'terminal-bottom-light.png');

  // Dock right: full height under the header, the footer row back under the message box, the handle on the left edge.
  const dock = await clickLikeAUser(win, '[data-terminal-dock]');
  if (!(await waitInPage(win, "document.querySelector('[data-terminal-panel]')?.dataset.terminalDockSide === 'right' && document.querySelector('[data-terminal-panel] [data-terminal] textarea')", 3_000))) {
    return `failed: Dock right did not move the panel (the click landed on ${dock.at})`;
  }
  const side = (await js(`(() => {
    const p = document.querySelector('[data-terminal-panel]').getBoundingClientRect(), h = document.querySelector('[data-current-session] header').getBoundingClientRect();
    const send = document.querySelector('[data-current-session] [data-composer-submit]').getBoundingClientRect();
    return { underHeader: Math.abs(p.top - h.bottom) < 2, fullHeight: Math.abs(p.bottom - innerHeight) < 2, sendLeft: send.right <= p.left, footer: !!document.querySelector('[data-current-session] [data-session-footer]'), ring: !!document.querySelector('[data-folded-meter]'), handle: document.querySelector('[data-terminal-resize]').getAttribute('aria-orientation') };
  })()`)) as { underHeader: boolean; fullHeight: boolean; sendLeft: boolean; footer: boolean; ring: boolean; handle: string };
  if (!side.underHeader || !side.fullHeight || !side.sendLeft) return `failed: docked right the panel is not full height beside the conversation (${JSON.stringify(side)})`;
  if (!side.footer || side.ring) return 'failed: docked right the footer row did not come back';
  if (side.handle !== 'vertical') return 'failed: docked right the handle is not on the left edge';
  // Docking animates and re-fits the terminal: measure once the width has stopped changing.
  let wide = (await box())!;
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const next = (await box())!;
    const settled = next.width === wide.width;
    wide = next;
    if (settled) break;
  }
  await js("document.querySelector('[data-terminal-resize]').focus()");
  key('Right');
  if (!(await waitInPage(win, `${PANEL_BOX}.width === ${wide.width - 24}`, 2_000))) return `failed: → on the handle did not narrow the panel (${wide.width}px)`;
  key('Left');
  if (!(await waitInPage(win, `${PANEL_BOX}.width === ${wide.width}`, 2_000))) return `failed: ← on the handle did not widen the panel again (${(await box())?.width}px)`;
  await shot(win, 'terminal-right-light.png');

  // Changes also wants the right side: the terminal docks below until it closes.
  let changes = 'no Changes button (not a git checkout)';
  if (await js("document.querySelector('[data-current-session] [data-toggle-changes]') !== null")) {
    await js("document.querySelector('[data-current-session] [data-toggle-changes]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-changes-panel]') && document.querySelector('[data-terminal-panel]')?.dataset.terminalDockSide === 'bottom' && document.querySelector('[data-terminal-dock]').disabled", 3_000))) {
      return 'failed: with Changes open the terminal did not fall back to docking below';
    }
    await shot(win, 'terminal-with-changes.png');
    await js("document.querySelector('[data-current-session] [data-toggle-changes]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-changes-panel]') && document.querySelector('[data-terminal-panel]')?.dataset.terminalDockSide === 'right'", 3_000))) {
      return 'failed: closing Changes did not put the terminal back on the right';
    }
    changes = 'docked below while Changes was open, back on the right after';
  }

  // Maximize: the button, then Esc from it; ⌘⇧J twice.
  const hidden = "document.querySelector('[data-current-session] [data-transcript]').offsetParent === null";
  const maximize = await clickLikeAUser(win, '[data-terminal-maximize]');
  if (!(await waitInPage(win, `${PANEL_BOX}.maximized && ${hidden} && !document.querySelector('[data-current-session] [data-composer-submit]')?.offsetParent`, 3_000))) {
    return `failed: Maximize did not give the terminal the whole view (the click landed on ${maximize.at})`;
  }
  // The panel grows into the view after the conversation hides; a slow machine can measure it in between.
  const viewWidth = "Math.round(document.querySelector('[data-current-session]').getBoundingClientRect().width)";
  if (!(await waitInPage(win, `Math.abs(${PANEL_BOX}.width - ${viewWidth}) <= 2`, 3_000))) {
    await shot(win, 'terminal-maximized-failed.png');
    return `failed: maximized, the terminal is ${(await box())?.width}px of ${await js(viewWidth)}px`;
  }
  await shot(win, 'terminal-maximized.png');
  await js("document.querySelector('[data-terminal-maximize]').focus()");
  key('Escape');
  if (!(await waitInPage(win, `!${PANEL_BOX}.maximized && !(${hidden})`, 2_000))) {
    const focused = await js("(() => { const el = document.activeElement; return el ? `${el.tagName.toLowerCase()}${el.closest('.xterm') ? ' in xterm' : ''}${el.closest('[data-terminal-panel]') ? ' in the panel' : ''}` : 'nothing'; })()");
    return `failed: Esc did not restore the maximized terminal (focus on ${focused})`;
  }
  key('J', ['meta', 'shift']);
  if (!(await waitInPage(win, `${PANEL_BOX}.maximized`, 2_000))) return 'failed: ⌘⇧J did not maximize the terminal';
  key('J', ['meta', 'shift']);
  if (!(await waitInPage(win, `!${PANEL_BOX}.maximized && !(${hidden})`, 2_000))) return 'failed: ⌘⇧J did not restore the terminal';

  // Dark theme, both docks.
  await setColorScheme(win, 'dark');
  if ((await js("getComputedStyle(document.querySelector('[data-terminal-panel]')).backgroundColor")) !== 'rgb(13, 16, 22)') return 'failed: in dark the panel lost its own background';
  await shot(win, 'terminal-right-dark.png');
  await js("document.querySelector('[data-terminal-dock]').click()");
  if (!(await waitInPage(win, `${PANEL_BOX}.dock === 'bottom'`, 3_000))) return 'failed: Dock below did not move the panel back';
  await shot(win, 'terminal-bottom-dark.png');

  // The narrowest window has no room for the terminal beside a usable conversation: docked right, it moves below
  // (the dock button says why) and goes back to the right when the window is wide again. Nothing scrolls sideways.
  const wideBounds = win.getBounds();
  await js("document.querySelector('[data-terminal-dock]').click()");
  if (!(await waitInPage(win, `${PANEL_BOX}.dock === 'right'`, 3_000))) return 'failed: Dock right did not move the panel again';
  win.setContentSize(900, Math.max(win.getContentSize()[1] ?? 0, 560));
  if (!(await waitInPage(win, `${PANEL_BOX}.dock === 'bottom' && document.querySelector('[data-terminal-dock]').disabled && document.querySelector('[data-terminal-dock]').dataset.tooltip.startsWith('Too narrow')`, 3_000))) {
    return 'failed: in the narrowest window the terminal stayed on the right';
  }
  await settle(win);
  const fits = "document.documentElement.scrollWidth <= innerWidth && document.querySelector('[data-terminal-hide]').getBoundingClientRect().right <= innerWidth && document.querySelector('[data-composer-submit]').getBoundingClientRect().right <= document.querySelector('[data-current-session] [data-transcript]').getBoundingClientRect().right";
  if (!(await js(fits))) return 'failed: the narrowest window scrolls sideways or cuts off the panel or Send';
  await shot(win, 'terminal-narrow.png');
  win.setBounds(wideBounds);
  if (!(await waitInPage(win, `${PANEL_BOX}.dock === 'right'`, 3_000))) return 'failed: widening the window did not put the terminal back on the right';
  const roomy = (await js("document.querySelector('[data-composer-submit]').getBoundingClientRect().right <= document.querySelector('[data-terminal-panel]').getBoundingClientRect().left")) as boolean;
  if (!roomy) return 'failed: docked right, Send is cut off by the panel';
  await js("document.querySelector('[data-terminal-dock]').click()");
  if (!(await waitInPage(win, `${PANEL_BOX}.dock === 'bottom'`, 3_000))) return 'failed: Dock below did not move the panel back';

  // Hide brings the footer row back.
  await js("document.querySelector('[data-terminal-hide]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-terminal-panel]') && document.querySelector('[data-current-session] [data-session-footer]')", 3_000))) return 'failed: hiding the panel did not bring the footer row back';
  return `ok: own background with a top shadow, 36x4 handle, 10/16px padding; footer folded into a ring ("${ring.replace(/\n/g, ' · ')}"); ↑ and drag resize; docked right full height with the footer back and → ← resizing; ${changes}; maximize by button, Esc and ⌘⇧J; light and dark; a 900px window docks it below and widening puts it back`;
}

/** Adds a project action through the editor, opened from the header's More menu; saving closes the editor. */
async function addAction(win: BrowserWindow, name: string, command: string): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-current-session] [data-actions-menu]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-edit-actions]')", 3_000))) return false;
  await js("document.querySelector('[role=menuitem][data-edit-actions]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-add-action]')", 3_000))) return false;
  await js("document.querySelector('[data-add-action]').click()");
  await setFieldValue(win, '[data-action-name]', name);
  await setFieldValue(win, '[data-action-command]', command);
  await js("document.querySelector('[data-save-action]').click()");
  return waitInPage(win, "!document.querySelector('[role=dialog]')", 3_000);
}

/**
 * The context menu on project actions: a right-click on a pill offers Run, Edit… and Delete…; Edit…
 * opens the editor on that action and a rename shows on the pill as the editor closes; Shift+F10 opens
 * the menu from the keyboard and Escape hands focus back; an action behind "N more" has the same menu,
 * and Delete… asks first. Light theme, then dark. The added commands only print or sleep.
 */
async function runActionMenuStep(win: BrowserWindow): Promise<string> {
  const scheme = preferences.get().colorScheme;
  try {
    return await actionMenuChecks(win);
  } finally {
    updatePreferences({ colorScheme: scheme });
  }
}

async function actionMenuChecks(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pill = (id: string) => `document.querySelector('[data-current-session] [data-action-pill="${id}"]')`;
  const items = "[...document.querySelectorAll('[role=menu] [data-action-menu-item]')].map((b) => b.dataset.actionMenuItem).join(',')";
  const status = "document.querySelector('[data-current-session] [data-action-status]')?.innerText ?? ''";
  await setColorScheme(win, 'light');
  if (!(await waitInPage(win, pill('smoke-action'), 3_000))) return 'failed: no pill for Smoke action';
  await settle(win);

  const right = await clickLikeAUser(win, '[data-current-session] [data-action-pill="smoke-action"]', 'right');
  if (!(await waitInPage(win, `${items} === 'run,edit,delete'`, 2_000))) return `failed: a right-click on the pill (landed on ${right.at}) showed "${await js(items)}"`;
  await shot(win, 'action-menu-light.png');
  await js("document.querySelector('[role=menu] [data-action-menu-item=\"edit\"]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-action-name]')?.value === 'Smoke action'", 3_000))) return 'failed: Edit… did not open the editor on that action';
  await setFieldValue(win, '[data-action-name]', 'Smoke renamed');
  await js("document.querySelector('[data-save-action]').click()");
  if (!(await waitInPage(win, `!document.querySelector('[role=dialog]') && ${pill('smoke-action')}?.innerText.includes('Smoke renamed')`, 3_000))) return 'failed: the pill did not show the new name after saving';
  if (!(await js(status)).includes('Action saved')) return 'failed: no "Action saved" after the rename';

  await setColorScheme(win, 'dark');
  await js(`${pill('smoke-action')}.focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10', modifiers: ['shift'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F10', modifiers: ['shift'] });
  if (!(await waitInPage(win, `${items} === 'run,edit,delete' && document.activeElement?.closest('[role=menu]')`, 2_000))) return 'failed: Shift+F10 on a focused pill did not open its menu';
  await shot(win, 'action-menu-dark.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  if (!(await waitInPage(win, `!document.querySelector('[role=menu]') && document.activeElement === ${pill('smoke-action')}`, 2_000))) return 'failed: Escape did not close the menu and return to the pill';

  // Two more actions put one behind "N more"; its menu item has the same context menu.
  for (const name of ['Smoke two', 'Smoke three']) if (!(await addAction(win, name, 'echo smoke'))) return `failed: could not add ${name}`;
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-more-actions]')", 3_000))) return 'failed: no "N more" pill with four actions';
  await js("document.querySelector('[data-current-session] [data-more-actions]').click()");
  if (!(await waitInPage(win, "document.querySelector('[role=menu] [role=menuitem][data-action]')", 2_000))) return 'failed: "N more" did not open';
  const hidden = (await js("document.querySelector('[role=menu] [role=menuitem][data-action]').dataset.action")) as string;
  const overflow = await clickLikeAUser(win, `[role=menu] [role=menuitem][data-action="${hidden}"]`, 'right');
  if (!(await waitInPage(win, `${items} === 'run,edit,delete'`, 2_000))) return `failed: a right-click in "N more" (landed on ${overflow.at}) showed "${await js(items)}"`;
  await js("document.querySelector('[role=menu] [data-action-menu-item=\"delete\"]').click()");
  if (!(await waitInPage(win, "document.querySelector('[role=alertdialog] [data-confirm]')", 2_000))) return 'failed: Delete… did not ask first';
  await js("document.querySelector('[role=alertdialog] [data-confirm]').click()");
  if (!(await waitInPage(win, `!document.querySelector('[role=alertdialog]') && !document.querySelector('[data-current-session] [data-more-actions]') && (${status}).includes('Action deleted')`, 3_000))) {
    return `failed: deleting ${hidden} did not remove it`;
  }
  return `ok: right-click and Shift+F10 open Run, Edit…, Delete…; Edit… renamed the pill at once with "Action saved"; Delete… from "N more" asked, then removed ${hidden}`;
}

/** Switches light or dark from main, as View → Appearance does, and waits until the page has repainted in it. */
async function setColorScheme(win: BrowserWindow, colorScheme: 'light' | 'dark'): Promise<boolean> {
  updatePreferences({ colorScheme });
  const applied = await waitInPage(win, `getComputedStyle(document.documentElement).colorScheme === '${colorScheme}'`, 2_000);
  await settle(win);
  return applied;
}

/** Saves a picture of the window once it has stopped moving (see `settle`), so no step needs a pause before one. */
async function shot(win: BrowserWindow, name: string): Promise<void> {
  await settle(win, 1_000);
  writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage()).toPNG());
}

/**
 * Opens the terminal panel on the open session (which starts a shell by itself) and runs a harmless command in it:
 * the shell writes its folder to a file in the throwaway app profile, which shows it ran, in the session's folder.
 */
async function runTerminalStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const marker = join(app.getPath('userData'), 'smoke-terminal.txt');
  rmSync(marker, { force: true });
  try {
    await js("document.querySelector('[data-toggle-terminal]')?.click()");
    if (!(await waitInPage(win, "document.querySelector('[data-terminal-panel]')", 3_000))) return 'failed: the panel did not open';
    if (!(await waitInPage(win, "document.querySelector('[data-terminal] textarea')", 5_000))) return 'failed: no terminal in the panel';
    await js("document.querySelector('[data-terminal] textarea').focus()");
    // Typed before the shell has started, the line waits in the terminal until it reads it. On Windows the
    // shell is PowerShell, whose pwd prints a table: write the bare folder there.
    const line =
      process.platform === 'win32'
        ? `echo "terminal works: $env:TERM_PROGRAM"; (Get-Location).Path | Set-Content -NoNewline '${marker.replace(/'/g, "''")}'`
        : `echo "terminal works: $TERM_PROGRAM" && pwd > ${JSON.stringify(marker)}`;
    await win.webContents.insertText(line);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    const read = () => (existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '');
    if (!(await until(() => read() !== '', 10_000))) return 'failed: the shell did not run the command';
    // The panel opens in the session's own folder, which is below the project's root when it was started in a subfolder.
    const folder = (await js("(() => { const view = document.querySelector('[data-current-session]'); return view?.dataset.cwd || view?.dataset.projectRoot || ''; })()")) as string;
    // .native also turns Windows' short names (RUNNER~1) into the long ones the shell prints.
    if (folder && realpathSync.native(read()) !== realpathSync.native(folder)) return `failed: the shell started in ${read()}, not ${folder}`;
    await shot(win, 'terminal.png');
    return `ok: ran a command in ${read()}`;
  } finally {
    rmSync(marker, { force: true });
    // Leave the next run's panel closed again.
    await js("document.querySelector('[data-terminal-panel]') && document.querySelector('[data-toggle-terminal]')?.click()");
  }
}
/**
 * The window's own terminal, from the Usage view: ⌘J opens a shell in the home folder, Esc in it stays with the
 * shell, Esc outside it leaves Usage for the session (where the panel steps aside), and back in Usage the same
 * tab is there; closing it hides the panel. Runs only `pwd`, into a file in the throwaway profile.
 */
async function runAppTerminalStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const panel = "document.querySelector('[data-terminal-panel][data-terminal-owner=\"app\"]')";
  const usage = "document.querySelector('[data-usage-view]')";
  const marker = join(app.getPath('userData'), 'smoke-app-terminal.txt');
  const sessionId = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  const openUsage = async () => {
    if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return false;
    await setFieldValue(win, '[data-palette-input]', 'Open usage');
    if (!(await waitInPage(win, "[...document.querySelectorAll('[data-command-palette] [role=option]')].some((el) => el.innerText.includes('Open usage'))", 3_000))) return false;
    pressKey(win, 'Return');
    return waitInPage(win, usage, 5_000);
  };
  rmSync(marker, { force: true });
  try {
    if (!(await openUsage())) return 'failed: could not open Usage from the palette';
    pressKey(win, 'J', ['meta']);
    if (!(await waitInPage(win, `${panel}?.querySelector('[data-terminal] textarea')`, 5_000))) return "failed: ⌘J in Usage did not open the window's terminal";
    await js(`${panel}.querySelector('[data-terminal] textarea').focus()`);
    const line = process.platform === 'win32' ? `(Get-Location).Path | Set-Content -NoNewline '${marker.replace(/'/g, "''")}'` : `pwd > ${JSON.stringify(marker)}`;
    await win.webContents.insertText(line);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    const read = () => (existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '');
    if (!(await until(() => read() !== '', 10_000))) return 'failed: the shell did not run the command';
    if (realpathSync.native(read()) !== realpathSync.native(homedir())) return `failed: the shell started in ${read()}, not the home folder`;
    const tab = (await js(`${panel}.querySelector('[role=tab][aria-selected=true]').innerText.trim()`)) as string;
    if (tab !== '~') return `failed: the tab is called "${tab}", not ~`;
    await shot(win, 'app-terminal.png');

    // Esc in the shell is the shell's: Usage stays. Outside it, Esc goes back to the session, where the panel steps aside.
    pressKey(win, 'Escape');
    await settle(win);
    if (!(await js(`!!${usage}`))) return 'failed: Esc in the terminal left the Usage view';
    await js('document.activeElement?.blur()');
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, `!${usage} && !${panel}`, 3_000))) return "failed: Esc did not leave Usage, or the window's terminal stayed";
    if (!(await openUsage())) return 'failed: could not open Usage again';
    if (!(await waitInPage(win, `${panel}?.querySelectorAll('[role=tab]').length === 1`, 3_000))) return "failed: the window's terminal did not come back with its tab";
    await clickLikeAUser(win, '[data-terminal-owner="app"] [role=tab][aria-selected=true] + [data-terminal-tab-close]');
    if (!(await waitInPage(win, `!${panel}`, 3_000))) return 'failed: closing the last tab did not hide the panel';
    return `ok: a shell in ${read()} from Usage, out of the way ${sessionId ? 'in the session' : 'on Home'}`;
  } finally {
    rmSync(marker, { force: true });
    if (await js(`!!${panel}`)) pressKey(win, 'J', ['meta']);
    // Back to the session the next steps work in.
    if (await js(`!!${usage}`)) {
      await js('document.activeElement?.blur()');
      pressKey(win, 'Escape');
      await waitInPage(win, `!${usage}`, 3_000);
    }
  }
}

/** ⌘Q asks first; Cancel keeps the app open; a second ⌘Q while asking quits (recorded, not performed, in smoke mode). */
async function runQuitStep(win: BrowserWindow): Promise<boolean> {
  const pressQuit = () => Menu.getApplicationMenu()?.getMenuItemById('quit')?.click();
  const prompt = "[...document.querySelectorAll('[role=alertdialog]')].find((el) => el.innerText.includes('Quit Switchboard'))";
  pressQuit();
  if (!(await waitInPage(win, prompt, 3_000))) return false;
  await shot(win, 'quit.png');
  await win.webContents.executeJavaScript(`[...${prompt}.querySelectorAll('button')].find((b) => b.innerText === 'Cancel').click()`);
  if (!(await waitInPage(win, `!${prompt}`, 3_000)) || quitRecorded || quitGuard.asking) return false;
  pressQuit();
  if (!(await waitInPage(win, prompt, 3_000))) return false;
  pressQuit();
  const quitOnSecondPress = quitRecorded && !quitGuard.asking;
  quitRecorded = false;
  // A real second press ends the app; here the prompt is still up, so dismiss it (a late answer is ignored).
  await win.webContents.executeJavaScript(`[...${prompt}.querySelectorAll('button')].find((b) => b.innerText === 'Cancel').click()`);
  return quitOnSecondPress && !quitRecorded && (await waitInPage(win, `!${prompt}`, 3_000));
}

/**
 * Drives the Settings view: theme (the page and the menu bar follow), sidebar style (row heights
 * change), and turning off the quit prompt. Everything must be saved, then is put back.
 */
async function runSettingsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const background = 'getComputedStyle(document.body).backgroundColor';
  const rowHeight = "document.querySelector('[data-session-id]').offsetHeight";
  const pause = () => settle(win);

  const section = async (id: string) => {
    await click(`[data-settings-section="${id}"]`);
    return waitInPage(win, `document.querySelector('[data-settings-page="${id}"]')`, 2_000);
  };
  // Session rows are checked with Settings closed, so nothing about the sheet can affect them.
  const withSettingsClosed = async (check: string) => {
    await click('[data-close-settings]');
    const ok = await waitInPage(win, `!document.querySelector('[data-settings]') && ${check}`, 2_000);
    await click('[data-open-settings]');
    await waitInPage(win, "document.querySelector('[data-settings]')", 2_000);
    return ok;
  };

  await click('[data-open-settings]');
  // Settings fills the main area with its sections inside; the sidebar keeps its session list.
  if (
    !(await waitInPage(
      win,
      "document.querySelector('[data-settings] [data-settings-nav] [data-settings-section]') && document.querySelector('[data-session-list]')",
      3_000,
    ))
  ) {
    return 'settings did not open with its sections, next to the session list';
  }
  if (!(await section('theme'))) return 'the Theme section did not open';
  await click('[data-color-scheme="light"]');
  if (!(await waitInPage(win, `${background} === 'rgb(255, 255, 255)'`, 2_000))) return 'Light did not apply';
  if (!(await section('sidebar'))) return 'the Sidebar section did not open';
  await click('[data-sidebar-style="large"]');
  if (!(await withSettingsClosed(`${rowHeight} === 48 && [...document.querySelectorAll('[data-session-id] > *')].some((el) => el.offsetWidth === 24)`))) return 'Large icons did not apply';
  await shot(win, 'settings-light.png');
  await section('theme');
  await click('[data-color-scheme="dark"]');
  if (!(await waitInPage(win, `${background} === 'rgb(21, 24, 31)'`, 2_000))) return 'Dark did not apply';
  await section('sidebar');
  await click('[data-sidebar-style="compact"]');
  if (!(await withSettingsClosed(`${rowHeight} === 32`))) return 'Compact did not apply';
  await shot(win, 'settings-dark.png');

  // The close button leaves Settings; opening it again returns to the same section.
  await section('conversation');
  await click('[data-tool-activity="steps"]');
  await until(() => preferences.get().toolActivity === 'steps');
  await click('[data-close-settings]');
  const everyStep = await waitInPage(win, "!document.querySelector('[data-settings]') && !document.querySelector('[data-activity]') && document.querySelector('[data-tool]')", 3_000);
  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"conversation\"]')", 3_000))) return 'settings did not reopen on the same section';
  if (!everyStep) return 'Every step did not show the tool cards, or Close did not leave Settings';

  // Turning off "sessions from other apps" leaves only Switchboard's own in the sidebar.
  await section('sidebar');
  await click('[data-session-scope]');
  const scoped = await withSettingsClosed("document.querySelector('[data-session-list]') && !document.querySelector('[data-session-id][data-in-app=\"false\"]')");
  await section('sidebar');

  await section('general');
  await click('[data-startup-view="new"]');
  await click('[data-project-order="yours"]');
  await click('[data-confirm-quit]');
  await until(() => !preferences.get().confirmQuit);
  Menu.getApplicationMenu()?.getMenuItemById('quit')?.click();
  const quitWithoutAsking = quitRecorded && !quitGuard.asking;
  quitRecorded = false;
  const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8')) as Record<string, unknown>;
  const menuChecked = Menu.getApplicationMenu()?.getMenuItemById('scheme-dark')?.checked === true;

  await click('[data-confirm-quit]');
  await click('[data-startup-view="home"]');
  await click('[data-project-order="recent"]');
  await section('sidebar');
  await click('[data-session-scope]');
  await click('[data-sidebar-style="standard"]');
  await section('theme');
  await click('[data-color-scheme="system"]');
  await section('conversation');
  await click('[data-tool-activity="summary"]');
  await until(() => preferences.get().toolActivity === 'summary');
  const restored = preferences.get();
  if (!scoped) return 'other apps\' sessions stayed in the sidebar with the setting off';
  if (!quitWithoutAsking) return '⌘Q still asked with the prompt turned off';
  if (saved.colorScheme !== 'dark' || saved.sidebarStyle !== 'compact' || saved.toolActivity !== 'steps' || saved.confirmQuit !== false || saved.sessionScope !== 'switchboard' || saved.startupView !== 'new' || saved.projectOrder !== 'yours') return `not saved: ${JSON.stringify(saved)}`;
  if (!menuChecked) return 'View → Appearance did not follow';
  if (restored.colorScheme !== 'system' || restored.sidebarStyle !== 'standard' || restored.toolActivity !== 'summary' || !restored.confirmQuit || restored.sessionScope !== 'all' || restored.startupView !== 'home' || restored.projectOrder !== 'recent') return 'could not restore the defaults';
  // Escape closes Settings too.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-settings]')", 2_000))) return 'Escape did not close Settings';
  return 'ok';
}

/**
 * Settings › Notifications, read-only: notifications on and sounds off to start with, with the sound rows dimmed and
 * disabled, and the attention events recorded so far (the project action that finished) say so. The blocked notice
 * shows when the system says notifications are off, checked again when the window is focused. The test button
 * sends a Needs you notification (recorded, never shown). With sounds on, changing the Finished sound saves only
 * that one; hovering a sound in the list, ▶ and the volume each "play" one (recorded, never heard). Sounds off
 * keeps the choices. Everything is put back.
 */
async function runNotificationsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const checked = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked')`;
  const rowsDisabled = "[...document.querySelectorAll('[data-sound-event] button')].every((b) => b.disabled) && document.querySelector('[data-sound-volume]').disabled";
  const rowsEnabled = "document.querySelectorAll('[data-sound-event]').length === 4 && [...document.querySelectorAll('[data-sound-picker]')].every((b) => !b.disabled) && !document.querySelector('[data-sound-volume]').disabled";
  const lastSound = () => recordedSounds.at(-1);
  const restore = async () => {
    forcedNotificationPermission = null;
    updatePreferences({ notifications: DEFAULT_PREFERENCES.notifications, sounds: DEFAULT_PREFERENCES.sounds });
    await click('[data-close-settings]').catch(() => {});
  };

  await click('[data-open-settings]');
  await click('[data-settings-section="notifications"]');
  if (!(await waitInPage(win, `document.querySelector('[data-settings-page="notifications"]') && ${checked('[data-notifications-toggle]')} === 'true' && ${checked('[data-sounds-toggle]')} === 'false' && document.querySelector('[data-sound-event]')`, 3_000))) {
    await restore();
    return 'Notifications did not open with notifications on and sounds off';
  }
  if (!(await waitInPage(win, rowsDisabled, 2_000))) return (await restore(), 'with sounds off, the sound rows could still be used');
  if (await js("!!document.querySelector('[data-notifications-blocked]')")) return (await restore(), 'the blocked notice showed while notifications are allowed');
  // What the events recorded so far did with those defaults: a notification (unless it was for the session on screen), no sound.
  const recorded = recordedNotifications.findLast((n) => n.kind === 'action-done') ?? recordedNotifications.at(-1);
  if (recorded && (recorded.notify !== !recorded.suppressed || recorded.sound !== null)) return (await restore(), `a recorded ${recorded.kind} event did ${JSON.stringify({ notify: recorded.notify, sound: recorded.sound })} with the defaults`);

  // Blocked in the system's settings: the notice, checked again when the window is focused.
  forcedNotificationPermission = 'blocked';
  await js("window.dispatchEvent(new Event('focus'))");
  if (!(await waitInPage(win, "document.querySelector('[data-notifications-blocked] [data-open-notification-settings]')", 2_000))) return (await restore(), 'the blocked notice did not show when the window was focused');
  forcedNotificationPermission = null;
  await js("window.dispatchEvent(new Event('focus'))");
  if (!(await waitInPage(win, "!document.querySelector('[data-notifications-blocked]')", 2_000))) return (await restore(), 'the blocked notice stayed once notifications were allowed');

  // The notifications switch, and the test notification it allows.
  await click('[data-notifications-toggle]');
  if (!(await until(() => !preferences.get().notifications.enabled)) || !(await waitInPage(win, "document.querySelector('[data-notifications-test]').disabled", 2_000))) return (await restore(), 'turning notifications off was not saved, or left the test button on');
  await click('[data-notifications-toggle]');
  if (!(await waitInPage(win, "!document.querySelector('[data-notifications-test]').disabled", 2_000))) return (await restore(), 'turning notifications on again did not allow the test button');
  const notified = recordedNotifications.length;
  await click('[data-notifications-test]');
  if (!(await until(() => recordedNotifications.slice(notified).some((n) => n.kind === 'needs-you' && n.title === 'Claude needs you' && n.notify && !n.suppressed)))) return (await restore(), 'Send a test notification did not send a Needs you notification');

  // Sounds on: the rows can be used.
  await click('[data-sounds-toggle]');
  if (!(await until(() => preferences.get().sounds.enabled))) return (await restore(), 'turning sounds on was not saved');
  const list = sounds.list();
  if (list.sounds.length === 0) {
    const said = await waitInPage(win, "document.querySelector('[data-sounds-card]')?.innerText.includes('no system sounds')", 2_000);
    await restore();
    return said ? 'ok: no system sounds on this computer, and Settings says so' : 'with no system sounds, Settings did not say so';
  }
  if (!(await waitInPage(win, rowsEnabled, 2_000))) return (await restore(), 'turning sounds on did not enable the sound rows');
  await shot(win, 'settings-notifications.png');

  // Changing the Finished sound saves that one only.
  const before = preferences.get().sounds.byEvent;
  const finished = list.sounds.find((id) => id !== resolveSound(before.finished, list, 'finished'))!;
  if (!(await chooseOption(win, '[data-sound-picker="finished"]', finished))) return (await restore(), 'could not choose a Finished sound');
  if (!(await until(() => preferences.get().sounds.byEvent.finished === finished))) return (await restore(), `choosing ${finished} for Finished was not saved`);
  const after = preferences.get().sounds.byEvent;
  if (after.needsYou !== before.needsYou || after.error !== before.error || after.actionEnded !== before.actionEnded) return (await restore(), `changing Finished changed another moment: ${JSON.stringify(after)}`);
  // ▶ plays the sound shown, at the volume set; a moment set to None has nothing to play.
  const played = recordedSounds.length;
  await click('[data-sound-preview="finished"]');
  if (!(await until(() => recordedSounds.length > played && lastSound()?.id === finished && lastSound()?.volume === preferences.get().sounds.volume))) return (await restore(), 'the Finished ▶ did not play its sound');
  if (preferences.get().sounds.byEvent.actionEnded === 'none' && !(await js("document.querySelector('[data-sound-preview=\"actionEnded\"]').disabled"))) return (await restore(), '▶ was on for a moment set to None');
  // Hovering a sound in the open list plays it.
  await click('[data-sound-picker="needsYou"]');
  const other = list.sounds.find((id) => id !== resolveSound(after.needsYou, list, 'needsYou'))!;
  const option = `[data-select-list] [data-option-value=${JSON.stringify(other)}]`;
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(option)})`, 2_000))) {
    const seen = await js("JSON.stringify({ list: !!document.querySelector('[data-select-list]'), values: [...document.querySelectorAll('[data-select-list] [data-option-value]')].slice(0, 4).map((o) => o.dataset.optionValue), focus: document.hasFocus() })");
    return (await restore(), `the Needs you sound list did not open with ${other}: ${seen}`);
  }
  const hovered = recordedSounds.length;
  await js(`document.querySelector(${JSON.stringify(option)}).scrollIntoView({ block: 'nearest' })`);
  const at = (await js(`(() => { const r = document.querySelector(${JSON.stringify(option)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
  win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
  const heard = await until(() => recordedSounds.slice(hovered).some((sound) => sound.id === other), 2_000);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-select-list]')", 2_000))) return (await restore(), 'Escape did not close the sound list');
  if (!heard) return (await restore(), `hovering ${other} in the list did not play it`);
  if (preferences.get().sounds.byEvent.needsYou !== after.needsYou) return (await restore(), 'hovering a sound saved it');
  // The volume moves with the arrow keys, is saved when let go, and plays at the new volume.
  await js("document.querySelector('[data-sound-volume]').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
  if (!(await until(() => preferences.get().sounds.volume === 0.45 && lastSound()?.volume === 0.45))) return (await restore(), `the volume did not go to 45% and play (${preferences.get().sounds.volume})`);

  // What events do now: each moment its own sound, and None nothing. Notifications off still plays them.
  const sample = recorded ?? { kind: 'finished' as const, sessionId: 'smoke', title: 'Claude finished', body: 'smoke' };
  const alerts = () => ({
    finished: notifier.alertFor({ ...sample, kind: 'finished' }),
    failed: notifier.alertFor({ ...sample, kind: 'failed' }),
    action: notifier.alertFor({ ...sample, kind: 'action-done' }),
    looking: notifier.alertFor({ ...sample, kind: 'finished' }, true),
  });
  const on = alerts();
  await click('[data-notifications-toggle]');
  await until(() => !preferences.get().notifications.enabled);
  const quiet = alerts();
  const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8')) as Preferences;

  // Sounds off dims the rows and keeps the sounds; on again brings them back.
  await click('[data-sounds-toggle]');
  const offKept = (await until(() => !preferences.get().sounds.enabled)) && (await waitInPage(win, rowsDisabled, 2_000)) && preferences.get().sounds.byEvent.finished === finished;
  await click('[data-sounds-toggle]');
  const backOn = await waitInPage(win, `${rowsEnabled} && document.querySelector('[data-sound-picker="finished"]').dataset.value === ${JSON.stringify(finished)}`, 2_000);

  await restore();
  const restored = await until(() => preferences.get().notifications.enabled && !preferences.get().sounds.enabled && preferences.get().sounds.byEvent.finished === DEFAULT_PREFERENCES.sounds.byEvent.finished);

  if (saved.notifications?.enabled !== false || saved.sounds?.enabled !== true || saved.sounds.byEvent.finished !== finished || saved.sounds.volume !== 0.45) return `not saved: ${JSON.stringify({ notifications: saved.notifications, sounds: saved.sounds })}`;
  if (!on.finished.notify || on.finished.sound !== 'finished' || on.failed.sound !== (saved.sounds.byEvent.error === 'none' ? null : 'error')) return `with both on, events would ${JSON.stringify(on)}`;
  if (on.action.sound !== (saved.sounds.byEvent.actionEnded === 'none' ? null : 'actionEnded')) return `a project action that ended would play ${on.action.sound} with its sound set to ${saved.sounds.byEvent.actionEnded}`;
  if (quiet.finished.notify || quiet.finished.sound !== 'finished') return `with notifications off, a finished turn would ${JSON.stringify(quiet.finished)}, not only its sound`;
  if (on.looking.notify || on.looking.sound !== null) return 'the session on screen would still get a sound';
  if (!offKept) return 'turning sounds off did not disable the rows, or lost the sounds';
  if (!backOn) return 'turning sounds on again did not bring back the Finished sound';
  if (!restored) return 'could not put the defaults back';
  return `ok: ${recorded ? `checked against a recorded ${recorded.kind} event` : 'no event recorded yet'}, ${list.sounds.length} sounds`;
}

/**
 * Settings' search: ⌘F puts the keyboard in the field, results show for every page with the words marked, ↓ and
 * Enter open one at its setting, Escape empties the field and then closes Settings. Then every setting the
 * search knows (found page by page, by the page's name) is opened from its result and has to land on its row.
 * Read-only: choosing a result only scrolls to a setting and focuses it.
 */
async function runSettingsSearchStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const key = (keyCode: string, modifiers: Array<'shift' | 'meta' | 'control'> = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const field = '[data-settings-search]';
  const search = (query: string) => setFieldValue(win, field, query);

  await js("document.querySelector('[data-settings]') || document.querySelector('[data-open-settings]').click()");
  if (!(await waitInPage(win, `document.querySelector('${field}')`, 3_000))) return 'no search field in Settings';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [MOD_MODIFIER] });
  if (!(await waitInPage(win, `document.activeElement === document.querySelector('${field}')`, 2_000))) return '⌘F did not put the keyboard in the search field';

  await search('dark mode');
  if (!(await waitInPage(win, "document.querySelector('[data-setting-result]')?.dataset.settingResult === 'appearance'", 2_000))) return '"dark mode" did not find Appearance first';
  if (await js("Boolean(document.querySelector('[data-settings-page]'))")) return 'the page stayed on screen next to the results';
  if (!(await js("document.querySelector('[data-settings-section=\"theme\"] [data-settings-section-count]')?.textContent.startsWith('1')"))) return 'Theme in the list did not say it has 1 result';
  await search('zzzqx');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-search-empty]')", 2_000))) return 'no "No settings match" for a query that matches nothing';
  await shot(win, 'settings-search-empty.png');

  // The keyboard: the first result is active; ↓ moves, Enter opens it at its setting.
  await search('quit');
  if (!(await waitInPage(win, "document.querySelector('[data-setting-result][aria-selected=true]')?.dataset.settingResult === 'confirm-quit'", 2_000))) return '"quit" did not make Ask before quitting the active result';
  await shot(win, 'settings-search.png');
  key('Return');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"general\"] [data-setting-flash=\"confirm-quit\"]') && document.activeElement?.matches('[data-confirm-quit]')", 3_000))) return 'Enter did not open General at Ask before quitting, with the keyboard on its switch';
  if (await js(`document.querySelector('${field}').value !== ''`)) return 'the field kept the query after choosing a result';

  // Escape empties the field first, and closes Settings from an empty one.
  await js(`document.querySelector('${field}').focus()`);
  await search('theme');
  await waitInPage(win, "document.querySelector('[data-setting-result]')", 2_000);
  key('Escape');
  if (!(await waitInPage(win, `document.querySelector('${field}').value === '' && document.querySelector('[data-settings-page]')`, 2_000))) return 'Escape did not empty the field and bring the page back';

  // Every setting: find it by its page's name, click its result, and check it lands on its row.
  const pages = (await js("[...document.querySelectorAll('[data-settings-section]')].map((b) => [b.dataset.settingsSection, b.innerText.trim()])")) as Array<[string, string]>;
  const missed: string[] = [];
  let landed = 0;
  for (const [page, label] of pages) {
    await search(label);
    await waitInPage(win, `document.querySelector('[data-settings-results-page="${page}"]')`, 2_000);
    const ids = (await js(`[...document.querySelectorAll('[data-settings-results-page="${page}"] [data-setting-result]')].map((r) => r.dataset.settingResult)`)) as string[];
    if (!ids.length) missed.push(`${page}: no results for "${label}"`);
    for (const id of ids) {
      await search(label);
      if (!(await waitInPage(win, `document.querySelector('[data-setting-result="${id}"]')`, 2_000))) {
        missed.push(`${id}: not found again`);
        continue;
      }
      await js(`document.querySelector('[data-setting-result="${id}"]').click()`);
      if (await waitInPage(win, `document.querySelector('[data-settings-page="${page}"] [data-setting-flash="${id}"]')`, 3_000)) landed += 1;
      else missed.push(`${id}: did not land on ${page}`);
    }
  }
  if (missed.length) return `failed: ${missed.join('; ')}`;

  await js(`document.querySelector('${field}').focus()`);
  key('Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-settings]')", 2_000))) return 'Escape in the empty field did not close Settings';
  return `ok: ${landed} settings on ${pages.length} pages each opened at their row; ⌘F, ↓ Enter and Escape work`;
}

/**
 * Settings › General › Permission mode: a fixed mode is what New session's mode chip starts on, and The last one
 * you picked brings back the remembered one. Runs before any step types in New session, since an unsent prompt there
 * keeps the choices it was written with. Starts no session; only the throwaway profile's preference changes, and it
 * is put back, with the session that was open.
 */
async function runNewSessionModeStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const chip = "document.querySelector('[data-new-session-view] [data-mode-select]')";
  const open = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  /** New session opened afresh (from Home, so it mounts again): the mode its chip starts on. */
  const freshMode = async () => {
    await js("document.querySelector('[data-go-home]')?.click()");
    await waitInPage(win, `!${chip}`, 2_000);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
    return (await waitInPage(win, `${chip}?.dataset.value`, 5_000)) ? ((await js(`${chip}.dataset.value`)) as string) : null;
  };
  const setMode = async (mode: string) => {
    await js("document.querySelector('[data-open-settings]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"general\"]')", 3_000))) return false;
    await js("document.querySelector('[data-settings-section=\"general\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-new-session-mode]')", 2_000))) return false;
    const picked = await chooseOption(win, '[data-new-session-mode]', mode);
    if (mode !== 'last') await shot(win, 'settings-new-session-mode.png');
    await js("document.querySelector('[data-close-settings]').click()");
    return picked && (await until(() => preferences.get().newSessionMode === mode));
  };

  if (preferences.get().newSessionMode !== 'last') return `the preference started as ${preferences.get().newSessionMode}, not The last one you picked`;
  const remembered = await freshMode();
  if (!remembered) return 'New session has no mode chip';
  const fixed = remembered === 'plan' ? 'acceptEdits' : 'plan';
  if (!(await setMode(fixed))) return `could not set Permission mode to ${fixed} in Settings › General`;
  const withFixed = await freshMode();
  if (withFixed !== fixed) return `with ${fixed} set, New session's mode chip starts on ${withFixed}`;
  if (!(await setMode('last'))) return 'could not set Permission mode back to The last one you picked';
  const again = await freshMode();
  if (again !== remembered) return `back on The last one you picked, the chip starts on ${again}, not ${remembered}`;
  if (open) {
    openSession(open);
    if (!(await waitInPage(win, `document.querySelector('[data-current-session="${open}"]') && document.querySelector('[data-transcript-item]')`, 5_000))) return 'could not go back to the session that was open';
  }
  return `ok: ${fixed} from Settings, then ${remembered} again as the one picked last`;
}

/**
 * The focus limit: turning it on in Settings › Focus shows the counter in the sidebar footer, in both
 * themes, with its list of the sessions that count; turning it off hides it again. Only preferences in
 * the throwaway profile change: no session is started and nothing is saved for later.
 */
/**
 * Settings › Sessions, read-only on real sessions: the archive days apply and are saved, turning deleting on asks first
 * (cancelled: it stays off), the overview filters to Archived, a month's checkbox picks its sessions, and the Trash
 * confirmation opens (cancelled). Nothing is ever deleted: the step refuses to run with deleting on.
 */
async function runSessionsSettingsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const cancelDialog = () => js("[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === 'Cancel')?.click()");
  const summaryText = "document.querySelector('[data-session-manager-summary]')?.innerText ?? ''";
  if (preferences.get().deleteArchived.enabled) return 'deleting archived sessions was on in a new profile; refusing to go on';

  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings]')", 3_000))) return 'settings did not open';
  await click('[data-settings-section="sessions"]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=sessions] [data-auto-archive]') && document.querySelector('[data-auto-delete]')", 3_000))) return 'the Sessions page did not show its settings';
  if ((await js("document.querySelector('[data-auto-delete]').getAttribute('aria-checked')")) !== 'false') return 'deleting looked on';
  if (!(await js("document.querySelector('[data-auto-delete-days-value]')?.disabled === true"))) return 'the delete days were not disabled while deleting is off';

  // The archive days: + and − apply at once and are saved.
  const days = preferences.get().archiveAfterDays;
  await click('[data-auto-archive-more]');
  if (!(await until(() => preferences.get().archiveAfterDays === days + 1))) return `+ did not raise the archive days from ${days}`;
  await click('[data-auto-archive-less]');
  if (!(await until(() => preferences.get().archiveAfterDays === days))) return '− did not put the archive days back';

  // Turning deleting on asks first; Cancel leaves it off.
  await click('[data-auto-delete]');
  if (!(await waitInPage(win, "document.querySelector('[data-delete-archived-dialog=turn-on]')", 2_000))) return 'turning deleting on did not ask first';
  const question = (await js("document.querySelector('[data-delete-archived-dialog]').innerText")) as string;
  await cancelDialog();
  if (!(await waitInPage(win, "!document.querySelector('[data-delete-archived-dialog]')", 2_000))) return 'Cancel did not close the question';
  await settle(win);
  if (preferences.get().deleteArchived.enabled || (await js("document.querySelector('[data-auto-delete]').getAttribute('aria-checked')")) !== 'false') return 'Cancel turned deleting on';
  if (!/Turn on deleting after \d+ days\?/.test(question)) return `the question did not say what it turns on: ${question.slice(0, 120)}`;

  // The overview: Archived only, then a month picked, then the Trash confirmation cancelled.
  if (!(await waitInPage(win, `/\\d+ sessions?/.test(${summaryText})`, 3_000))) return 'the overview did not say how many sessions there are';
  const summary = (await js(summaryText)) as string;
  await click('[data-session-status-filter="archived"]');
  if (!(await waitInPage(win, "document.querySelector('[data-session-status-filter=archived]')?.getAttribute('aria-checked') === 'true' && [...document.querySelectorAll('[data-session-manager-row]')].every((r) => r.dataset.status === 'archived')", 2_000))) {
    return 'the Archived filter showed other sessions';
  }
  const month = (await js("document.querySelector('[data-session-manager-month-pick]:not(:disabled)')?.getAttribute('data-session-manager-month-pick') ?? null")) as string | null;
  let picked = 'no archived sessions to pick';
  if (month) {
    const box = `document.querySelector('[data-session-manager-month-pick="${month}"]')`;
    await js(`${box}.click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-session-selection-bar]') && ${box}?.getAttribute('aria-checked') === 'true'`, 2_000))) return 'the month checkbox did not pick its sessions';
    const count = Number(await js("document.querySelector('[data-session-selection-count]').getAttribute('data-session-selection-count')"));
    await click('[data-session-move-to-trash]');
    if (!(await waitInPage(win, "document.querySelector('[data-move-to-trash-dialog]')", 2_000))) return 'Move to Trash did not ask first';
    const title = (await js("document.querySelector('[data-move-to-trash-dialog]').innerText.split('\\n')[0]")) as string;
    await cancelDialog();
    if (!(await waitInPage(win, "!document.querySelector('[data-move-to-trash-dialog]')", 2_000))) return 'Cancel did not close the Trash confirmation';
    await settle(win);
    if ((await js(summaryText)) !== summary) return 'the sessions changed after Cancel';
    await click('[data-session-clear-selection]');
    if (!(await waitInPage(win, "!document.querySelector('[data-session-selection-bar]')", 2_000))) return 'Clear did not take the picks away';
    picked = `picked ${count} in ${month}, "${title.trim().slice(0, 60)}" cancelled`;
  }
  await click('[data-session-status-filter="all"]');
  await click('[data-close-settings]');
  await waitInPage(win, "!document.querySelector('[data-settings]')", 2_000);
  if (preferences.get().deleteArchived.enabled) return 'deleting was on at the end';
  return `ok: ${summary}; ${picked}`;
}

async function runFocusStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const counter = "document.querySelector('[data-sidebar] [data-focus-counter]')";
  const counterText = `${counter}?.innerText.trim()`;
  const counterColour = `getComputedStyle(${counter}).color`;
  const pause = () => settle(win);
  const section = async (id: string) => {
    await click(`[data-settings-section="${id}"]`);
    return waitInPage(win, `document.querySelector('[data-settings-page="${id}"]')`, 2_000);
  };

  if (preferences.get().focusLimit !== null) return 'the focus limit was already on in a new profile';
  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings]')", 3_000))) return 'settings did not open';
  if (!(await section('focus'))) return 'the Focus section did not open';
  if (!(await waitInPage(win, "document.querySelector('[data-focus-settings]') && document.querySelector('[data-focus-why]')?.href.startsWith('https://')", 2_000))) return 'Focus did not show its intro and link';
  if (await js(`!!document.querySelector('[data-focus-options]') || !!${counter}`)) return 'the limit looked on before it was turned on';

  await click('[data-focus-limit-switch]');
  if (!(await waitInPage(win, `document.querySelector('[data-focus-options]') && /^\\d+ \\/ 3$/.test(${counterText} ?? '')`, 2_000))) {
    return `turning it on did not show the options and a counter out of 3 (${await js(`${counterText} ?? 'no counter'`)})`;
  }
  await click('[data-focus-limit-more]');
  const raised = await waitInPage(win, `/ \\/ 4$/.test(${counterText} ?? '') && document.querySelector('[data-focus-limit-value]').innerText === '4'`, 2_000);
  await click('[data-focus-limit-less]');
  if (!raised || !(await waitInPage(win, `/ \\/ 3$/.test(${counterText} ?? '')`, 2_000))) return 'the stepper did not change the limit';
  await click('[data-focus-mode="strict"]');
  await until(() => preferences.get().focusMode === 'strict');
  const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8')) as Record<string, unknown>;
  if (saved.focusLimit !== 3 || saved.focusMode !== 'strict') return `not saved: ${JSON.stringify({ focusLimit: saved.focusLimit, focusMode: saved.focusMode })}`;

  // The counter in both themes: shown, readable, in each theme's own colour.
  await section('theme');
  await click('[data-color-scheme="light"]');
  if (!(await waitInPage(win, "getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)'", 2_000))) return 'Light did not apply';
  await pause();
  const light = (await js(`(() => { const el = ${counter}; return el && el.offsetWidth > 0 ? ${counterColour} : null; })()`)) as string | null;
  await shot(win, 'focus-light.png');
  await click('[data-color-scheme="dark"]');
  if (!(await waitInPage(win, "getComputedStyle(document.body).backgroundColor === 'rgb(21, 24, 31)'", 2_000))) return 'Dark did not apply';
  await pause();
  const dark = (await js(`(() => { const el = ${counter}; return el && el.offsetWidth > 0 ? ${counterColour} : null; })()`)) as string | null;
  if (!light || !dark) return `the counter was not visible in ${light ? 'dark' : 'light'} mode`;
  if (light === dark) return `the counter kept one colour in both themes (${light})`;

  // A click lists what counts, with the footer line; a second click closes it.
  await click('[data-focus-counter]');
  const listed = await waitInPage(win, "document.querySelector('[data-focus-popover]')?.innerText.includes('free a place')", 2_000);
  await shot(win, 'focus-dark.png');
  await click('[data-focus-counter]');
  const closed = await waitInPage(win, "!document.querySelector('[data-focus-popover]')", 2_000);

  // Back to how it was: the system theme, Nudge, and the limit off.
  await click('[data-color-scheme="system"]');
  await section('focus');
  await click('[data-focus-mode="nudge"]');
  await click('[data-focus-limit-switch]');
  const hidden = await waitInPage(win, `!document.querySelector('[data-focus-options]') && !${counter}`, 2_000);
  await click('[data-close-settings]');
  await waitInPage(win, "!document.querySelector('[data-settings]')", 2_000);
  const restored = preferences.get();
  if (!listed) return 'the counter did not open its list of sessions';
  if (!closed) return 'a second click did not close the list';
  if (!hidden) return 'turning it off did not hide the counter';
  if (restored.focusLimit !== null || restored.focusMode !== 'nudge' || restored.colorScheme !== 'system') return `could not restore the defaults: ${JSON.stringify({ focusLimit: restored.focusLimit, focusMode: restored.focusMode, colorScheme: restored.colorScheme })}`;
  return `ok (light ${light}, dark ${dark})`;
}

/**
 * Projects are added by hand: the throwaway profile starts with none, the Add project dialog offers the
 * folders Claude Code has sessions for, and a project's defaults reach the New session view. Only the
 * throwaway profile's own project list changes (nothing on disk); the project is removed again at the end.
 */
async function runProjectsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-sidebar-onboarding]')", 3_000))) return 'a new profile did not offer to add a project';
  await click('[data-open-projects]');
  if (!(await waitInPage(win, "document.querySelector('[data-project-manager] [data-no-projects]')", 3_000))) return 'the Projects view did not open empty';
  await click('[data-manager-add]');
  if (!(await waitInPage(win, "document.querySelector('[data-add-project-dialog] [data-known-project]')", 5_000))) return 'no folders with sessions offered';
  const known = (await js("document.querySelectorAll('[data-known-project]').length")) as number;
  // Switchboard's own repository when Claude Code has sessions there (a git repository, so the Worktrees tab has
  // something to show), else the first folder offered.
  const ownRepo = sourceRepository();
  const preferred = ownRepo ? ((await js(`document.querySelector(${JSON.stringify(`[data-known-project=${JSON.stringify(ownRepo)}][data-added="false"]`)})?.dataset.knownProject ?? null`)) as string | null) : null;
  const root = preferred ?? ((await js("document.querySelector('[data-known-project][data-added=\"false\"]')?.dataset.knownProject ?? null")) as string | null);
  if (!root) return 'every offered folder was already a project';
  const rowSelector = `[data-project-row=${JSON.stringify(root)}]`;
  const row = (selector = '') => `document.querySelector(${JSON.stringify(selector ? `${rowSelector} ${selector}` : rowSelector)})`;
  const pageSelector = `[data-project-page=${JSON.stringify(root)}]`;
  const page = (selector = '') => `document.querySelector(${JSON.stringify(selector ? `${pageSelector} ${selector}` : pageSelector)})`;
  await shot(win, 'add-project.png');
  await click(`[data-known-project=${JSON.stringify(root)}]`);
  if (!(await waitInPage(win, "document.querySelector('[data-known-project][data-added=\"true\"]')", 3_000))) return 'the folder was not marked as added';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });

  // Closing the dialog opens the page of the project just added, on Settings, so its profile and defaults can be set.
  if (!(await waitInPage(win, `!document.querySelector('[data-add-project-dialog]') && ${page('[data-default-effort]')} && !document.querySelector('[data-sidebar-onboarding]')`, 3_000))) return "the new project's page did not open on Settings";
  // Themed dropdown: open with a click, ↓ moves, Escape closes and focus returns.
  const modelSelect = `${pageSelector} [data-default-model]`;
  await js(`document.querySelector(${JSON.stringify(modelSelect)}).click()`);
  if (!(await waitInPage(win, `document.querySelectorAll('[data-select-list] [role=option]').length > 1 && document.querySelector(${JSON.stringify(modelSelect)}).getAttribute('aria-expanded') === 'true'`, 3_000))) return 'the model dropdown did not open';
  const before = (await js("document.querySelector('[data-select-list]').getAttribute('aria-activedescendant')")) as string;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  await settle(win);
  const after = (await js("document.querySelector('[data-select-list]').getAttribute('aria-activedescendant')")) as string;
  await shot(win, 'select.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, `!document.querySelector('[data-select-list]') && document.activeElement?.matches(${JSON.stringify(modelSelect)})`, 2_000))) return 'Escape did not close the dropdown';
  if (before === after) return '↓ did not move in the dropdown';
  if (!(await waitInPage(win, `${page('[data-default-model]')}.dataset.value === ''`, 1_000))) return 'Escape changed the model default';
  if (!(await chooseOption(win, `${pageSelector} [data-default-effort]`, 'high'))) return 'could not pick an effort default';

  // The page's other tabs, read-only: Overview, Sessions, and the worktrees of a real repository.
  const pageResult = await smokeRun.step('project page and worktrees', () => runProjectPageStep(win, root), { cleanup: false });
  await smokeRun.step('project branches', () => runProjectBranchesStep(win, root), { cleanup: false });
  await smokeRun.step('project memory and share dialog', () => runProjectMemoryStep(win, root), { cleanup: false });
  await smokeRun.step('settings › memory', () => runMemorySettingsStep(win, root), { cleanup: false });

  // The Projects list shows the saved default (and a worktree pill when the project has worktrees).
  await click('[data-project-breadcrumb]');
  if (!(await waitInPage(win, `${row('[data-defaults-summary]')}?.innerText.includes('high effort')`, 3_000))) return 'the effort default was not saved';
  await shot(win, 'projects.png');

  // Renaming only changes the name Switchboard shows; it reaches the sidebar filter too.
  const renameDialog = "document.querySelector('[data-rename-project-dialog]')";
  const folder = basename(root);
  await js(`${row('[data-project-open]')}.click()`);
  if (!(await waitInPage(win, page('[data-project-tab="settings"]'), 3_000))) return 'a click on the project did not open its page';
  await js(`${page('[data-project-tab="settings"]')}.click()`);
  if (!(await waitInPage(win, page('[data-project-rename]'), 3_000))) return 'no Rename… on the Settings tab';
  await js(`${page('[data-project-rename]')}.click()`);
  if (!(await waitInPage(win, `${renameDialog} && document.activeElement?.matches('[data-rename-project-input]') && document.activeElement.value === ${JSON.stringify(folder)}`, 3_000))) return "Rename… did not open with the folder's name";
  await setFieldValue(win, '[data-rename-project-input]', 'Smoke project');
  await js("document.querySelector('[data-rename-project-save]').click()");
  if (!(await waitInPage(win, `!${renameDialog} && ${page('[data-project-name]')}.innerText.includes('Smoke project')`, 3_000))) return 'the new name did not reach the project page';

  // A project's ⋯ menu in the sidebar filter: one real click outside closes the filter and the menu.
  const more = `[data-project-filter-menu] [data-project-more=${JSON.stringify(root)}]`;
  await click('[data-project-filter]');
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(more)})`, 2_000))) return 'the project is not in the sidebar filter';
  if ((await js(`document.querySelector(${JSON.stringify(more)}).getAttribute('aria-label')`)) !== 'Options for Smoke project') return 'the sidebar filter does not show the new name';
  await click(more);
  if (!(await waitInPage(win, "document.querySelectorAll('[role=menu]').length === 2", 2_000))) return 'the project options menu did not open from the filter';
  const outside = (await js("(() => { const r = document.querySelector('[data-project-page]').getBoundingClientRect(); return { x: Math.round(r.right - 24), y: Math.round(r.bottom - 24) }; })()")) as { x: number; y: number };
  win.webContents.sendInputEvent({ type: 'mouseDown', x: outside.x, y: outside.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: outside.x, y: outside.y, button: 'left', clickCount: 1 });
  if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'a click outside left the project options menu open';
  await js(`${page('[data-project-rename]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-rename-project-reset]')", 3_000))) return 'no Use folder name for a renamed project';
  await click('[data-rename-project-reset]');
  if (!(await waitInPage(win, `!${renameDialog} && ${page('[data-project-name]')}.innerText.startsWith(${JSON.stringify(folder)})`, 3_000))) return 'Use folder name did not bring back the folder name';

  // A new session in the project starts from its defaults; a change there can be saved back.
  await click('[data-new-session]');
  const pickedEffort = "document.querySelector('[data-new-session-view] [data-effort-select]')?.dataset.value";
  if (!(await waitInPage(win, `document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(root)} && ${pickedEffort} === 'high'`, 5_000))) {
    return `New session did not start from the project's defaults (${String(await js(`document.querySelector('[data-folder-select]')?.dataset.value + ' ' + ${pickedEffort}`))})`;
  }
  if (!(await chooseChoice(win, 'effort', 'low', '[data-new-session-view]'))) return 'could not change the effort in New session';
  await waitInPage(win, "document.querySelector('[data-route-branch]')?.innerText !== '…'", 3_000);
  await shot(win, 'new-session-tray.png');
  const catchUp = await checkCatchUpMenu(win);
  if (catchUp.startsWith('failed')) return catchUp;
  // The branch menu only reads branches; Escape closes it without switching.
  await click('[data-branch-select]');
  if (await waitInPage(win, "document.querySelector('[data-menu=\"branch\"] [data-choice-search]')", 2_000)) {
    await shot(win, 'new-session-branch-menu.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await waitInPage(win, "!document.querySelector('[data-menu=\"branch\"]')", 2_000);
  }
  // Saving lives at the end of the "where" menu under the composer.
  await click('[data-workspace-select]');
  if (!(await waitInPage(win, "document.querySelector('[data-save-project-defaults]:not(:disabled)')", 3_000))) return 'no Save as project default after a change';
  await shot(win, 'new-session-where-menu.png');
  await click('[data-save-project-defaults]');
  if (!(await waitInPage(win, "document.querySelector('[data-saved-note]') && !document.querySelector('[data-menu=\"workspace\"]')", 3_000))) return 'Save as project default did not save';

  // The command palette's New session needs a project: this is the one moment the throwaway profile has one.
  await smokeRun.step('command palette, new session', () => runPaletteNewSessionStep(win), { cleanup: false });
  await smokeRun.step('unsent New session prompt', () => runUnsentNewSessionStep(win), { cleanup: false });
  // Here New session has a folder (the project just added), so starting while Auto chooses can be checked too.
  await smokeRun.step('auto model: menu, chip, Stop while choosing, Auto off, settings', () => runAutoModelStep(win), { cleanup: false });
  await smokeRun.step('worktree name', () => runWorktreeNameStep(win), { cleanup: false });

  await click('[data-open-projects]');
  if (!(await waitInPage(win, `${row('[data-defaults-summary]')}?.innerText.includes('low effort')`, 3_000))) return 'the saved default did not reach the Projects view';
  // Removing is in the row's ⋯ menu (it only takes the project off Switchboard's list).
  await js(`${row('[data-project-more-button]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-remove-project]')", 2_000))) return "no Remove in the project's ⋯ menu";
  await click('[role=menu] [data-remove-project]');
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 3_000))) return 'no confirmation before removing';
  await click('[data-confirm]');
  if (!(await waitInPage(win, "document.querySelector('[data-no-projects]')", 3_000))) return 'the project was not removed';
  await click('[data-open-projects]');
  return `ok: ${known} folders offered; added one and its page opened (${pageResult.startsWith('ok') ? 'tabs checked' : 'page step failed'}), dropdown keyboard and Escape, renamed it and back, an outside click closed its filter menus, its defaults reached New session (git button: ${catchUp}), saved a change back, removed it`;
}

/** The main checkout of the repository this app was built from, when it runs from source (the smoke test does). */
function sourceRepository(): string | null {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: app.getAppPath(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return common.endsWith('/.git') ? realpathSync(common.slice(0, -5)) : null;
  } catch {
    return null;
  }
}

/**
 * A project's page, read-only on a real project: the Overview's cards, the Sessions tab, and the Worktrees tab, where
 * the main checkout is locked and the groups render. The row menu and the clean-up confirmation open and close with
 * Escape; nothing is ever removed, pushed or merged.
 */
async function runProjectPageStep(win: BrowserWindow, root: string): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pageSelector = `[data-project-page=${JSON.stringify(root)}]`;
  const q = (selector: string) => `document.querySelector(${JSON.stringify(`${pageSelector} ${selector}`)})`;
  const tab = async (id: string) => js(`${q(`[data-project-tab="${id}"]`)}.click()`);
  if (!(await waitInPage(win, `${q('[data-project-name]')} && ${q('[data-project-tab="worktrees"]')}`, 3_000))) return 'the project page has no header or tabs';

  // The header's icon opens the icon choices (only opened and closed: picking an image needs the system dialog).
  await js(`${q('[data-project-icon-button]')}.click()`);
  if (!(await waitInPage(win, "[...document.querySelectorAll('[role=menu] [role=menuitem]')].some((e) => e.innerText.includes('Choose image'))", 2_000))) return "the project's icon did not open its icon menu";
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'Escape did not close the icon menu';

  await tab('overview');
  if (!(await waitInPage(win, `document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-overview-card]`)}).length >= 3`, 3_000))) return 'the Overview cards did not show';
  const cards = (await js(`document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-overview-card]`)}).length`)) as number;
  await tab('sessions');
  if (!(await waitInPage(win, q('[data-project-sessions]'), 3_000))) return 'the Sessions tab did not show';
  if (await js(`(() => { const t = ${q('[role=tablist]')}; return t.scrollHeight > t.clientHeight; })()`)) return 'the tab row scrolls vertically';
  // Archived sessions have their own section at the end, opening and closing from its header.
  let archived = 'no archived sessions';
  if (await js(`!!${q('[data-project-archived]')}`)) {
    const toggle = q('[data-project-archived] [data-archived-toggle]');
    const open = (await js(`${toggle}.dataset.open === 'true'`)) as boolean;
    await js(`${toggle}.click()`);
    if (!(await waitInPage(win, `${toggle}.dataset.open === ${JSON.stringify(String(!open))} && !!${q('[data-project-archived] [data-session-id]')} === ${!open}`, 2_000))) return 'the Archived section did not open or close';
    const count = (await js(`document.querySelector(${JSON.stringify(`${pageSelector} [data-project-archived] [data-archived-toggle]`)}).querySelector('.sr-only')?.innerText ?? ''`)) as string;
    await js(`${toggle}.click()`);
    if (!(await waitInPage(win, `${toggle}.dataset.open === ${JSON.stringify(String(open))}`, 2_000))) return 'the Archived section did not toggle back';
    archived = `${count.replace(/\D/g, '')} archived, opened and closed`;
  }
  await tab('worktrees');
  if (!(await waitInPage(win, `${q('[data-project-tab="worktrees"]')}.getAttribute('aria-selected') === 'true' && (${q('[data-worktrees-tab]')} || ${q('[data-worktrees-not-repo]')})`, 20_000))) return 'the Worktrees tab did not load';
  if (await js(`!!${q('[data-worktrees-not-repo]')}`)) return `ok: ${cards} overview cards, sessions (${archived}); not a git repository, so no worktrees`;

  const main = '[data-worktree-row][data-group="main"]';
  if (!(await js(`!!${q(main)}`))) return 'the main checkout is not listed';
  if (!(await js(`${q(main)}.hasAttribute('data-locked') && !${q(`${main} [data-worktree-pick]`)}`))) return 'the main checkout can be picked';
  const rows = (await js(`document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-worktree-row]`)}).length`)) as number;
  const groups = (await js(`[...document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-worktree-group]`)})].map((e) => e.dataset.worktreeGroup)`)) as string[];
  if (rows === 1 && !(await js(`!!${q('[data-worktrees-empty]')}`))) return 'no empty state with only the main checkout';
  await shot(win, 'project-worktrees.png');

  // A row's ⋯ menu opens and closes.
  let menu = 'no other worktrees';
  if (await js(`!!${q('[data-worktree-more]')}`)) {
    await js(`${q('[data-worktree-more]')}.click()`);
    if (!(await waitInPage(win, "document.querySelector('[role=menu]')", 2_000))) return 'the row menu did not open';
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'Escape did not close the row menu';
    menu = 'row menu opened and closed';
  }
  // The clean-up confirmation opens on Cancel and closes with Escape. Its Remove button is never pressed.
  let cleanup = 'nothing picked';
  if (await js(`!!document.querySelector(${JSON.stringify(`${pageSelector} [data-worktree-remove]:not(:disabled)`)})`)) {
    await js(`${q('[data-worktree-remove]')}.click()`);
    if (!(await waitInPage(win, "document.querySelector('[data-worktree-cleanup]')", 3_000))) return 'the clean-up confirmation did not open';
    if (!(await waitInPage(win, "document.activeElement && !document.activeElement.matches('[data-worktree-cleanup-confirm]') && document.querySelector('[data-worktree-cleanup]').contains(document.activeElement)", 2_000))) return 'the clean-up confirmation did not start on Cancel';
    await shot(win, 'worktree-cleanup.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await waitInPage(win, "!document.querySelector('[data-worktree-cleanup]')", 2_000))) return 'Escape did not close the clean-up confirmation';
    cleanup = 'clean-up confirmation opened and cancelled';
  }
  return `ok: ${cards} overview cards, sessions (${archived}), ${rows} worktree rows (groups: ${groups.join(', ') || 'none'}), main checkout locked, ${menu}, ${cleanup}`;
}

/**
 * A project's Branches tab, read-only on a real project: the base branch is locked, the groups render, the filter
 * narrows the rows, a row's menu (with Switch to this branch on a branch outside In use) and the delete confirmation
 * open and close with Escape. Nothing is ever deleted or switched to, and Refresh (which fetches) is never pressed.
 */
async function runProjectBranchesStep(win: BrowserWindow, root: string): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pageSelector = `[data-project-page=${JSON.stringify(root)}]`;
  const q = (selector: string) => `document.querySelector(${JSON.stringify(`${pageSelector} ${selector}`)})`;
  const count = (selector: string) => js(`document.querySelectorAll(${JSON.stringify(`${pageSelector} ${selector}`)}).length`) as Promise<number>;
  if (!(await waitInPage(win, q('[data-project-tab="branches"]'), 3_000))) return 'the project page has no Branches tab';
  await js(`${q('[data-project-tab="branches"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-project-tab="branches"]')}.getAttribute('aria-selected') === 'true' && (${q('[data-branches-tab]')} || ${q('[data-branches-not-repo]')})`, 20_000))) return 'the Branches tab did not load';
  if (await js(`!!${q('[data-branches-not-repo]')}`)) return 'ok: not a git repository, so no branches';

  // The base branch is in use and can't be picked. (Another branch in use, checked out in a worktree, may still be
  // picked when its remote copy can go, so the check looks at the base itself.)
  const inUse = '[data-branch-row][data-group="in-use"]';
  if (!(await js(`!!${q(inUse)}`))) return 'no branch is listed as in use';
  const baseRow = `${inUse}[data-base]`;
  if (await js(`!!${q(baseRow)}`)) {
    if (!(await js(`${q(baseRow)}.hasAttribute('data-locked') && !${q(`${baseRow} [data-branch-pick]`)}`))) return 'the base branch can be picked';
  }
  const rows = await count('[data-branch-row]');
  const groups = (await js(`[...document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-branch-group]`)})].map((e) => e.dataset.branchGroup)`)) as string[];
  await shot(win, 'project-branches.png');

  // The filter narrows the rows to what matches, and clearing it brings them back.
  const first = (await js(`${q('[data-branch-row]')}.dataset.branchRow`)) as string;
  const filter = q('[data-branch-filter]');
  const type = (text: string) => js(`(() => { const f = ${filter}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, ${JSON.stringify(text)}); f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await type(first);
  if (!(await waitInPage(win, `[...document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-branch-row]`)})].every((r) => r.innerText.toLowerCase().includes(${JSON.stringify(first.toLowerCase())})) && !!document.querySelector(${JSON.stringify(`${pageSelector} [data-branch-row="${first}"]`)})`, 2_000))) return 'the filter did not narrow the rows';
  await type('');
  if (!(await waitInPage(win, `document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-branch-row]`)}).length === ${rows}`, 2_000))) return 'clearing the filter did not bring the rows back';

  // A row's ⋯ menu opens and closes.
  await js(`${q('[data-branch-more]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[role=menu]')", 2_000))) return 'the row menu did not open';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'Escape did not close the row menu';

  // A branch that isn't checked out anywhere offers to switch the main checkout to it. The item is never chosen.
  let switchItem = 'no branch outside In use';
  const outside = '[data-branch-row]:not([data-group="in-use"]) [data-branch-more]';
  if (await js(`!!${q(outside)}`)) {
    await js(`${q(outside)}.click()`);
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-branch-switch]')", 2_000))) return 'the row menu of a branch that is not checked out has no Switch to this branch';
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'Escape did not close the row menu';
    switchItem = 'switch item shown';
  }

  // The delete confirmation opens on Cancel and closes with Escape. Its Delete button is never pressed.
  let confirm = 'nothing picked';
  if (await js(`!!document.querySelector(${JSON.stringify(`${pageSelector} [data-branch-delete-selected]:not(:disabled)`)})`)) {
    await js(`${q('[data-branch-delete-selected]')}.click()`);
    if (!(await waitInPage(win, "document.querySelector('[data-branch-delete]')", 3_000))) return 'the delete confirmation did not open';
    if (!(await waitInPage(win, "document.activeElement && !document.activeElement.matches('[data-branch-delete-confirm]') && document.querySelector('[data-branch-delete]').contains(document.activeElement)", 2_000))) return 'the delete confirmation did not start on Cancel';
    if (await js(`document.querySelector('[data-branch-delete-remote]')?.getAttribute('aria-checked') === 'true'`)) return 'deleting on the remote was on by default';
    await shot(win, 'branch-delete.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await waitInPage(win, "!document.querySelector('[data-branch-delete]')", 2_000))) return 'Escape did not close the delete confirmation';
    confirm = 'delete confirmation opened and cancelled';
  }
  return `ok: ${rows} branch rows (groups: ${groups.join(', ') || 'none'}), in-use branch locked, filter narrowed and cleared, row menu opened and closed (${switchItem}), ${confirm}`;
}

/**
 * The Memory tab, read-only: the project's memory and instructions are listed and a file shows in the viewer. With a
 * memory, its share dialog opens, the preview follows the three targets, and Cancel closes it. Share (and Copy to
 * memory) are never pressed: this is the user's real memory and project.
 */
async function runProjectMemoryStep(win: BrowserWindow, root: string): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pageSelector = `[data-project-page=${JSON.stringify(root)}]`;
  const q = (selector: string) => `document.querySelector(${JSON.stringify(`${pageSelector} ${selector}`)})`;
  if (!(await waitInPage(win, q('[data-project-tab="memory"]'), 3_000))) return 'the project page has no Memory tab';
  await js(`${q('[data-project-tab="memory"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-project-tab="memory"]')}.getAttribute('aria-selected') === 'true' && ${q('[data-project-memory-tab]')}`, 10_000))) return 'the Memory tab did not load';
  const memories = (await js(`document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-memory-row][data-memory-kind="memory"]`)}).length`)) as number;
  const instructions = (await js(`document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-memory-row][data-memory-kind="instruction"]`)}).length`)) as number;
  let listed = `${memories} memories, ${instructions} instruction files`;
  if (instructions > 0 && memories === 0 && !(await waitInPage(win, `${q('[data-memory-content]')} && ${q('[data-memory-content]')}.innerText !== 'Reading…'`, 5_000))) return 'the viewer did not show the instruction file';
  // What loads here: open the first time, folds to one line and opens again.
  const card = q('[data-memory-load-order]');
  if (!(await waitInPage(win, `${card}?.dataset.open === 'true' && ${card}.querySelectorAll('[data-memory-load-item]').length > 0 || ${card}?.innerText.includes('Nothing loads here')`, 5_000))) return 'What loads here did not open with its files';
  const loads = (await js(`${card}.querySelectorAll('[data-memory-load-item]').length`)) as number;
  listed += `, ${loads} in What loads here`;
  await js(`${q('[data-memory-load-toggle]')}.click()`);
  if (!(await waitInPage(win, `${card}.dataset.open === 'false' && ${card}.innerText.includes('Loads ')`, 2_000))) return 'What loads here did not fold to its summary';
  await js(`${q('[data-memory-load-toggle]')}.click()`);
  if (!(await waitInPage(win, `${card}.dataset.open === 'true'`, 2_000))) return 'What loads here did not open again';
  // New opens its form, and Escape closes it without writing anything.
  await js(`${q('[data-memory-new]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-memory-new-dialog] [data-memory-new-name]')", 3_000))) return 'New did not open the new memory form';
  if (!(await js("document.querySelector('[data-memory-new-save]').disabled"))) return 'Save memory was possible without a name';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-memory-new-dialog]')", 2_000))) return 'Escape did not close the new memory form';
  // Import opens its menu (from the export, paste, copy for the app), and Escape closes it without picking one.
  await js(`${q('[data-memory-import-menu]')}.click()`);
  if (!(await waitInPage(win, "!!document.querySelector('[data-memory-menu-import-export]') && !!document.querySelector('[data-memory-menu-paste-app]') && !!document.querySelector('[data-memory-menu-copy-for-app]')", 2_000))) return 'Import did not open its menu';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-memory-menu-import-export]')", 2_000))) return 'Escape did not close the Import menu';
  if (memories > 0) return checkShareDialog(win, root, listed);

  // No memory in the real project: a throwaway Claude profile in the app's sandbox gets one (the tab lists every
  // profile's memory), so the dialog can be opened. The profile is removed again afterwards.
  const memoryDir = (await js(`${q('[data-project-memory-tab]')}.dataset.memoryDir`)) as string;
  const encoded = /\/projects\/([^/]+)\/memory$/.exec(memoryDir)?.[1];
  if (!encoded) {
    await shot(win, 'project-memory.png');
    return `ok: ${listed}; memory lives in a folder of its own (autoMemoryDirectory), so no sandbox memory to share`;
  }
  const sandbox = join(app.getPath('userData'), 'smoke-claude-memory');
  const dir = join(sandbox, 'projects', encoded, 'memory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'smoke-share.md'), '---\nname: smoke-share\ndescription: Made by the smoke test\nmetadata:\n  type: project\n---\n\nRun `npm run check` before reporting work as done. See [[smoke-other]].\n');
  writeFileSync(join(dir, 'MEMORY.md'), '- [Smoke share](smoke-share.md) — Made by the smoke test\n');
  writeFileSync(join(sandbox, 'CLAUDE.md'), '# Smoke profile\n\nInstructions for every project, from the smoke test.\n');
  writeFileSync(join(dir, 'smoke-linker.md'), '---\nname: smoke-linker\ndescription: Links to the other smoke memory\nmetadata:\n  type: reference\n---\n\nSee [[smoke-share]].\n');
  const profile = await addSmokeProfile(win, 'Smoke memory', sandbox);
  if (!profile.startsWith('id:')) return profile;
  try {
    // Settings returns to the project page; leaving the tab and coming back reads the memory again.
    await js(`${q('[data-project-tab="overview"]')}.click()`);
    await js(`${q('[data-project-tab="memory"]')}.click()`);
    if (!(await waitInPage(win, q('[data-memory-row][data-memory-kind="memory"]'), 5_000))) return "the sandbox profile's memory was not listed";
    // What loads here with the sandbox profile: its CLAUDE.md and the start of its MEMORY.md, in the legend. The profile
    // select shows once the card has read the load order.
    if (!(await waitInPage(win, q('[data-memory-load-profile]'), 5_000))) return 'What loads here has no profile select with two profiles';
    if (!(await chooseOption(win, `${pageSelector} [data-memory-load-profile]`, profile.slice(3)))) return 'could not pick the sandbox profile in What loads here';
    const legend = `[...document.querySelectorAll(${JSON.stringify(`${pageSelector} [data-memory-load-item]`)})].map((b) => b.innerText).join(' | ')`;
    if (!(await waitInPage(win, `${legend}.includes('MEMORY.md') && ${legend}.includes('CLAUDE.md')`, 5_000))) return `What loads here did not list the sandbox profile's files (${String(await js(legend))})`;
    await shot(win, 'memory-load-order.png');
    // Search finds the sandbox memory in its own Memory group above the conversations. Nothing is opened.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['meta', 'shift'] });
    if (!(await waitInPage(win, "document.querySelector('[data-search] input[role=combobox]')", 3_000))) return 'search did not open';
    await setFieldValue(win, '[data-search] input[role=combobox]', 'smoke share');
    if (!(await waitInPage(win, "document.querySelector('[data-search-memory-group] [data-search-memory-hit]')", 5_000))) return 'search did not find the sandbox memory';
    await shot(win, 'memory-search.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await waitInPage(win, "!document.querySelector('[data-search]')", 2_000))) return 'Escape did not close search';
    // Links: smoke-share is linked from smoke-linker, and its own [[smoke-other]] isn't written yet.
    const sharePath = join(dir, 'smoke-share.md');
    await js(`${q(`[data-memory-row=${JSON.stringify(sharePath)}]`)}.click()`);
    if (!(await waitInPage(win, `${q('[data-memory-backlinks] [data-memory-backlink]')} && ${q('[data-memory-links] [data-memory-write-link="smoke-other"]')}`, 5_000))) return 'the editor did not show Linked from and Not written yet';
    await shot(win, 'memory-links.png');
    // Health: smoke-linker isn't in MEMORY.md, so there is something to look at. The panel opens; nothing is fixed.
    if (!(await waitInPage(win, q('[data-memory-health-show]'), 5_000))) return 'What loads here has no Health line';
    await js(`${q('[data-memory-health-show]')}.click()`);
    if (!(await waitInPage(win, `${q('[data-memory-health] [data-memory-health-finding="indexMismatch"] [data-memory-health-fix]')}`, 5_000))) return 'the Health panel did not list the memory missing from MEMORY.md';
    await shot(win, 'memory-health.png');
    return await checkShareDialog(win, root, `${listed} (+1 in a sandbox profile)`);
  } finally {
    await removeSmokeProfile(win, profile.slice(3));
  }
}

/**
 * Settings › Memory, read-only: the personal folder (in the throwaway app data) and the project's row are listed, and the
 * preview of the CLAUDE.md block opens and is cancelled. The block is never written: that would change the real CLAUDE.md.
 */
async function runMemorySettingsStep(win: BrowserWindow, root: string): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"memory\"]')", 3_000))) return 'Settings has no Memory section';
  await click('[data-settings-section="memory"]');
  if (!(await waitInPage(win, "document.querySelector('[data-memory-settings] [data-memory-personal-dir]')", 5_000))) return 'Settings › Memory did not show the personal folder';
  const dir = (await js("document.querySelector('[data-memory-personal-dir]').dataset.tooltip")) as string;
  if (!dir.startsWith(app.getPath('userData'))) return `the personal folder is not in the app's data: ${dir}`;
  if (!(await waitInPage(win, `!!document.querySelector(${JSON.stringify(`[data-memory-project=${JSON.stringify(root)}]`)})`, 5_000))) return 'the project is not listed under Projects';
  const state = (await js("document.querySelector('[data-memory-block-state]').dataset.memoryBlockState")) as string;
  let preview = 'no preview (already loaded)';
  if (await js("!!document.querySelector('[data-memory-add-block]')")) {
    await click('[data-memory-add-block]');
    if (!(await waitInPage(win, "document.querySelectorAll('[data-memory-block-dialog] [data-memory-block-profile]').length > 0", 5_000))) return 'the CLAUDE.md preview did not open';
    await shot(win, 'memory-block-preview.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await waitInPage(win, "!document.querySelector('[data-memory-block-dialog]')", 2_000))) return 'Escape did not close the CLAUDE.md preview';
    preview = 'CLAUDE.md preview opened and cancelled';
  }
  await shot(win, 'settings-memory.png');

  // Import from Claude export with a made-up unzipped export in the sandbox (main hands its path over in a smoke
  // run): the preview lists it, and Escape cancels. Import is never pressed.
  const exportDir = smokeMemoryExport();
  mkdirSync(join(exportDir, 'memories'), { recursive: true });
  const memoryFile = (path: string, name: string, description: string) => ({ path, content: `---\nname: ${name}\ndescription: ${description}\n---\n\nMade up for the smoke test.\n`, updated_at: '2026-10-01T10:00:00Z' });
  writeFileSync(
    join(exportDir, 'memories', 'smoke-account.json'),
    JSON.stringify({ memory_files: [memoryFile('/profile.md', 'Profile', 'A made-up profile'), memoryFile('/topics/smoke.md', 'Smoke', 'A made-up topic'), memoryFile('/areas/nowhere.md', 'Nowhere', 'No such project')] }),
  );
  await click('[data-memory-import-export]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-memory-import] [data-memory-import-row]').length === 3", 5_000))) return 'the import preview did not list the made-up export';
  const flags = (await js("document.querySelector('[data-memory-import-row=\"/areas/nowhere.md\"]').innerText")) as string;
  if (!flags.includes('no matching project')) return 'an area without a project was not flagged';
  await shot(win, 'memory-import.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-memory-import]')", 2_000))) return 'Escape did not close the import preview';
  await click('[data-close-settings]');
  return `ok: personal folder in the app's data, block ${state}, project listed, ${preview}, import preview of 3 made-up memories cancelled`;
}

/** Adds a Claude profile for a sandbox folder through Settings; returns `id:<id>`, or what went wrong. */
async function addSmokeProfile(win: BrowserWindow, name: string, folder: string): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"profiles\"]')", 3_000))) return 'Settings did not open';
  await click('[data-settings-section="profiles"]');
  if (!(await waitInPage(win, "document.querySelector('[data-add-profile]')", 3_000))) return 'no Add profile in Settings';
  const before = (await js("document.querySelectorAll('[data-profiles] [data-profile]').length")) as number;
  await click('[data-add-profile]');
  if (!(await waitInPage(win, "document.querySelector('[data-new-profile-folder]')", 3_000))) return 'the add profile form did not open';
  await setFieldValue(win, '[data-new-profile-name]', name);
  await setFieldValue(win, '[data-new-profile-folder]', folder);
  await click('[data-add-profile-submit]');
  if (!(await waitInPage(win, `document.querySelectorAll('[data-profiles] [data-profile]').length === ${before + 1}`, 5_000))) return 'the sandbox profile was not added';
  const id = (await js(`document.querySelectorAll('[data-profiles] [data-profile]')[${before}].dataset.profile`)) as string;
  await click('[data-close-settings]');
  return `id:${id}`;
}

/** Removes a profile `addSmokeProfile` added (its sandbox folder goes with the throwaway app profile). */
async function removeSmokeProfile(win: BrowserWindow, id: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const card = `[data-profile=${JSON.stringify(id)}]`;
  await click('[data-open-settings]');
  await waitInPage(win, "document.querySelector('[data-settings-section=\"profiles\"]')", 3_000);
  await click('[data-settings-section="profiles"]');
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(`${card} [data-remove-profile]`)})`, 3_000))) return;
  await click(`${card} [data-remove-profile]`);
  if (await waitInPage(win, "document.querySelector('[data-confirm]')", 3_000)) await click('[data-confirm]');
  await waitInPage(win, `!document.querySelector(${JSON.stringify(card)})`, 5_000);
  await click('[data-close-settings]');
}

/**
 * Opens the share dialog on the first memory of the project's Memory tab: the preview follows CLAUDE.md, a rule and
 * CLAUDE.local.md, and Cancel closes it. Share is never pressed.
 */
async function checkShareDialog(win: BrowserWindow, root: string, listed: string): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pageSelector = `[data-project-page=${JSON.stringify(root)}]`;
  const q = (selector: string) => `document.querySelector(${JSON.stringify(`${pageSelector} ${selector}`)})`;
  const dialog = (selector = '') => `document.querySelector(${JSON.stringify(`[data-share-dialog]${selector ? ` ${selector}` : ''}`)})`;

  // The first memory shows in the viewer.
  const path = (await js(`${q('[data-memory-row][data-memory-kind="memory"]')}.dataset.memoryRow`)) as string;
  await js(`${q('[data-memory-row][data-memory-kind="memory"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-memory-viewer]')}.dataset.memoryViewer === ${JSON.stringify(path)} && ${q('[data-memory-content]')}`, 5_000))) return 'the memory did not show in the editor';
  // The editor shows the frontmatter as fields and starts saved; nothing is typed or saved here.
  if (!(await js(`${q('[data-memory-editor] [data-memory-description]')} !== null && ${q('[data-memory-save-state]')}.dataset.memorySaveState === 'saved'`))) return 'the editor has no description field, or did not start saved';
  await shot(win, 'project-memory.png');

  // Its share dialog: the preview is read for CLAUDE.md, then a rule, then CLAUDE.local.md.
  await js(`${q('[data-memory-share]')}.click()`);
  const preview = () => js(`${dialog('[data-share-preview]')}?.dataset.sharePreview ?? null`) as Promise<string | null>;
  const previewIs = (test: string) => waitInPage(win, `(() => { const p = ${dialog('[data-share-preview]')}?.dataset.sharePreview ?? ''; return ${test}; })()`, 5_000);
  if (!(await waitInPage(win, dialog(), 3_000))) return 'Share with the team… did not open the dialog';
  if (!(await previewIs(`p.endsWith('CLAUDE.md') && !p.endsWith('local.md')`))) return `no CLAUDE.md preview (got ${await preview()})`;
  if (!(await js(`${dialog('[data-share-remove]')}.getAttribute('aria-checked') === 'true'`))) return 'Remove from memory was off for CLAUDE.md';
  const confirmLabel = async () => ((await js(`${dialog('[data-share-confirm]')}.innerText`)) as string).split('\n')[0];
  const labels = [await confirmLabel()];

  await js(`${dialog('[data-share-target-option="rule"]')}.click()`);
  if (!(await waitInPage(win, `${dialog('[data-share-target]')}.dataset.shareTarget === 'rule'`, 2_000))) return 'the Rule file target did not switch';
  // With no rules yet, a new rule needs a name before there is a preview. Typing it writes nothing.
  if (await js(`!!${dialog('[data-share-rule-name]')}`)) await setFieldValue(win, '[data-share-dialog] [data-share-rule-name]', 'smoke-preview');
  if (!(await previewIs(`p.startsWith('.claude/rules/')`))) return `no rule preview (got ${await preview()})`;
  labels.push(await confirmLabel());

  await js(`${dialog('[data-share-target-option="local"]')}.click()`);
  if (!(await previewIs(`p === 'CLAUDE.local.md'`))) return `no CLAUDE.local.md preview (got ${await preview()})`;
  if (!(await js(`${dialog('[data-share-remove]')}.getAttribute('aria-checked') === 'false'`))) return 'Remove from memory was on for CLAUDE.local.md';
  labels.push(await confirmLabel());
  const lines = (await js(`document.querySelectorAll('[data-share-dialog] [data-share-line="add"]').length`)) as number;
  if (lines === 0) return 'the preview shows no added lines';
  await shot(win, 'share-dialog.png');

  // Cancel (Escape) closes it, and the memory is still there.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, `!${dialog()}`, 2_000))) return 'Escape did not close the share dialog';
  if (!(await js(`!!document.querySelector(${JSON.stringify(`${pageSelector} [data-memory-row=${JSON.stringify(path)}]`)})`))) return 'the memory left the list without sharing';
  return `ok: ${listed}; share dialog previewed ${labels.join(', ')} and was cancelled`;
}

/**
 * Claude profiles: with one, nothing about profiles shows outside Settings. Adding a second (a config
 * folder inside the throwaway app profile, never a real one) marks sessions with their profile and
 * offers a choice in New session; its effort default reaches New session once it is the default, then
 * it is removed again.
 */
async function runProfilesStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const folder = join(app.getPath('userData'), 'smoke-claude-work');
  if (await js("!!document.querySelector('[data-profile-badge]')")) return 'profile badges shown with a single profile';
  await click('[data-open-settings]');
  await click('[data-settings-section="profiles"]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-profiles] [data-profile]').length === 1", 3_000))) return 'Settings did not list the built-in profile';
  await click('[data-profile-guide-toggle]');
  if (!(await waitInPage(win, "document.querySelector('[data-profile-guide] ol')?.innerText.includes('CLAUDE_CONFIG_DIR=')", 2_000))) return 'the setup guide did not open';
  await shot(win, 'profile-guide.png');
  await click('[data-profile-guide-toggle]');
  await click('[data-add-profile]');
  if (!(await waitInPage(win, "document.querySelector('[data-new-profile-folder]')", 3_000))) return 'the add profile form did not open';
  await setFieldValue(win, '[data-new-profile-name]', 'Smoke work');
  await setFieldValue(win, '[data-new-profile-folder]', folder);
  await click('[data-add-profile-submit]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-profiles] [data-profile]').length === 2", 5_000))) {
    return `the profile was not added (${String(await js("document.querySelector('[data-add-profile-form]')?.innerText ?? ''"))})`;
  }
  const id = (await js("document.querySelectorAll('[data-profiles] [data-profile]')[1].dataset.profile")) as string;
  const card = `[data-profile=${JSON.stringify(id)}]`;
  if (!(await js(`document.querySelector(${JSON.stringify(card)}).innerText.includes(${JSON.stringify(folder)})`))) return 'the sign-in command does not name the folder';
  await shot(win, 'profiles.png');
  // Its defaults for new sessions: Max effort, which New session takes where the project sets none.
  await click(`${card} [data-profile-defaults-toggle]`);
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(`${card} [data-default-effort]`)})`, 2_000))) return 'the profile defaults did not open';
  if (!(await chooseOption(win, `${card} [data-default-effort]`, 'max'))) return 'could not pick an effort default for the profile';
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(`${card} [data-profile-defaults-summary]`)})?.innerText.includes('max effort')`, 3_000))) return 'the profile default was not saved';
  await shot(win, 'profile-defaults.png');
  await click(`[data-profile-default=${JSON.stringify(id)}]`);
  await click('[data-close-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-session-id] [data-profile-badge]')", 3_000))) return 'sessions do not show their profile with two profiles';
  await click('[data-new-session]');
  if (!(await waitInPage(win, `document.querySelector('[data-profile-select]')?.dataset.value === ${JSON.stringify(id)}`, 5_000))) {
    return 'New session did not offer the profiles with the new default chosen';
  }
  // No project is added by now (the projects step removes its own), so nothing sets an effort over the profile's.
  if (!(await waitInPage(win, "document.querySelector('[data-new-session-view] [data-effort-select]')?.dataset.value === 'max'", 3_000))) {
    return `New session did not start from the profile's defaults (effort ${String(await js("document.querySelector('[data-new-session-view] [data-effort-select]')?.dataset.value"))})`;
  }
  await click('[data-profile-select]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-menu=\"profile\"] [role=menuitemradio]').length === 2", 3_000))) return 'the profile menu did not list both profiles';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  // Wait for the menu to close: a late Escape would otherwise close the Settings view opened next.
  if (!(await waitInPage(win, "!document.querySelector('[data-menu=\"profile\"]')", 3_000))) return 'Escape did not close the profile menu';

  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"profiles\"]')", 3_000))) return 'Settings did not open';
  await click('[data-settings-section="profiles"]');
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(`${card} [data-remove-profile]`)})`, 3_000))) return 'no way to remove the profile';
  await click(`${card} [data-remove-profile]`);
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 3_000))) return 'no confirmation before removing';
  await click('[data-confirm]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-profiles] [data-profile]').length === 1", 5_000))) return 'the profile was not removed';
  const builtinDefault = await js("document.querySelector('[data-profile-default=\"default\"]').getAttribute('aria-checked') === 'true'");
  await click('[data-close-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-session-id]') && !document.querySelector('[data-session-id] [data-profile-badge]')", 3_000))) return 'sessions still show a profile after removing it';
  if (!builtinDefault) return 'the built-in profile did not become the default again';
  return "ok: added a second profile, set its effort default, sessions and New session showed it (with the profile's effort), made it the default, removed it";
}

/**
 * Settings → About shows the running version (matching app.getVersion()) and the update controls, and
 * Check for Updates… is in the app menu. Nothing is checked, downloaded or installed: the menu item is
 * only clicked when updates are turned off (as in an unpackaged build), where it just opens About.
 */
async function runAboutStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('check-updates');
  if (!menuItem) return 'no Check for Updates… in the app menu';
  const off = updater.state.status === 'disabled';
  if (off) menuItem.click();
  else {
    await js("document.querySelector('[data-open-settings]').click()");
    await waitInPage(win, "document.querySelector('[data-settings-section=\"about\"]')", 3_000);
    await js("document.querySelector('[data-settings-section=\"about\"]').click()");
  }
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"about\"] [data-about]')", 3_000))) return off ? 'Check for Updates… did not open Settings → About' : 'Settings → About did not open';
  const shown = (await js("document.querySelector('[data-app-version]')?.dataset.appVersion ?? null")) as string | null;
  if (shown !== app.getVersion()) return `About shows version ${shown}, the app is ${app.getVersion()}`;
  const navVersion = (await js("document.querySelector('[data-settings-version]')?.innerText ?? ''")) as string;
  if (app.isPackaged ? navVersion !== `v${app.getVersion()}` : !navVersion.startsWith('dev')) return `the Settings sidebar shows "${navVersion}"`;
  const controls = (await js(
    `['[data-check-updates]', '[data-auto-update]', '[data-update-channel="stable"][aria-checked=true]', '[data-update-channel="nightly"]', '[data-changelog-link]'].filter((s) => !document.querySelector(s))`,
  )) as string[];
  if (controls.length > 0) return `missing: ${controls.join(', ')}`;
  if (off) {
    const status = (await js("document.querySelector('[data-update-status]')?.innerText ?? ''")) as string;
    if (!(await js("document.querySelector('[data-update-status=\"disabled\"]') && document.querySelector('[data-check-updates]').disabled"))) return 'updates are off but About does not say so';
    if (status !== updater.state.disabledReason) return `About says "${status}" instead of the reason updates are off`;
    if (await js("document.querySelector('[data-update-toast]')")) return 'an update toast shows while updates are off';
  }
  // With the mock feed (scripts/mock-update-server.ts --fake <newer version>), check it once; never download.
  let mockCheck = '';
  if (mockFeedUrl) {
    await js("document.querySelector('[data-check-updates]').click()");
    if (!(await waitInPage(win, "['available', 'up-to-date', 'error'].includes(document.querySelector('[data-update-status]')?.dataset.updateStatus)", 10_000))) return 'the mock check did not finish';
    if (updater.state.status === 'error') return `the mock check failed: ${updater.state.error}`;
    if (updater.state.status === 'available' && !(await waitInPage(win, "document.querySelector('[data-update-toast=\"available\"] [data-update-toast-action=\"download\"]') && document.querySelector('[data-about-release-notes]')", 3_000))) {
      return 'an update was found but the toast or the release notes did not show';
    }
    mockCheck = `, mock feed: ${updater.state.status === 'available' ? `v${updater.state.availableVersion} offered, toast shown` : 'up to date'}`;
  }
  const claudeCheck = await checkClaudeUpdates(win);
  if (!claudeCheck.startsWith('ok')) return `Claude Code: ${claudeCheck}`;
  await shot(win, 'about.png');
  await js("document.querySelector('[data-close-settings]').click()");
  return `ok: ${navVersion}${off ? `, updates off ("${updater.state.disabledReason}")` : `, updates ${updater.state.status}`}${mockCheck}; ${claudeCheck.slice(4)}`;
}

/**
 * Settings → About's Claude Code section, checked against the mock registry (which offers v999.0.0): the installed
 * version and the update or the command to run show, the toast appears and Dismiss hides it. Update is
 * never clicked, and the engine refuses it in smoke runs anyway (SWITCHBOARD_NO_CLAUDE_UPDATE).
 */
async function checkClaudeUpdates(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await waitInPage(win, "document.querySelector('[data-claude-updates]')", 5_000))) return 'no Claude Code section in About';
  if (!(await js("Boolean(document.querySelector('[data-claude-update-auto]'))"))) return 'no automatic-check toggle';
  await js("document.querySelector('[data-claude-update-check]')?.click()");
  const statusOf = "document.querySelector('[data-claude-updates]')?.dataset.claudeUpdateStatus";
  // The earlier automatic check's result is still shown right after the click; wait for this check to start
  // (it can also finish before the first look, so a miss here is fine).
  await waitInPage(win, `${statusOf} === 'checking'`, 1_500);
  if (!(await waitInPage(win, `['available', 'up-to-date', 'error', 'missing'].includes(${statusOf})`, 20_000))) return `the check did not finish (${await js(statusOf)})`;
  const status = (await js(statusOf)) as string;
  if (status === 'missing') return 'ok: no claude installed';
  if (status !== 'available') return `expected the mock v999.0.0 to be on offer, got ${status}: ${await js("document.querySelector('[data-claude-update-text]')?.innerText")}`;
  const installed = (await js("document.querySelector('[data-claude-installed-version]')?.dataset.claudeInstalledVersion ?? ''")) as string;
  const how = (await js("document.querySelector('[data-claude-update-run]') ? 'update button' : document.querySelector('[data-claude-update-command]') ? 'command to copy' : null")) as string | null;
  if (!how) return 'v999.0.0 is on offer but there is neither an Update button nor a command to copy';
  const quiet = (await js("document.querySelector('[data-claude-updates]')?.dataset.claudeUpdateQuiet === 'true'")) as boolean;
  if (quiet) return `ok: v${installed} installed, v999.0.0 offered (${how}), no notice (Claude Code's auto-updater is off)`;
  if (!(await waitInPage(win, "document.querySelector('[data-claude-update-toast=\"available\"]')", 3_000))) return 'no toast for v999.0.0';
  await shot(win, 'claude-update-toast.png');
  await js("document.querySelector('[data-claude-update-toast] [data-toast-close]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-claude-update-toast]')", 3_000))) return 'Dismiss did not hide the toast';
  return `ok: v${installed} installed, v999.0.0 offered (${how}), toast shown and dismissed`;
}

/**
 * Settings → Backup: exports to a file in the throwaway profile (main skips the save dialog in a smoke run)
 * and checks it parses, then opens the import preview of that file and cancels. Nothing is imported.
 */
async function runBackupStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const file = smokeSettingsFile();
  rmSync(file, { force: true });
  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"backup\"]')", 3_000))) return 'Settings has no Backup section';
  await click('[data-settings-section="backup"]');
  if (!(await waitInPage(win, "document.querySelector('[data-backup-export]')", 2_000))) return 'the Backup section did not open';
  await click('[data-backup-export]');
  if (!(await waitInPage(win, "document.querySelector('[data-export-dialog] [data-export-section=\"sessions\"][aria-checked=\"false\"]')", 2_000))) return 'the export dialog did not open with sessions left out';
  await click('[data-export-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-export-saved]')", 5_000))) return 'the export did not finish';
  await shot(win, 'backup-export.png');
  let exported: Record<string, unknown>;
  try {
    exported = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return `the exported file does not parse: ${(error as Error).message}`;
  }
  if (exported.kind !== 'switchboard-settings' || exported.format !== 2) return `not a settings file: ${JSON.stringify(exported).slice(0, 200)}`;
  if (typeof exported.preferences !== 'object' || !Array.isArray(exported.themes) || !Array.isArray(exported.projects) || typeof exported.actions !== 'object' || 'sessions' in exported) {
    return `unexpected sections: ${Object.keys(exported).join(', ')}`;
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-export-dialog]')", 2_000))) return 'Escape did not close the export dialog';

  // The preview of the file just exported: everything is already set up, so there is nothing to import.
  await click('[data-backup-import]');
  if (!(await waitInPage(win, "document.querySelector('[data-import-dialog] [data-import-preview]')", 5_000))) return 'the import preview did not open';
  await click('[data-import-mode="replace"]');
  const summary = (await js("document.querySelector('[data-import-summary]')?.textContent ?? ''")) as string;
  const disabled = (await js("document.querySelector('[data-import-settings]')?.disabled === true")) as boolean;
  await shot(win, 'backup-import.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-import-dialog]') && document.querySelector('[data-settings]')", 2_000))) return 'Escape did not close only the import dialog';
  await click('[data-close-settings]');
  if (existsSync(join(app.getPath('userData'), 'backups'))) return 'a backup was written without importing';
  if (!disabled) return `importing the file just exported would change something: ${summary}`;
  return `ok (${summary})`;
}

/** `#rrggbb` as the page reports a computed colour. */
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

/**
 * Themes, in Settings › Theme: export Demo Time, import that file again (a copy, as Demo Time is built
 * in), pick it, and remove it; import a minimal canvas-and-accent theme from a folder of the throwaway
 * profile, check the sidebar and a code block's background in light and dark, and remove it; then pick
 * every built-in in both modes and check the sidebar and code block follow it. Ends on Demo Time and
 * Match System. Only the throwaway profile changes: the theme files are written and deleted there.
 */
async function runThemeStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code) as Promise<unknown>;
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const section = async (id: string) => {
    await click(`[data-settings-section="${id}"]`);
    return waitInPage(win, `document.querySelector('[data-settings-page="${id}"]')`, 2_000);
  };
  const sidebar = "getComputedStyle(document.querySelector('[data-sidebar-open]')).backgroundColor";
  const rail = "getComputedStyle(document.querySelector('[data-sidebar-rail]')).backgroundColor";
  const sidebarState = "document.querySelector('[data-sidebar]')?.dataset.sidebarState";
  const codeBlock = "getComputedStyle(document.querySelector('[data-rendering-check] .code-block')).backgroundColor";
  /** A token's value as the page computes it (the generated style element in use). */
  const token = (name: string) => `(() => { const d = document.createElement('div'); d.style.background = 'var(--sb-${name})'; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`;
  const scheme = async (mode: 'light' | 'dark') => {
    await click(`[data-color-scheme="${mode}"]`);
    return waitInPage(win, `matchMedia('(prefers-color-scheme: ${mode})').matches`, 2_000);
  };
  const pick = async (id: string) => {
    await click(`[data-theme-card="${id}"] [role="radio"]`);
    return (await waitInPage(win, `document.querySelector('[data-theme-card="${id}"][data-theme-selected]')`, 2_000)) && preferences.get().themeId === id;
  };
  const menu = async (id: string, item: string) => {
    await click(`[data-theme-menu="${id}"]`);
    if (!(await waitInPage(win, `document.querySelector('[data-${item}="${id}"]')`, 2_000))) return false;
    await click(`[data-${item}="${id}"]`);
    return true;
  };
  /** The sidebar and a code block (Settings › Diagnostics renders one) against expected colours, or the live tokens. */
  const colours = async (expected: { sidebar: string; code: string } | null) => {
    if (!(await section('diagnostics'))) return 'Diagnostics did not open';
    const want = expected ?? { sidebar: (await js(token('sidebar'))) as string, code: (await js(token('code-bg'))) as string };
    const ok = await waitInPage(win, `${sidebar} === ${JSON.stringify(want.sidebar)} && ${codeBlock} === ${JSON.stringify(want.code)}`, 3_000);
    const got = `sidebar ${await js(sidebar)}, code ${await js(codeBlock)}`;
    await section('theme');
    return ok ? null : `expected sidebar ${want.sidebar} and code ${want.code}, got ${got}`;
  };

  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"theme\"]')", 3_000))) return 'Settings has no Theme section';
  if (!(await section('theme'))) return 'the Theme section did not open';
  const cards = (await js("[...document.querySelectorAll('[data-theme-picker] [data-theme-card]')].map((c) => c.dataset.themeCard)")) as string[];
  const builtIns = BUILT_IN_THEMES.map((t) => t.id);
  if (cards.slice(0, builtIns.length).join(',') !== builtIns.join(',')) return `the picker shows ${cards.join(', ')}`;

  // Export Demo Time: every token, with $schema.
  const exportDir = smokeThemeExports();
  rmSync(exportDir, { recursive: true, force: true });
  if (!(await menu('demo-time', 'theme-export'))) return 'Demo Time has no Export…';
  const exported = join(exportDir, 'demo-time.json');
  if (!(await waitInPage(win, "document.querySelector('[data-theme-flash]')", 3_000)) || !existsSync(exported)) return 'Export did not write demo-time.json';
  const file = JSON.parse(readFileSync(exported, 'utf8')) as { $schema?: string; dark?: { colors?: Record<string, string> } };
  if (!file.$schema || Object.keys(file.dark?.colors ?? {}).length < 30) return 'the export is not a full theme';

  // Import it again: the name is taken by the built-in, so it is kept as a copy.
  smokeThemeFile = exported;
  await click('[data-theme-import]');
  if (!(await waitInPage(win, "document.querySelector('[data-theme-import-dialog]')", 3_000))) return 'the import dialog did not open';
  await click('[data-theme-add-use]');
  if (!(await waitInPage(win, "document.querySelector('[data-theme-keep-both]')", 2_000))) return 'no "You already have" choice for Demo Time';
  await click('[data-theme-keep-both]');
  if (!(await waitInPage(win, "document.querySelector('[data-theme-card=\"demo-time-2\"][data-theme-selected]')", 3_000))) return 'the copy was not added and picked';
  for (const mode of ['light', 'dark'] as const) {
    if (!(await scheme(mode))) return `${mode} did not apply`;
    await shot(win, `theme-settings-${mode}.png`);
    const demo = BUILT_IN_THEMES[0]!.raw as { [m: string]: { colors: Record<string, string> } };
    const problem = await colours({ sidebar: rgbOf(demo[mode]!.colors.sidebar!), code: rgbOf(demo[mode]!.colors['code-bg']!) });
    if (problem) return `the Demo Time copy, ${mode}: ${problem}`;
  }
  if (!(await pick('demo-time'))) return 'could not pick Demo Time again';
  if (!(await menu('demo-time-2', 'theme-remove'))) return 'the copy has no Remove';
  await click('[role="alertdialog"] [data-confirm]');
  if (!(await waitInPage(win, "!document.querySelector('[data-theme-card=\"demo-time-2\"]')", 3_000))) return 'the copy was not removed';

  // A minimal theme from a folder: canvas and accent only, everything else generated.
  const sourceDir = join(app.getPath('userData'), 'smoke-theme-source');
  mkdirSync(sourceDir, { recursive: true });
  smokeThemeFile = join(sourceDir, 'smoke-mint.json');
  writeFileSync(smokeThemeFile, JSON.stringify({ name: 'Smoke Mint', version: 1, light: { canvas: '#f3fbf7', accent: '#0f9d76' }, dark: { canvas: '#0f1a17', accent: '#3ddc97' } }));
  await click('[data-theme-import]');
  if (!(await waitInPage(win, "document.querySelector('[data-theme-import-dialog] [data-theme-report=\"generated\"]') && document.querySelector('[data-theme-terminal-strip]')", 3_000))) return 'the import report did not show what is generated';
  await shot(win, 'theme-import.png');
  await click('[data-theme-add-use]');
  if (!(await waitInPage(win, "document.querySelector('[data-theme-card=\"smoke-mint\"][data-theme-selected]')", 3_000))) return 'the minimal theme was not added and picked';
  for (const mode of ['light', 'dark'] as const) {
    if (!(await scheme(mode))) return `${mode} did not apply`;
    const live = { sidebar: (await js(token('sidebar'))) as string, code: (await js(token('code-bg'))) as string };
    const demo = (BUILT_IN_THEMES[0]!.raw as { [m: string]: { colors: Record<string, string> } })[mode]!.colors;
    if (live.sidebar === rgbOf(demo.sidebar!) || live.code === rgbOf(demo['code-bg']!)) return `the minimal theme kept Demo Time's ${mode} colours`;
    const problem = await colours(null);
    if (problem) return `the minimal theme, ${mode}: ${problem}`;
  }
  await shot(win, 'theme-settings.png');
  if (!(await pick('demo-time'))) return 'could not pick Demo Time again';
  if (!(await menu('smoke-mint', 'theme-remove'))) return 'the minimal theme has no Remove';
  await click('[role="alertdialog"] [data-confirm]');
  if (!(await waitInPage(win, "!document.querySelector('[data-theme-card=\"smoke-mint\"]')", 3_000))) return 'the minimal theme was not removed';

  /**
   * The collapsed sidebar in the theme: ⌘B down to the rail (Settings closed, a session beside it), its
   * background and the session view's against the theme, a screenshot, then ⌘B back to the full sidebar.
   */
  const collapsedRail = async (id: string, mode: 'light' | 'dark', colors: Record<string, string>) => {
    const collapsed = preferences.get().sidebarCollapsed;
    updatePreferences({ sidebarCollapsed: 'minimal' });
    await click('[data-close-settings]');
    if (smokeSessionId) await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    // Not from the terminal: on Windows its Ctrl keys are the shell's (⌘ keys reach the window on macOS).
    const blurTerminal = () => js("document.activeElement?.closest('.xterm') && document.activeElement.blur()");
    await blurTerminal();
    pressKey(win, 'B', ['meta']);
    const minimal = await waitInPage(win, `${sidebarState} === 'minimal' && document.querySelector('[data-sidebar-rail] [data-sidebar-rail-row]')`, 3_000);
    const ok = minimal && (await waitInPage(win, `${rail} === ${JSON.stringify(rgbOf(colors.sidebar!))} && getComputedStyle(document.body).backgroundColor === ${JSON.stringify(rgbOf(colors.bg!))}`, 2_000));
    const got = minimal ? `rail ${await js(rail)}, page ${await js('getComputedStyle(document.body).backgroundColor')}` : `sidebar ${String(await js(sidebarState))}`;
    if (minimal) await shot(win, `theme-rail-${id}-${mode}.png`);
    await blurTerminal();
    pressKey(win, 'B', ['meta']);
    await waitInPage(win, `${sidebarState} === 'open'`, 2_000);
    updatePreferences({ sidebarCollapsed: collapsed });
    await click('[data-open-settings]');
    await section('theme');
    return ok ? null : `the collapsed sidebar does not follow the theme (${got})`;
  };

  // Every built-in, in light and dark: the open sidebar, a code block, and the rail. A mode the theme
  // doesn't have (Nord and The unnamed are dark only) shows Demo Time's.
  for (const { id, raw } of BUILT_IN_THEMES) {
    if (!(await pick(id))) return `could not pick ${id}`;
    for (const mode of ['light', 'dark'] as const) {
      if (!(await scheme(mode))) return `${mode} did not apply`;
      type Modes = { [m: string]: { colors: Record<string, string> } | undefined };
      const colors = ((raw as Modes)[mode] ?? (BUILT_IN_THEMES[0]!.raw as Modes)[mode])!.colors;
      const problem = (await colours({ sidebar: rgbOf(colors.sidebar!), code: rgbOf(colors['code-bg']!) })) ?? (await collapsedRail(id, mode, colors));
      if (problem) return `${id}, ${mode}: ${problem}`;
    }
  }
  if (preferences.get().themeId !== 'demo-time' && !(await pick('demo-time'))) return 'could not go back to Demo Time';
  await click('[data-color-scheme="system"]');
  await click('[data-close-settings]');
  smokeThemeFile = null;
  return `ok (${cards.length} themes, 2 imported and removed)`;
}

/** Tool calls are summarised by default: open the last finished group and count its steps. */
async function runActivityStep(win: BrowserWindow): Promise<{ groups: number; steps: number; label: string } | null> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const groups = (await js("document.querySelectorAll('[data-activity]').length")) as number;
  if (groups === 0) return null;
  // The last finished group, or the live one when Claude is still on its first.
  const group = "([...document.querySelectorAll('[data-activity=\"done\"]')].at(-1) ?? [...document.querySelectorAll('[data-activity]')].at(-1))";
  const label = (await js(`${group}?.querySelector('button')?.innerText.replace(/\\s+/g, ' ') ?? ''`)) as string;
  await js(`${group}?.querySelector('button')?.click()`);
  await waitInPage(win, `${group}?.querySelector('[data-steps]')`, 2_000);
  await js(`${group}?.querySelector('[data-step] button')?.click()`);
  await shot(win, 'activity.png');
  const steps = (await js(`${group}?.querySelectorAll('[data-step]').length ?? 0`)) as number;
  await js(`${group}?.querySelector('[data-step] button')?.click()`);
  await js(`${group}?.querySelector('button')?.click()`);
  return { groups, steps, label };
}

/**
 * Read-only: opens the Changes panel on the session's real checkout, expands the first file's
 * diff and closes it again. Never stages or reverts (this is the user's own project).
 */
/**
 * The open diff: unwrapped, every line's background spans the whole scrollable width; wrapped,
 * nothing scrolls sideways. Leaves the wrap setting as it found it.
 */
async function checkDiffLayout(win: BrowserWindow): Promise<string | null> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const measure = `(() => {
    const diff = document.querySelector('[data-file-diff]');
    const rows = [...diff.firstElementChild.children];
    return { wrap: diff.dataset.diffWrap === 'true', scroll: diff.scrollWidth, client: diff.clientWidth, narrowest: Math.min(...rows.map((r) => r.offsetWidth)) };
  })()`;
  const toggle = "document.querySelector('[data-diff-wrap-toggle]')?.click()";
  if (!(await js("Boolean(document.querySelector('[data-diff-wrap-toggle]'))"))) return 'no wrap toggle in the Changes panel';
  const before = (await js(measure)) as { wrap: boolean; scroll: number; client: number; narrowest: number };
  await js(toggle);
  await settle(win);
  const after = (await js(measure)) as typeof before;
  await js(toggle);
  const [unwrapped, wrapped] = before.wrap ? [after, before] : [before, after];
  if (unwrapped.wrap === wrapped.wrap) return 'the wrap toggle did not change the diff';
  if (unwrapped.narrowest < unwrapped.scroll - 1) return `diff rows are ${unwrapped.narrowest}px wide but the diff scrolls to ${unwrapped.scroll}px (colour stops short)`;
  if (wrapped.scroll > wrapped.client + 1) return `wrapped diff still scrolls sideways (${wrapped.scroll} > ${wrapped.client}px)`;
  return null;
}

async function runChangesStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await waitInPage(win, "document.querySelector('[data-toggle-changes]')", 5_000))) return 'no Changes button (not a git checkout?)';
  const wasOpen = (await js("!!document.querySelector('[data-changes-panel]')")) as boolean;
  if (!wasOpen) await js("document.querySelector('[data-toggle-changes]').click()");
  // The button shows until the engine first answers; outside git it then goes, with the panel.
  if (!(await waitInPage(win, "!document.querySelector('[data-toggle-changes]') || (document.querySelector('[data-changes-panel]') && !document.querySelector('[data-changes-panel]').innerText.includes('Loading'))", 5_000))) return 'panel did not load';
  if (!(await js("!!document.querySelector('[data-toggle-changes]')"))) return 'ok: skipped (session is not on a git checkout)';
  const files = (await js("document.querySelectorAll('[data-changed-file]').length")) as number;
  if (files > 0) {
    await js("document.querySelector('[data-file-toggle]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-file-diff] div')", 5_000))) return `${files} files, but the diff did not load`;
    const layout = await checkDiffLayout(win);
    if (layout) return layout;
  }
  await shot(win, 'changes.png');
  const messageActions = (await js("document.querySelectorAll('[data-message-actions]').length")) as number;
  if (!wasOpen) await js("document.querySelector('[data-toggle-changes]').click()");
  return `ok: ${files} changed files${files ? ', first diff shown, rows full width, wraps on request' : ''}; ${messageActions} messages with actions`;
}

/**
 * Read-only: the header's branch button on a session in its project's checkout shows the branch git
 * has checked out, and its menu lists the local branches; Escape closes it. While Claude works in the
 * session (often the one running this test) it is disabled and says why; then the step tries the next
 * sessions in the sidebar for the menu. Never switches branches (these are the user's own projects).
 */
async function runBranchStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const button = "document.querySelector('[data-current-session] [data-branch-menu]')";
  const notes: string[] = [];
  try {
    for (let i = 0; i < 8; i++) {
      if (i > 0) {
        const id = (await js(`(() => { const row = document.querySelectorAll('[data-session-id]')[${i}]; row?.click(); return row?.dataset.sessionId ?? null; })()`)) as string | null;
        if (!id) break;
        await waitInPage(win, `document.querySelector('[data-current-session="${id}"]')`, 3_000);
      }
      if (!(await waitInPage(win, "document.querySelector('[data-current-session] :is([data-branch-menu], [data-worktree-menu])')", i === 0 ? 5_000 : 1_500))) {
        if (i === 0 && (await js("!!document.querySelector('[data-current-session] [data-toggle-changes]')"))) return 'no branch button on a git checkout';
        continue;
      }
      if (!(await js(`!!${button}`))) continue;
      const { branch, cwd, busyTip } = (await js(
        `(() => { const b = ${button}; return { branch: b.dataset.branch, cwd: b.dataset.cwd, busyTip: b.getAttribute('aria-disabled') === 'true' ? b.dataset.tooltip : null }; })()`,
      )) as { branch: string; cwd: string; busyTip: string | null };
      const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
      let current = '';
      try {
        current = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
      } catch {
        // Detached HEAD.
      }
      if (branch !== current) return `button shows "${branch}", git has "${current || 'detached'}"`;
      if (busyTip !== null) {
        if (!busyTip.startsWith('Wait for Claude')) return `disabled without saying why ("${busyTip}")`;
        notes.push('disabled while Claude works');
        continue;
      }
      const local = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean);
      await js(`${button}.click()`);
      if (!(await waitInPage(win, "document.querySelector('[data-menu=\"branch\"] [data-branch-option]')", 3_000))) return 'menu did not open';
      const options = (await js("[...document.querySelectorAll('[data-menu=\"branch\"] [data-branch-option]')].map((o) => o.dataset.branchOption)")) as string[];
      const checked = (await js("document.querySelector('[data-menu=\"branch\"] [aria-checked=\"true\"]')?.dataset.branchOption ?? null")) as string | null;
      await shot(win, 'branch-menu.png');
      const missing = local.filter((b) => !options.includes(b));
      if (missing.length) return `menu misses ${missing.slice(0, 3).join(', ')}`;
      if (current && (options[0] !== current || checked !== current)) return `current branch is not first and ticked (${options[0]}, ${checked})`;
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      if (!(await waitInPage(win, "!document.querySelector('[data-menu=\"branch\"]')", 2_000))) return 'Escape did not close the menu';
      return `ok: on ${current || 'detached'}, ${options.length} branches listed, Escape closed the menu${notes.length ? `; ${notes.join(', ')} elsewhere` : ''}`;
    }
    return notes.length ? `ok: ${notes.join(', ')}; no idle session on a checkout to open the menu in` : 'ok: skipped (no session on a git checkout)';
  } finally {
    // Back to the session the other steps work with.
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"] [data-transcript-item]')`, 5_000);
  }
}

/**
 * Read-only: the "Open in" items in the header's ⋯ menu (the default app first, with ⌘O) open on top of
 * the transcript (nothing paints over the menu), offer GitHub with the link git's remotes give when the
 * checkout is on GitHub, and Escape closes the menu. Opens nothing.
 */
async function runOpenInStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const toggle = "document.querySelector('[data-current-session] [data-more-menu]')";
  const menu = "document.querySelector('[role=\"menu\"][aria-label=\"More\"]')";
  if (!(await waitInPage(win, toggle, 3_000))) return 'no More menu';
  await js(`${toggle}.click()`);
  if (!(await waitInPage(win, `${menu}?.querySelector('[role="menuitem"]')`, 2_000))) return 'menu did not open';
  if (!(await js(`!!${menu}.querySelector('[data-open-in]')`))) return 'no Open in items in the More menu';
  const defaultHint = ((await js(`${menu}.querySelector('[data-open-in]').innerText`)) as string).replace(/\s+/g, ' ').trim();
  // The middle of the menu's last item must hit the menu itself, not the transcript under the header.
  const onTop = (await js(
    `(() => { const menu = ${menu}; const r = [...menu.querySelectorAll('[role="menuitem"]')].at(-1).getBoundingClientRect(); return menu.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })()`,
  )) as boolean;
  const github = (await js(`${menu}.querySelector('[data-open-github]')?.dataset.openGithub ?? null`)) as string | null;
  await shot(win, 'open-in-menu.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  if (!onTop) return 'menu is covered by the page below it';
  const openKeys = process.platform === 'darwin' ? '⌘O' : 'Ctrl+O';
  if (!defaultHint.includes(openKeys)) return `the default app does not show ${openKeys} ("${defaultHint}")`;
  if (github !== null && !/^https:\/\/github\.com\/[^/]+\/[^/]+(\/tree\/.+)?$/.test(github)) return `odd GitHub link "${github}"`;
  if (!(await waitInPage(win, `!${menu}`, 2_000))) return 'Escape did not close the menu';
  return `ok: Open in items in the More menu (${defaultHint}), on top of the transcript, ${github ? `GitHub → ${github}` : 'no GitHub remote'}, Escape closed it`;
}

/**
 * Read-only: More → Check transcript… opens the dialog, which finds the open session's transcript file,
 * says what Claude Code's reader returned, lists its findings, and closes on Escape. Copies nothing.
 */
async function runCheckTranscriptStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const toggle = "document.querySelector('[data-current-session] [data-more-menu]')";
  const dialog = "document.querySelector('[data-transcript-diagnosis]')";
  if (!(await waitInPage(win, toggle, 3_000))) return 'no More menu';
  await js(`${toggle}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-check-transcript]:not(:disabled)')", 2_000))) return 'no Check transcript… item in the More menu';
  await js("document.querySelector('[role=menuitem][data-check-transcript]').click()");
  if (!(await waitInPage(win, `${dialog}?.dataset.transcriptDiagnosis === 'done'`, 15_000))) {
    return `the check did not finish (${await js(`${dialog}?.dataset.transcriptDiagnosis ?? 'no dialog'`)})`;
  }
  const result = JSON.parse(
    (await js(
      `JSON.stringify({ files: ${dialog}.querySelectorAll('[data-diagnosis-file]').length, reads: [...${dialog}.querySelectorAll('[data-diagnosis-read]')].map((el) => el.dataset.diagnosisRead), findings: [...${dialog}.querySelectorAll('[data-diagnosis-finding]')].map((el) => el.dataset.diagnosisFinding) })`,
    )) as string,
  ) as { files: number; reads: string[]; findings: string[] };
  await shot(win, 'check-transcript.png');
  await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  if (!(await waitInPage(win, `!${dialog}`, 2_000))) return 'Escape did not close the dialog';
  if (result.files === 0) return 'no transcript file found for the open session';
  if (!result.reads.some((read) => Number(read) > 0)) return `the reader returned no messages for a session that shows some (${result.reads.join(', ')})`;
  if (result.findings.length === 0) return 'no findings';
  return `ok: ${result.files} transcript file${result.files === 1 ? '' : 's'}, reader returned ${result.reads.join('/')} messages, findings: ${result.findings.join(', ')}; Escape closed it`;
}

/**
 * Read-only: the header's git button shows a step, its menu has the branch and where it stands, then
 * Pull, Fetch, Commit…, Ask Claude to commit, Push, Create PR (each enabled or not as git's state
 * says) and the branch items, and Escape closes it. Runs nothing.
 */
async function runGitStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const button = "document.querySelector('[data-current-session] [data-git-button]')";
  if (!(await waitInPage(win, button, 3_000))) {
    return (await js("!!document.querySelector('[data-current-session] [data-toggle-changes]')")) ? 'no git button on a git checkout' : 'ok: skipped (session is not on a git checkout)';
  }
  const face = (await js(`${button}.dataset.gitButton`)) as string;
  await js("document.querySelector('[data-current-session] [data-git-menu]').click()");
  const menu = "document.querySelector('[role=\"menu\"][aria-label=\"Git\"]')";
  if (!(await waitInPage(win, `${menu}?.querySelector('[role=\"menuitem\"]')`, 2_000))) return 'menu did not open';
  const items = (await js(`[...${menu}.querySelectorAll('[role="menuitem"][data-git-step]')].map((i) => (i.disabled ? '-' : '+') + i.dataset.gitStep)`)) as string[];
  const summary = (await js(`${menu}.querySelector('[data-menu-title]')?.innerText.replace(/\\s+/g, ' ') ?? ''`)) as string;
  await shot(win, 'git-menu.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  // Create PR…, or View PR #N once the branch has an open pull request.
  const steps = items.map((i) => i.slice(1)).map((step) => (step === 'view-pr' ? 'pr' : step)).filter((step) => step !== 'pr-ready');
  const expected = ['pull', 'fetch', 'commit-dialog', 'commit', 'push', 'pr'];
  if (steps.slice(0, expected.length).join(',') !== expected.join(',')) return `unexpected items: ${steps.join(', ')}`;
  if (!/behind|No remote|Not pushed/.test(summary)) return `no summary under the branch ("${summary}")`;
  if (!(await waitInPage(win, `!${menu}`, 2_000))) return 'Escape did not close the menu';
  return `ok: shows ${face}, "${summary}", menu ${items.join(' ')}, Escape closed it`;
}

/**
 * The Create pull request dialog, read-only on the open session's real checkout: Create PR… in the git menu opens it
 * with the title filled in and selected, the base branch, the counter and the push line. The base menu filters, the
 * description switches to Empty, a description over GitHub's limit turns the counter red, disables Create and offers
 * Use commit titles only; switching the source after an edit asks first; Escape closes it. Create is never pressed,
 * and on macOS gh is the smoke test's fake (SWITCHBOARD_GH), so nothing reaches GitHub either way.
 */
async function runPullRequestStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const key = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const dialog = "document.querySelector('[data-pr-dialog]')";
  const inDialog = (selector: string) => `${dialog}?.querySelector(${JSON.stringify(selector)})`;
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-git-button]')", 3_000))) return 'ok: skipped (session is not on a git checkout)';
  await js("document.querySelector('[data-current-session] [data-git-menu]').click()");
  const menu = "document.querySelector('[role=\"menu\"][aria-label=\"Git\"]')";
  if (!(await waitInPage(win, `${menu}?.querySelector('[data-git-step]')`, 2_000))) return 'the git menu did not open';
  const item = `${menu}.querySelector('[data-git-step="pr"]')`;
  if (await js(`!${item}`)) {
    key('Escape');
    return (await js(`!!${menu}?.querySelector('[data-git-step="view-pr"]')`)) ? 'ok: skipped (the branch has an open pull request: View PR)' : 'no Create PR… in the git menu';
  }
  if (await js(`${item}.disabled`)) {
    key('Escape');
    return 'ok: skipped (Create PR… is unavailable on this branch)';
  }
  await js(`${item}.click()`);
  if (!(await waitInPage(win, `${inDialog('[data-pr-title]')} || ${inDialog('[data-pr-load-error]')}`, 15_000))) return 'the dialog did not open, or never read the branch';
  if (await js(`!!${inDialog('[data-pr-load-error]')}`)) {
    const reason = (await js(`${inDialog('[data-pr-load-error]')}.innerText`)) as string;
    key('Escape');
    return `ok: skipped (${reason})`;
  }
  try {
    const title = (await js(`${inDialog('[data-pr-title]')}.value`)) as string;
    if (!title.trim()) return 'the title was not filled in';
    if (!(await waitInPage(win, `document.activeElement?.matches('[data-pr-title]') && document.activeElement.selectionEnd - document.activeElement.selectionStart === ${title.length}`, 2_000))) return 'the title was not focused with its text selected';
    const base = (await js(`${inDialog('[data-pr-base]')}.dataset.prBase`)) as string;
    if (!base) return 'no base branch';
    if (!/^[\d,]+ \/ 65,536$/.test((await js(`${inDialog('[data-pr-counter]')}.innerText`)) as string)) return 'the counter is wrong';
    if ((await js(`${inDialog('[data-pr-draft]')}.getAttribute('aria-checked')`)) !== 'false') return 'Draft was on when the dialog opened';
    const pushLine = (await js(`document.querySelector('[data-pr-push-line]')?.innerText ?? ''`)) as string;
    if (!/^(Pushes \d+ commits? to |Publishes |Already pushed)/.test(pushLine)) return `no push line in the footer ("${pushLine}")`;
    const notice = (await js(`${inDialog('[data-pr-notice]')}?.dataset.prNotice ?? null`)) as string | null;
    await shot(win, 'pr-dialog.png');

    // The base menu: a filter that matches nothing, then Escape closes only the menu.
    await js(`${inDialog('[data-pr-base]')}.click()`);
    if (!(await waitInPage(win, "document.activeElement?.matches('[data-menu=\"pr-base\"] [data-pr-base-filter]')", 2_000))) return 'the base menu did not open with its filter focused';
    await setFieldValue(win, '[data-pr-base-filter]', 'no-such-branch-from-the-smoke-test');
    if (!(await waitInPage(win, "!document.querySelector('[data-menu=\"pr-base\"] [data-pr-base-option]') && document.querySelector('[data-menu=\"pr-base\"]').innerText.includes('No matching branch')", 2_000))) return 'the base filter did not filter';
    key('Escape');
    if (!(await waitInPage(win, `!document.querySelector('[data-menu="pr-base"]') && !!${dialog}`, 2_000))) return 'Escape in the base menu closed the dialog too, or not the menu';

    // Description from: Empty applies at once while nothing was typed.
    await js(`${inDialog('[data-pr-source]')}.click()`);
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-pr-source-option=\"empty\"]') && document.querySelector('[role=menu] [data-pr-source-option=\"commits\"]')", 2_000))) return 'the Description from menu has no Commit list and Empty';
    await js("document.querySelector('[role=menu] [data-pr-source-option=\"empty\"]').click()");
    if (!(await waitInPage(win, `${inDialog('[data-pr-body]')}.value === '' && ${inDialog('[data-pr-counter]')}.innerText === '0 / 65,536'`, 2_000))) return 'Empty did not empty the description';

    // Over the limit: red counter, Create disabled, and a way back to the commit titles.
    await setFieldValue(win, '[data-pr-body]', 'x'.repeat(65_540));
    if (!(await waitInPage(win, `${inDialog('[data-pr-over]')}?.innerText.startsWith('4 characters over') && ${dialog}.querySelector('[data-pr-submit]').disabled && !!${dialog}.querySelector('[data-pr-trim]')`, 2_000))) return 'a description over the limit did not show as too long, or Create stayed enabled';
    await js(`${dialog}.querySelector('[data-pr-trim]').click()`);
    if (!(await waitInPage(win, `!${inDialog('[data-pr-over]')} && ${inDialog('[data-pr-body]')}.value.length < 65_536`, 2_000))) return 'Use commit titles only did not fit the description';

    // Switching the source after an edit asks first; Escape there keeps the edit.
    await setFieldValue(win, '[data-pr-body]', 'Edited by the smoke test');
    await js(`${inDialog('[data-pr-source]')}.click()`);
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-pr-source-option=\"empty\"]')", 2_000))) return 'the Description from menu did not open again';
    await js("document.querySelector('[role=menu] [data-pr-source-option=\"empty\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-pr-replace]')", 2_000))) return 'switching the source after an edit did not ask first';
    key('Escape');
    if (!(await waitInPage(win, `!document.querySelector('[data-pr-replace]') && ${inDialog('[data-pr-body]')}?.value === 'Edited by the smoke test'`, 2_000))) return 'cancelling the question did not keep the edit';
    const submit = notice === 'GH_MISSING' || notice === 'PR_EXISTS' ? 'Create disabled' : (await js(`${dialog}.querySelector('[data-pr-submit]').disabled`)) ? 'Create disabled' : 'Create enabled (not pressed)';
    key('Escape');
    if (!(await waitInPage(win, `!${dialog}`, 2_000))) return 'Escape did not close the dialog';
    return `ok: "${title}" into ${base}, "${pushLine}"${notice ? `, notice ${notice}` : ''}, ${submit}; base filter, Empty, the limit, Use commit titles only and the question before replacing an edit work; Escape closed it`;
  } finally {
    if (await js(`!!${dialog}`)) {
      key('Escape');
      key('Escape');
    }
  }
}

/**
 * Read-only: file paths in Claude's replies that exist became links that open in the editor, with a
 * tooltip naming it. Not clicked: that would open the user's editor.
 */
async function runFileLinksStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // Paths are looked up a moment after they render.
  await waitInPage(win, "document.querySelector('[data-transcript] [data-file-link]')", 2_000);
  const links = (await js(
    "[...document.querySelectorAll('[data-transcript] [data-file-link]')].map((a) => ({ target: a.dataset.fileLink, href: a.getAttribute('href'), tooltip: a.dataset.tooltip }))",
  )) as Array<{ target: string; href: string; tooltip: string }>;
  if (links.length === 0) return 'ok: no file paths in the replies on screen';
  const bad = links.find((link) => !link.href.startsWith('file:///') || !isAbsolutePath(link.target) || !link.tooltip.startsWith(`Open ${link.target} in `));
  if (bad) return `a file link is wrong: ${JSON.stringify(bad)}`;
  return `ok: ${links.length} file links, e.g. "${links[0]!.tooltip}"`;
}

/** ⌘⇧F, type a word, open the first hit: the session opens with that message highlighted. */
/**
 * Find in the session (⌘F), read-only: searches for a word from one of Claude's replies, checks the
 * count and the drawn highlights, steps to the next match with Enter and closes with Escape.
 */
async function runFindStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const key = (keyCode: string, modifiers: Array<'meta' | 'shift'> = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: platformModifiers(modifiers) });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: platformModifiers(modifiers) });
  };
  // A word Claude wrote that's on screen now; only the reply's prose, not the row's screen-reader heading ("Claude").
  const word = (await js(
    "[...document.querySelectorAll('[data-item-kind=\"text\"] .markdown')].reverse().map((prose) => prose.innerText.match(/[A-Za-z]{6,}/)?.[0]).find(Boolean) ?? null",
  )) as string | null;
  if (!word) return 'ok: no reply from Claude on screen to search for';
  await js("document.querySelector('[data-transcript]').focus?.()");
  key('F', ['meta']);
  if (!(await waitInPage(win, "document.activeElement?.matches('[data-find-input]')", 3_000))) return '⌘F did not open the find bar';
  await setFieldValue(win, '[data-find-input]', word);
  if (!(await waitInPage(win, "/^\\d+ of \\d+$/.test(document.querySelector('[data-find-count]')?.innerText ?? '')", 3_000))) {
    return `no matches counted for "${word}" (${await js("document.querySelector('[data-find-count]')?.innerText")})`;
  }
  if (!(await waitInPage(win, "CSS.highlights.get('find')?.size > 0 && CSS.highlights.get('find-current')?.size === 1", 3_000))) return `"${word}" counted but not highlighted`;
  const first = (await js("document.querySelector('[data-find-count]').innerText")) as string;
  const [at, total] = first.split(' of ').map(Number) as [number, number];
  await shot(win, 'find.png');
  key('Return');
  // It starts at the first match on screen; Enter goes one further, wrapping round after the last.
  const expected = `${(at % total) + 1} of ${total}`;
  if (!(await waitInPage(win, `document.querySelector('[data-find-count]')?.innerText === ${JSON.stringify(expected)}`, 3_000))) {
    return `Enter went to "${await js("document.querySelector('[data-find-count]')?.innerText")}", expected "${expected}"`;
  }
  key('Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-find-bar]') && !CSS.highlights.get('find')?.size", 3_000))) return 'Escape did not close find and clear the highlights';
  return `ok: "${word}" found ${total}× (started at ${at}), highlighted, Enter stepped to the next, Escape closed it`;
}

/** A long prompt shows two lines, Show more opens it and Show less closes it again. Read-only. */
async function runLongPromptStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const row = "document.querySelector('[data-transcript-item]:has([data-prompt-toggle])')";
  const found = (await js(`(() => { const row = ${row}; if (!row) return null; row.dataset.smokeLongPrompt = '1'; return true; })()`)) as boolean | null;
  if (!found) return 'ok: no long prompt on screen';
  const target = "document.querySelector('[data-smoke-long-prompt]')";
  // A prompt that mounts open (Show less) is closed first, so the check starts from the cut.
  if (await js(`${target}.querySelector('[data-prompt-toggle]').getAttribute('aria-expanded') === 'true'`)) await js(`${target}.querySelector('[data-prompt-toggle]').click()`);
  if (!(await waitInPage(win, `!!${target}?.querySelector('[data-prompt-clamped]')`, 3_000))) return 'the long prompt is not cut';
  const lines = (await js(
    `(() => { const el = ${target}.querySelector('[data-prompt-clamped]'); return Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)); })()`,
  )) as number;
  if (lines !== 2) return `the cut prompt shows ${lines} lines, expected 2`;
  await js(`${target}.querySelector('[data-prompt-toggle]').click()`);
  if (!(await waitInPage(win, `!${target}?.querySelector('[data-prompt-clamped]') && ${target}?.querySelector('[data-prompt-toggle]')?.innerText.trim() === 'Show less'`, 3_000))) return 'Show more did not open the prompt';
  await js(`${target}.querySelector('[data-prompt-toggle]').click()`);
  if (!(await waitInPage(win, `!!${target}?.querySelector('[data-prompt-clamped]')`, 3_000))) return 'Show less did not cut the prompt again';
  await js(`delete ${target}.dataset.smokeLongPrompt`);
  return 'ok: a long prompt shows 2 lines, Show more opens it, Show less cuts it again';
}

/**
 * Every message has a Copy button (Markdown for Claude's replies), and the text of prompts, commands
 * and replies can be selected. Read-only: it doesn't click Copy, which would replace the clipboard.
 */
async function runCopyMessageStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const report = (await js(`(() => {
    const kinds = {};
    for (const row of document.querySelectorAll('[data-item-kind="user"], [data-item-kind="command"], [data-item-kind="text"]')) {
      const kind = row.dataset.itemKind;
      // Prompt text renders as Markdown; a command is plain text. An image-only prompt has nothing to copy.
      const text = row.querySelector('.markdown') ?? row.querySelector('.select-text');
      if (!text) continue;
      const entry = (kinds[kind] ??= { rows: 0, copy: 0, selectable: 0 });
      entry.rows++;
      if (row.querySelector('[data-message-actions] button[aria-label^="Copy"]')) entry.copy++;
      if (getComputedStyle(text).userSelect === 'text') entry.selectable++;
    }
    return kinds;
  })()`)) as Record<string, { rows: number; copy: number; selectable: number }>;
  const kinds = Object.entries(report);
  if (kinds.length === 0) return 'ok: no messages on screen';
  for (const [kind, { rows, copy, selectable }] of kinds) {
    if (copy !== rows) return `${rows - copy} of ${rows} ${kind} messages have no Copy button`;
    if (selectable !== rows) return `${rows - selectable} of ${rows} ${kind} messages can't be selected`;
  }
  const textCopy = (await js(`document.querySelector('[data-item-kind="text"] [data-message-actions] button[aria-label^="Copy"]')?.getAttribute('aria-label') ?? null`)) as string | null;
  if (report.text && textCopy !== 'Copy as Markdown') return `Claude's Copy button is labelled ${JSON.stringify(textCopy)}`;
  return `ok: Copy and selectable text on ${kinds.map(([kind, { rows }]) => `${rows} ${kind}`).join(', ')} messages`;
}

/**
 * The actions of Claude's replies sit in a row of their own under the text, so they never cover it;
 * the row is hidden until you hover or tab to it, and showing it doesn't change the reply's height.
 * Your prompt cards keep the toolbar floating over their top edge. Read-only: it focuses a button but
 * never clicks one.
 */
/**
 * Remember this, read-only: select a few words of one of Claude's replies, use the button that shows over the
 * selection, and check the dialog has the text, a suggested name and Claude's default type. Cancelled, never saved.
 */
async function runRememberStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await js("!!document.querySelector('[data-transcript] [data-remember-from=\"claude\"] p')"))) return 'ok: no reply of Claude on screen to remember';
  const selected = (await js(`(() => {
    const p = document.querySelector('[data-transcript] [data-remember-from="claude"] p');
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return selection.toString().trim();
  })()`)) as string;
  if (!selected) return 'ok: the first reply has no text to select';
  if (!(await waitInPage(win, "document.querySelector('[data-remember-selection] [data-remember-button]')", 3_000))) return 'no Remember this button over the selection';
  await js("document.querySelector('[data-remember-selection] [data-remember-button]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-remember-dialog] [data-remember-text]')", 3_000))) return 'Remember this did not open its dialog';
  const text = (await js("document.querySelector('[data-remember-dialog] [data-remember-text]').value")) as string;
  const name = (await js("document.querySelector('[data-remember-dialog] [data-remember-name]').value")) as string;
  const type = (await js("document.querySelector('[data-remember-dialog] [data-remember-type][aria-checked=\"true\"]')?.dataset.rememberType ?? ''")) as string;
  await shot(win, 'remember-this.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-remember-dialog]')", 2_000))) return 'Escape did not close Remember this';
  await js('window.getSelection().removeAllRanges()');
  if (text.trim() !== selected) return `the dialog's text is not the selection ("${text.slice(0, 40)}")`;
  if (!name) return 'no suggested name';
  if (type !== 'project') return `Claude's text started as type "${type}", not project`;
  return `ok: selected ${selected.length} characters, the dialog suggested "${name}" (project), cancelled`;
}

/**
 * The toolbar over a selection, read-only: select one of Claude's replies and check the toolbar shows solid, without
 * covering the selection; Tab reaches it and → moves to Copy, which says Copied (the clipboard is stubbed for the
 * step, so yours is left alone); Esc closes it and keeps the selection; Quote puts the selection in the message box
 * as a Markdown quote with the focus there. Nothing is sent; the box is emptied again.
 */
async function runSelectionToolbarStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const key = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const view = `[data-current-session="${smokeSessionId}"]`;
  const box = `${view} [data-composer]`;
  const toolbar = "document.querySelector('[data-remember-selection][data-side]')";
  if (!(await js(`!!document.querySelector('${view} [data-transcript] [data-remember-from="claude"] p')`))) return 'ok: no reply of Claude on screen to select';
  if ((await js(`document.querySelector('${box}')?.value ?? null`)) !== '') return 'ok: the message box is not empty, nothing quoted';
  // A paragraph on screen (the list is virtualised, and its first rows may be scrolled out of view).
  const select = `(() => {
    const area = document.querySelector('${view} [data-transcript]').getBoundingClientRect();
    const shown = [...document.querySelectorAll('${view} [data-transcript] [data-remember-from="claude"] p')].filter((p) => { const r = p.getBoundingClientRect(); return r.height > 0 && r.top >= area.top + 60 && r.bottom <= area.bottom; });
    const p = shown[shown.length - 1];
    if (!p) return '';
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return selection.toString().trim();
  })()`;
  const selected = (await js(select)) as string;
  if (!selected) return 'ok: no paragraph of Claude on screen to select';
  const done = async (result: string) => {
    await js("window.getSelection().removeAllRanges(); if (window.__smokeWriteText) { navigator.clipboard.writeText = window.__smokeWriteText; delete window.__smokeWriteText; } true");
    return result;
  };
  if (!(await waitInPage(win, toolbar, 3_000))) return done('no toolbar over the selection');
  const look = (await js(`(() => {
    const bar = ${toolbar}.getBoundingClientRect();
    const lines = [...window.getSelection().getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0 && r.height < 40);
    const covers = lines.some((r) => r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top);
    const style = getComputedStyle(${toolbar});
    return { covers, solid: !style.backgroundColor.includes('/') && !/rgba\(.*, 0(\.\d+)?\)$/.test(style.backgroundColor), labels: [...${toolbar}.querySelectorAll('button')].map((b) => b.textContent.trim()), role: ${toolbar}.getAttribute('role') };
  })()`)) as { covers: boolean; solid: boolean; labels: string[]; role: string | null };
  await shot(win, 'selection-toolbar.png');
  if (look.covers) return done('the toolbar covers the selection');
  if (!look.solid) return done('the toolbar is see-through');
  if (look.role !== 'toolbar' || look.labels.join(',') !== 'Quote,CopyCopied,Remember this…') return done(`the toolbar holds ${JSON.stringify(look.labels)}`);

  // Keyboard: Tab from the transcript into the toolbar, → to Copy, then Copy.
  await js("window.__smokeWriteText = navigator.clipboard.writeText.bind(navigator.clipboard); window.__smokeCopied = null; navigator.clipboard.writeText = async (text) => { window.__smokeCopied = text; }; true");
  key('Tab');
  if (!(await waitInPage(win, "document.activeElement?.hasAttribute('data-quote-selection')", 2_000))) return done('Tab did not move into the toolbar');
  key('Right');
  if (!(await waitInPage(win, "document.activeElement?.hasAttribute('data-copy-selection')", 2_000))) return done('→ did not move to Copy');
  await js('document.activeElement.click()');
  if (!(await waitInPage(win, "document.querySelector('[data-copy-selection][data-copied]')?.textContent.includes('Copied')", 2_000))) return done('Copy did not say Copied');
  const copied = (await js('window.__smokeCopied')) as string | null;
  if (copied !== selected) return done(`Copy wrote ${JSON.stringify(copied?.slice(0, 40))}, not the selection`);
  if (!(await js(`!!${toolbar}`))) return done('the toolbar closed after Copy');

  // Esc closes it and keeps the selection.
  key('Escape');
  if (!(await waitInPage(win, `!${toolbar}`, 2_000))) return done('Esc did not close the toolbar');
  if (((await js('window.getSelection().toString().trim()')) as string) !== selected) return done('Esc lost the selection');

  // Quote.
  await js(select);
  if (!(await waitInPage(win, toolbar, 3_000))) return done('no toolbar after selecting again');
  await js(`${toolbar}.querySelector('[data-quote-selection]').click()`);
  const quoted = await waitInPage(win, `document.querySelector('${box}').value !== ''`, 3_000);
  const value = (await js(`document.querySelector('${box}').value`)) as string;
  const focused = (await js(`document.activeElement === document.querySelector('${box}')`)) as boolean;
  await setFieldValue(win, box, '');
  if (!quoted) return done('Quote did not put anything in the message box');
  const firstLine = selected.split('\n')[0]!.trim();
  if (!value.startsWith(`> ${firstLine}`) || !value.endsWith('\n\n')) return done(`the message box does not hold the quote ("${value.slice(0, 40)}")`);
  if (!focused) return done('the message box did not take focus after Quote');
  return done(`ok: solid toolbar clear of the selection; Tab, → and Copy said Copied; Esc kept the selection; Quote put ${value.trimEnd().split('\n').length} quote lines in the message box (emptied again)`);
}

async function runReplyActionsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const replies = `[...document.querySelectorAll('[data-item-kind="text"]')].filter((row) => row.querySelector('.markdown') && row.querySelector('[data-message-actions]'))`;
  const layout = (await js(`(() => {
    const rows = ${replies};
    const covered = rows.filter((row) => row.querySelector('[data-message-actions]').getBoundingClientRect().top < row.querySelector('.markdown').getBoundingClientRect().bottom - 1).length;
    const floating = rows.filter((row) => getComputedStyle(row.querySelector('[data-message-actions]')).position === 'absolute').length;
    const prompt = document.querySelector('[data-item-kind="user"] [data-message-actions]');
    return { rows: rows.length, covered, floating, promptPosition: prompt ? getComputedStyle(prompt).position : null };
  })()`)) as { rows: number; covered: number; floating: number; promptPosition: string | null };
  if (layout.rows === 0) return 'ok: no replies from Claude on screen';
  if (layout.covered > 0) return `the actions overlap the text of ${layout.covered} of ${layout.rows} replies`;
  if (layout.floating > 0) return `the actions float over ${layout.floating} of ${layout.rows} replies instead of taking a row`;
  if (layout.promptPosition && layout.promptPosition !== 'absolute') return `your prompt's actions are ${layout.promptPosition}, not floating over the card`;

  // Tab to Copy on the first reply in view: the row shows, and the reply keeps its height.
  const target = `(${replies}.find((row) => { const r = row.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }) ?? ${replies}[0])`;
  await js(`${target}.dataset.smokeReplyActions = '1'`);
  const row = "document.querySelector('[data-smoke-reply-actions]')";
  const bar = `${row}.querySelector('[data-message-actions]')`;
  try {
    const before = (await js(`({ height: ${row}.getBoundingClientRect().height, opacity: getComputedStyle(${bar}).opacity })`)) as { height: number; opacity: string };
    if (before.opacity !== '0') return `the actions of a reply show (opacity ${before.opacity}) without hover or focus`;
    await js(`${bar}.querySelector('button[aria-label^="Copy"]').focus()`);
    if (!(await waitInPage(win, `getComputedStyle(${bar}).opacity === '1'`, 2_000))) return 'tabbing to Copy did not show the actions of the reply';
    const height = (await js(`${row}.getBoundingClientRect().height`)) as number;
    if (Math.abs(height - before.height) > 0.5) return `showing the actions changed the reply's height from ${before.height}px to ${height}px`;
    await shot(win, 'reply-actions.png');
    return `ok: actions under the text of ${layout.rows} replies, hidden until focus, no jump${layout.promptPosition ? '; prompt cards keep the floating toolbar' : ''}`;
  } finally {
    await js(`(document.activeElement instanceof HTMLElement && document.activeElement.blur(), delete ${row}?.dataset.smokeReplyActions)`);
  }
}

/**
 * Shell code blocks in the conversation have a Run button and other blocks don't. Read-only: Run is
 * never clicked, since it would run the command in a real project.
 */
async function runCodeRunStep(win: BrowserWindow): Promise<string> {
  const report = (await win.webContents.executeJavaScript(`(() => {
    const shell = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'shellsession', 'terminal']);
    const counts = { shell: 0, shellRun: 0, other: 0, otherRun: 0 };
    for (const block of document.querySelectorAll('[data-current-session="${smokeSessionId}"] [data-transcript] .code-block')) {
      const run = block.querySelector('[data-code-run]');
      if (shell.has((block.dataset.codeLanguage ?? '').toLowerCase())) {
        counts.shell++;
        if (run?.getAttribute('aria-label') === 'Run in terminal') counts.shellRun++;
      } else {
        counts.other++;
        if (run) counts.otherRun++;
      }
    }
    return counts;
  })()`)) as { shell: number; shellRun: number; other: number; otherRun: number };
  if (report.otherRun > 0) return `failed: ${report.otherRun} of ${report.other} non-shell code blocks have a Run button`;
  if (report.shellRun < report.shell) return `failed: ${report.shell - report.shellRun} of ${report.shell} shell code blocks have no Run button`;
  if (report.shell + report.other === 0) return 'ok: no code blocks on screen';
  return `ok: Run on ${report.shell} shell blocks, none on ${report.other} other blocks`;
}

/**
 * An unsent message, and the image pasted with it, survive opening another session and coming back.
 * Read-only: nothing is sent, and the box is emptied again at the end.
 */
async function runDraftStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const draft = 'Smoke draft, not sent';
  const composer = `document.querySelector('[data-current-session="${smokeSessionId}"] [data-composer]')`;
  const thumbs = `document.querySelector('[data-current-session="${smokeSessionId}"] [data-attachments]')`;
  if (!(await waitInPage(win, `!!${composer}`, 3_000))) return 'no message box in the session under test';
  await setFieldValue(win, `[data-current-session="${smokeSessionId}"] [data-composer]`, draft);
  await js(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'smoke.png', { type: 'image/png' }));
    ${composer}.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  if (!(await waitInPage(win, `!!${thumbs}?.querySelector('img')`, 2_000))) return (await setFieldValue(win, `[data-current-session="${smokeSessionId}"] [data-composer]`, ''), 'pasting an image in the message box did not attach it');
  // Last first, so each click still names the image it removes (React drops them after the loop).
  const removeImages = async () => {
    await js(`[...(${thumbs}?.querySelectorAll('button') ?? [])].reverse().forEach((b) => b.click())`);
    await waitInPage(win, `!${thumbs}`, 2_000);
  };
  const other = (await js(
    `(() => { const row = [...document.querySelectorAll('[data-session-id]')].find((row) => row.dataset.sessionId !== '${smokeSessionId}'); row?.click(); return row?.dataset.sessionId ?? null; })()`,
  )) as string | null;
  if (!other) {
    await removeImages();
    await setFieldValue(win, `[data-current-session="${smokeSessionId}"] [data-composer]`, '');
    return 'ok: only one session, nothing to switch to';
  }
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${other}"] [data-composer]')?.value === ''`, 5_000))) return 'the other session did not open with an empty message box';
  if (await js(`!!document.querySelector('[data-current-session="${other}"] [data-attachments]')`)) return 'the other session opened with the pasted image';
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]').click()`);
  if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(draft)}`, 5_000))) return `the draft was not kept (${JSON.stringify(await js(`${composer}?.value ?? null`))})`;
  const kept = (await js(`${thumbs}?.querySelectorAll('img').length ?? 0`)) as number;
  await removeImages();
  await setFieldValue(win, `[data-current-session="${smokeSessionId}"] [data-composer]`, '');
  if (kept !== 1) return `the pasted image was not kept with the draft (${kept} images)`;
  await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000);
  return 'ok: the unsent message and its image were still there after opening another session and coming back';
}

/**
 * Unsent messages, without sending anything: text left in the session's box shows as a pen and a "Draft:" line on its
 * row and "1 unsent" in the footer; the Unsent list jumps back to it with the text there and the caret at its end;
 * Discard takes the pen and the chip away. New session's part is `runUnsentNewSessionStep`, which needs a project.
 */
async function runUnsentStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!smokeSessionId) return 'ok: no session to type in';
  const id = smokeSessionId;
  const text = 'Smoke unsent message, never sent';
  const box = `[data-current-session="${id}"] [data-composer]`;
  const row = `document.querySelector('[data-session-id="${id}"]')`;
  const count = "Number(document.querySelector('[data-drafts-count]')?.dataset.draftsCount ?? 0)";
  const clear = () => setFieldValue(win, box, '');
  await js(`${row}?.click()`);
  if (!(await waitInPage(win, `!!document.querySelector(${JSON.stringify(box)})`, 5_000))) return 'no message box in the session under test';
  if (!(await js("!!document.querySelector('[data-sidebar-open]')"))) return 'the sidebar is not open';
  const before = (await js(count)) as number;

  // Typed, left alone for a moment, then another session opened.
  await setFieldValue(win, box, text);
  const other = (await js(
    `(() => { const r = [...document.querySelectorAll('[data-session-id]')].find((r) => r.dataset.sessionId !== '${id}'); r?.click(); return r?.dataset.sessionId ?? null; })()`,
  )) as string | null;
  if (!other) return (await clear(), 'ok: only one session, nothing to switch to');
  if (!(await waitInPage(win, `${row}?.hasAttribute('data-has-draft') && !!${row}?.querySelector('[data-row-pen]')`, 6_000))) return (await js(`${row}?.click()`), await clear(), 'the row did not show the pen');
  const busy = (await js(`/Waiting for you|Claude is working/.test(${row}.getAttribute('aria-label'))`)) as boolean;
  const compact = (await js(`!${row}.querySelector('[data-row-draft]') && ${row}.offsetHeight < 40`)) as boolean;
  if (!busy && !compact && !(await js(`${row}.querySelector('[data-row-draft]')?.innerText.startsWith('Draft: Smoke unsent')`))) return (await js(`${row}?.click()`), await clear(), 'the row did not show the "Draft:" line');
  if (!(await js(`${row}.getAttribute('aria-label').includes('unsent message')`))) return (await js(`${row}?.click()`), await clear(), 'the row does not say "unsent message"');
  if (!(await waitInPage(win, `${count} === ${before + 1} && document.querySelector('[data-drafts-count]').innerText.includes('${before + 1} unsent')`, 2_000))) return (await js(`${row}?.click()`), await clear(), `the footer did not say ${before + 1} unsent`);
  await shot(win, 'unsent-row.png');

  // The list jumps back with the text in the box, the caret at its end, and the kept-for-you line.
  await js("document.querySelector('[data-drafts-count]').click()");
  if (!(await waitInPage(win, `!!document.querySelector('[data-unsent-list] [data-unsent-item="${id}"]')`, 2_000))) return (await js(`${row}?.click()`), await clear(), 'the chip did not open the Unsent list with the draft');
  await shot(win, 'unsent-list.png');
  await js(`document.querySelector('[data-unsent-list] [data-unsent-item="${id}"]').click()`);
  const back = `document.querySelector(${JSON.stringify(box)})`;
  if (!(await waitInPage(win, `!document.querySelector('[data-unsent-list]') && ${back}?.value === ${JSON.stringify(text)} && document.activeElement === ${back} && ${back}.selectionStart === ${text.length}`, 5_000))) {
    return (await clear(), `the list did not open the draft with the caret at the end (${JSON.stringify(await js(`${back}?.value ?? null`))})`);
  }
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${id}"] [data-draft-banner]')?.innerText.includes('kept for you')`, 2_000))) return (await clear(), 'no "kept for you" line above the box');

  // Discard: the box empties, the pen and the chip go.
  await js(`document.querySelector('[data-current-session="${id}"] [data-draft-discard]').click()`);
  if (!(await waitInPage(win, `${back}?.value === '' && !document.querySelector('[data-current-session="${id}"] [data-draft-banner]') && !${row}?.hasAttribute('data-has-draft') && ${count} === ${before}`, 3_000))) {
    return (await clear(), 'Discard left the text, the pen or the chip');
  }

  await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000);
  return 'ok: pen, Draft line and "1 unsent" for a left message; the list jumped back with the caret at the end; Discard cleared the text, the pen and the chip';
}

/**
 * A prompt left in New session puts a pen on the + button, whose tooltip names the project; clicking it opens New
 * session on that prompt with the kept-for-you line, and Discard there takes the pen away. Starts nothing; needs a
 * project (run while the projects step has one added), and ends on New session as it found it.
 */
async function runUnsentNewSessionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!smokeSessionId) return 'ok: no session to leave New session for';
  const row = `document.querySelector('[data-session-id="${smokeSessionId}"]')`;
  const text = 'Smoke unsent prompt, never started';
  const prompt = "document.querySelector('[data-new-session-view] [data-composer]')";
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
  if (!(await waitInPage(win, `!!document.querySelector('[data-folder-select]')?.dataset.value && ${prompt} && !${prompt}.disabled`, 5_000))) return 'New session has no folder to write a prompt for';
  const folder = (await js("document.querySelector('[data-folder-select]').dataset.value")) as string;
  await setFieldValue(win, '[data-new-session-view] [data-composer]', text);
  await js(`${row}?.click()`);
  const discard = async () => {
    await js("document.querySelector('[data-new-session]').click()");
    await waitInPage(win, `${prompt}?.value === ${JSON.stringify(text)}`, 3_000);
    await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
  };
  if (!(await waitInPage(win, `document.querySelector('[data-new-session-draft]')?.dataset.newSessionDraft === ${JSON.stringify(folder)} && document.querySelector('[data-new-session]').getAttribute('aria-label').startsWith('New session · unsent prompt in')`, 6_000))) {
    return (await discard(), 'the + button did not get a pen for the New session prompt');
  }
  await shot(win, 'unsent-new-session.png');
  // Clicking it opens New session on the prompt, with the line that says whose it is; Discard there clears it.
  await js("document.querySelector('[data-new-session]').click()");
  if (!(await waitInPage(win, `${prompt}?.value === ${JSON.stringify(text)} && document.querySelector('[data-new-session-view] [data-draft-banner]')?.innerText.includes('Your unsent prompt for')`, 5_000))) {
    return (await setFieldValue(win, '[data-new-session-view] [data-composer]', ''), 'the + button did not open New session on the kept prompt');
  }
  await js("document.querySelector('[data-new-session-view] [data-draft-discard]').click()");
  if (!(await waitInPage(win, `${prompt}?.value === '' && !document.querySelector('[data-new-session-draft]') && !document.querySelector('[data-draft-banner]')`, 3_000))) return 'Discard in New session left the prompt or the pen';
  return 'ok: a prompt left in New session put a pen on the + button, which opened it with "Your unsent prompt for…"; Discard cleared it';
}

/**
 * Worktree name, read-only: with the worktree switch on, New session offers a made-up three-word name
 * (`brave-humming-otter`) that stays put while you type a prompt. Nothing is started; the switch and
 * the prompt are put back as they were.
 */
async function runWorktreeNameStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const prompt = '[data-new-session-view] [data-composer]';
  const toggle = "document.querySelector('[data-worktree-switch]')";
  const nameField = "document.querySelector('[data-worktree-name]')";
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
  if (!(await waitInPage(win, `!!document.querySelector('[data-folder-select]')?.dataset.value && ${toggle}`, 5_000))) return 'New session has no folder with a worktree switch';
  // The switch waits for the folder's git check; a folder that isn't a repository has no worktree to name.
  if (!(await waitInPage(win, `!${toggle}.disabled`, 5_000))) return 'ok: the folder is not a git repository, no worktree to name';
  const wasOn = (await js(`${toggle}.getAttribute('aria-checked') === 'true'`)) as boolean;
  const putBack = async () => {
    if (await js("!!document.querySelector('[data-menu=\"workspace\"]')")) {
      pressKey(win, 'Escape');
      await waitInPage(win, "!document.querySelector('[data-menu=\"workspace\"]')", 2_000);
    }
    await setFieldValue(win, prompt, '');
    if (!wasOn && (await js(`${toggle}.getAttribute('aria-checked') === 'true'`))) await click('[data-worktree-switch]');
    await waitInPage(win, `${toggle}.getAttribute('aria-checked') === ${JSON.stringify(String(wasOn))}`, 2_000);
  };
  const suggested = async () => {
    await click('[data-workspace-select]');
    if (!(await waitInPage(win, nameField, 3_000))) return null;
    const name = (await js(`${nameField}.placeholder`)) as string;
    pressKey(win, 'Escape');
    await waitInPage(win, "!document.querySelector('[data-menu=\"workspace\"]')", 2_000);
    return name;
  };
  if (!wasOn) await click('[data-worktree-switch]');
  if (!(await waitInPage(win, `${toggle}.getAttribute('aria-checked') === 'true'`, 2_000))) return (await putBack(), 'the worktree switch did not turn on');
  const first = await suggested();
  if (!first) return (await putBack(), 'the Where menu has no worktree name field');
  if (!/^[a-z]+-[a-z]+-[a-z]+$/.test(first) || first.length > 30) return (await putBack(), `the suggested name is not three short words: "${first}"`);
  const hint = (await js("document.querySelector('[data-workspace-select]').dataset.tooltip ?? ''")) as string;
  if (!hint.includes(`.claude/worktrees/${first}`)) return (await putBack(), `the Where tooltip names another folder: "${hint}"`);
  // The name doesn't come from the prompt any more, so typing one leaves it as it was.
  await setFieldValue(win, prompt, 'Fix the login redirect after the OAuth callback');
  await settle(win);
  const second = await suggested();
  if (second !== first) return (await putBack(), `the suggested name changed while typing: "${first}" became "${second}"`);
  await shot(win, 'new-session-worktree-name.png');
  await putBack();
  return `ok: suggested worktree-${first}, unchanged by the prompt`;
}

async function runSearchStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  pressKey(win, 'F', ['meta', 'shift']);
  if (!(await waitInPage(win, "document.querySelector('[data-search] input')", 3_000))) return '⌘⇧F did not open search';
  await setFieldValue(win, '[data-search] input', 'session');
  // The index is built in the background from a fresh profile; hits fill in as it goes.
  if (!(await waitInPage(win, "!document.querySelector('[data-search]') || document.querySelector('[data-search-hit]')", 20_000))) {
    const footer = await js("document.querySelector('[data-search]')?.innerText.slice(-80) ?? ''");
    pressKey(win, 'Escape');
    return `no hits after 20 s (${JSON.stringify(footer)})`;
  }
  if (!(await js("!!document.querySelector('[data-search]')"))) {
    const state = await js("JSON.stringify({ focus: document.activeElement?.outerHTML.slice(0, 80) ?? null, dialogs: [...document.querySelectorAll('[role=dialog], [role=alertdialog], [role=menu]')].map((el) => el.getAttribute('aria-label')) })");
    return `the search dialog closed by itself before any hits (window focused: ${win.isFocused()}, ${state})`;
  }
  const groups = (await js("document.querySelectorAll('[data-search-group]').length")) as number;
  const indexing = (await js("document.querySelector('[data-search]').innerText.match(/Indexing \\d+ of \\d+/)?.[0] ?? 'index complete'")) as string;
  await shot(win, 'search.png');
  await js("document.querySelector('[data-search-hit]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-search]') && document.querySelector('.search-highlight')", 8_000))) return `${groups} sessions matched, but opening the hit did not highlight it`;
  await shot(win, 'search-opened.png');
  // Back to the session under test: the steps after this one work in its folder.
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]').click()`);
  await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000);
  return `ok: ${groups} sessions matched (${indexing}); opened and highlighted the first`;
}

/**
 * The new session view, read-only: project header, model menu (Escape closes it), effort dial with
 * reset, permission menu and the route tray. Nothing is submitted; the session under test is reopened after.
 */
/**
 * New session's git button, next to Open in editor for a checkout with a remote: its face step (`fetch`
 * or `pull`), or `none` without one. Only its menu is opened: fetching or pulling would change the real repository.
 */
async function checkCatchUpMenu(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await waitInPage(win, "!!document.querySelector('[data-open-in]')", 3_000)) || !(await waitInPage(win, "!!document.querySelector('[data-catch-up]')", 2_000))) return 'none';
  const face = (await js("document.querySelector('[data-catch-up]').dataset.catchUp")) as string;
  await js("document.querySelector('[data-catch-up-menu]').click()");
  if (!(await waitInPage(win, "!!document.querySelector('[data-catch-up-step=\"fetch\"]') && !!document.querySelector('[data-catch-up-step=\"pull\"]')", 2_000))) return 'failed: the git menu in New session has no Fetch and Pull';
  await shot(win, 'new-session-git-menu.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-catch-up-step]')", 2_000))) return 'failed: Escape did not close the git menu in New session';
  return face;
}

async function runNewSessionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const escape = () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  };
  const newSession = () => win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
  const promptFocused = "document.activeElement?.matches('[data-composer]')";
  newSession();
  if (!(await waitInPage(win, "document.querySelector('[data-project-header]') && document.querySelector('[data-route-tray]')", 3_000))) return 'the new session view did not open';
  // Projects are added by hand: the throwaway profile has none yet, so there may be no folder to preselect.
  if (!(await waitInPage(win, "document.querySelector('[data-folder-select]').dataset.value || document.querySelector('[data-sidebar-onboarding]')", 5_000))) return 'no folder chosen by default';
  // Without a folder the prompt is disabled, so there is nothing to focus.
  const hasFolder = (await js("!!document.querySelector('[data-folder-select]').dataset.value")) as boolean;
  if (hasFolder && !(await waitInPage(win, promptFocused, 3_000))) return '⌘N did not focus the prompt';
  const catchUp = hasFolder ? await checkCatchUpMenu(win) : 'none';
  if (catchUp.startsWith('failed')) return catchUp;
  await click('[data-model-select]');
  if (!(await waitInPage(win, "document.activeElement?.closest('[data-menu=\"model\"]')", 2_000))) return 'the model menu did not open with focus';
  escape();
  if (!(await waitInPage(win, "!document.querySelector('[data-menu=\"model\"]') && document.activeElement?.matches('[data-model-select]')", 2_000))) return 'Escape did not close the model menu';
  // The effort chip sits in the same row as the model and permission chips.
  const effortBefore = (await js("document.querySelector('[data-new-session-view] [data-effort-select]')?.dataset.value ?? ''")) as string;
  const pick = effortBefore === 'high' ? 'max' : 'high';
  if (!(await chooseChoice(win, 'effort', pick, '[data-new-session-view]'))) return 'picking an effort did not stick';
  const sameRow = (await js(
    "(() => { const row = (s) => document.querySelector('[data-new-session-view] ' + s)?.getBoundingClientRect(); const m = row('[data-model-select]'), e = row('[data-effort-select]'), send = row('[data-composer-submit]'); return !!(m && e && send) && Math.abs(m.top - e.top) < 4 && Math.abs(m.top + m.height / 2 - (send.top + send.height / 2)) < 6; })()",
  )) as boolean;
  if (!sameRow) return 'the chips and Start session are not on one row';
  // The chips shrink by dropping parts, never by cutting words: no chip is narrower than its content.
  const clipped = (await js(
    "[...document.querySelectorAll('[data-new-session-view] [data-composer-chips] [aria-haspopup=menu]')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.getAttribute('aria-label'))",
  )) as string[];
  if (clipped.length) return `chips cut off: ${clipped.join(', ')}`;
  await click('[data-mode-select]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-menu=\"mode\"] [role=menuitemradio]').length >= 4", 2_000))) return 'the permission menu did not open';
  await shot(win, 'new-session-view.png');
  escape();
  // A click while the menu is still closing can land on its way out, and the effort menu never opens.
  if (!(await waitInPage(win, "!document.querySelector('[data-menu=\"mode\"]')", 2_000))) return 'Escape did not close the permission menu';
  // Put back the effort it had (the default, usually), so the remembered defaults are as they were.
  if (!(await chooseChoice(win, 'effort', effortBefore, '[data-new-session-view]'))) return 'could not put the effort back';
  // ⌘N while already on New session puts the cursor back in the prompt.
  await js("document.querySelector('[data-model-select]').focus()");
  newSession();
  if (hasFolder && !(await waitInPage(win, promptFocused, 2_000))) return '⌘N on an open New session did not focus the prompt';
  const hint = (await js("document.querySelector('[data-route-tray]').innerText.replace(/\\s+/g, ' ')")) as string;
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000);
  return `ok: ${hint}; git: ${catchUp}`;
}

/**
 * Quick question, read-only: ⌘⇧N opens New session with Quick question picked, which hides every git option
 * (where, branch, worktree, Add to projects) and keeps the model, effort and mode chips, in a mode that asks.
 * The palette's Quick question… shows the same in its prompt step. Nothing is typed or sent. A project picks
 * again from there, and ⌘N later never opens on Quick question (it isn't remembered as New session's folder).
 * Ends where it started: the same session, or New session as it was (with the prompt it had, which is moved out
 * of the way first, or it would come along to Quick question as it does to another project).
 */
async function runQuickQuestionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const optionFor = (folder: string) => `document.querySelector('[data-folder-option=${JSON.stringify(JSON.stringify(folder)).slice(1, -1)}]')`;
  // The session open now, to come back to (its row may be in a closed sidebar section): a session link opens it.
  const session = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  const leaveNewSession = async () => {
    if (session) openDeepLink(`switchboard://session/${session}`);
    else pressKey(win, 'H', ['meta', 'shift']);
    return waitInPage(win, session ? `document.querySelector('[data-current-session=${JSON.stringify(JSON.stringify(session)).slice(1, -1)}]')` : "!document.querySelector('[data-new-session-view]')", 3_000);
  };
  pressKey(win, 'N', ['meta']);
  if (!(await waitInPage(win, "document.querySelector('[data-new-session-view] [data-quick-question]')", 3_000))) return 'New session did not offer Quick question';
  const before = (await js("document.querySelector('[data-folder-select]').dataset.value")) as string;
  const box = '[data-new-session-view] [data-composer]';
  const boxText = (await js(`document.querySelector(${JSON.stringify(box)})?.value ?? ''`)) as string;
  if (boxText) await setFieldValue(win, box, '');
  pressKey(win, 'N', ['meta', 'shift']);
  if (!(await waitInPage(win, "document.querySelector('[data-quick-question]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-route-question]')", 3_000))) {
    return '⌘⇧N did not pick Quick question';
  }
  // The chips settle a render after the folder changes (a question's choices replace the project's).
  await waitInPage(win, "document.querySelector('[data-new-session-view] [data-mode-select]') && document.querySelector('[data-route-question-note]')", 2_000);
  const state = (await js(`(() => {
    const q = (s) => document.querySelector('[data-new-session-view] ' + s);
    return {
      git: ['[data-workspace-select]', '[data-branch-select]', '[data-base-select]', '[data-route-branch]', '[data-worktree-switch]', '[data-add-as-project]', '[data-save-project-defaults]'].filter((s) => q(s)),
      chips: !!q('[data-model-select]') && !!q('[data-effort-select]') && !!q('[data-mode-select]'),
      mode: q('[data-mode-select]')?.dataset.value ?? null,
      submit: q('[data-composer-submit]')?.innerText.trim() ?? '',
      frame: q('[data-project-color]')?.dataset.projectColor ?? null,
    };
  })()`)) as { git: string[]; chips: boolean; mode: string | null; submit: string; frame: string | null };
  if (state.git.length) return `Quick question still shows git options: ${state.git.join(', ')}`;
  if (!state.chips) return 'Quick question lost the model, effort or mode chip';
  if (!state.mode || ['bypassPermissions', 'auto', 'dontAsk'].includes(state.mode)) return `Quick question starts in a mode that never asks: ${state.mode}`;
  if (!state.submit.startsWith('Ask')) return `the message box says "${state.submit}", not Ask`;
  if (state.frame) return `the message box wears a project colour (${state.frame})`;
  await shot(win, 'quick-question.png');

  // The palette: Quick question… goes straight to its prompt step, without a worktree switch.
  if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return '⌘K did not open the commands';
  await setFieldValue(win, '[data-palette-input]', 'quick question');
  if (!(await waitInPage(win, "document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand === 'quick-question'", 2_000))) {
    return (await closePalette(win), '"quick question" did not rank Quick question… first');
  }
  pressKey(win, 'Return');
  if (!(await waitInPage(win, `${PALETTE_STEP} === 'prompt' && document.querySelector('[data-palette-route-question]') && document.activeElement?.matches('[data-palette-prompt]')`, 3_000))) {
    return (await closePalette(win), 'Quick question… did not show its prompt step');
  }
  const palette = (await js(
    "({ worktree: !!document.querySelector('[data-palette-worktree]'), branch: !!document.querySelector('[data-palette-route-branch]'), chips: !!document.querySelector('[data-command-palette] [data-palette-mode-select]'), start: document.querySelector('[data-palette-start]')?.innerText.trim() ?? '' })",
  )) as { worktree: boolean; branch: boolean; chips: boolean; start: string };
  await closePalette(win);
  if (palette.worktree || palette.branch) return 'the palette prompt step still shows git options';
  if (!palette.chips || !palette.start.startsWith('Ask')) return `the palette prompt step is missing parts: ${JSON.stringify(palette)}`;

  // Picking a project from Quick question (the folder New session had; the throwaway profile may have none yet).
  if (before) {
    if (!(await js(`!!${optionFor(before)}`))) {
      await js("document.querySelector('[data-folder-select]').click()");
      if (!(await waitInPage(win, "document.querySelector('[data-folder-list] input')", 3_000))) return 'could not open the folder list from Quick question';
      await setFieldValue(win, '[data-folder-list] input', before);
      await waitInPage(win, optionFor(before), 3_000);
    }
    await js(`${optionFor(before)}?.click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(before)} && !document.querySelector('[data-route-question]')`, 3_000))) {
      return 'could not pick a project again from Quick question';
    }
  }

  // Away and back with ⌘N: New session opens on the folder it had, not on Quick question.
  if (!(await leaveNewSession())) return 'could not leave New session';
  pressKey(win, 'N', ['meta']);
  if (!(await waitInPage(win, "document.querySelector('[data-new-session-view] [data-quick-question]')", 3_000))) return 'New session did not open again';
  // The remembered folder arrives a moment after the view opens.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const reopened = (await js("({ question: document.querySelector('[data-quick-question]').getAttribute('aria-pressed') === 'true', folder: document.querySelector('[data-folder-select]').dataset.value })")) as { question: boolean; folder: string };
  if (reopened.question || reopened.folder !== before) return `⌘N reopened New session on ${reopened.question ? 'Quick question' : reopened.folder || 'no folder'}, not on ${before || 'no folder'}`;
  if (boxText) {
    await setFieldValue(win, box, boxText);
    if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(box)})?.value === ${JSON.stringify(boxText)}`, 2_000))) return 'could not put the prompt back in New session';
  }
  // Back where the step started, for the steps after it.
  if (session && !(await leaveNewSession())) return 'could not go back to the session';
  return `ok: ⌘⇧N picks Quick question (no git options, ${state.mode} mode, Ask), the palette's prompt step too; ${before ? 'a project picks again; ' : ''}⌘N later opens on ${before ? 'that project' : 'no folder'}`;
}

/**
 * `switchboard://` links, fed to the handler directly (no `open`, so the system's link handlers are
 * untouched). A new-session link fills in the folder and prompt and says where the prompt came from,
 * but sends nothing; a bad link shows why and changes nothing; a repo with no checkout leaves the folder
 * empty; a session link opens the session under test again.
 */
async function runDeepLinkStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const prompt = 'Smoke test from a link:\nsummarise this folder.';
  const folder = homedir();
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  openDeepLink(`switchboard://new-session?prompt=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(folder)}`);
  if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(prompt)} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)}`, 5_000))) {
    return `the link did not fill in New session (${String(await js(`${composer}?.value + ' in ' + document.querySelector('[data-folder-select]')?.dataset.value`))})`;
  }
  if (!(await waitInPage(win, "document.querySelector('[data-link-notice]')?.innerText.includes('external link')", 2_000))) return 'no notice that the prompt came from a link';
  await shot(win, 'deep-link.png');

  // A refused link explains itself and leaves the prompt alone.
  openDeepLink('switchboard://delete-everything?cwd=/');
  if (!(await waitInPage(win, "document.querySelector('[data-link-error]')?.innerText.includes('delete-everything')", 3_000))) return 'an unknown action showed no error';
  await shot(win, 'deep-link-error.png');
  if ((await js(`${composer}?.value`)) !== prompt) return 'a refused link changed the prompt';
  await js("document.querySelector('[data-link-error] button').click()");

  // Clear empties the prompt and ends the notice. Nothing was sent all along.
  await js("document.querySelector('[data-clear-link-prompt]').click()");
  if (!(await waitInPage(win, `${composer}?.value === '' && !document.querySelector('[data-link-notice]')`, 2_000))) return 'Clear did not empty the prompt and the notice';
  if (!(await js("!!document.querySelector('[data-new-session-view]') && !document.querySelector('[data-current-session]')"))) return 'the link left New session (was something started?)';

  // A project that isn't one of yours is refused before anything changes.
  openDeepLink('switchboard://new-session?project=switchboard-smoke-no-such-project&prompt=hi');
  if (!(await waitInPage(win, "document.querySelector('[data-link-error]')?.innerText.includes('switchboard-smoke-no-such-project')", 5_000))) return 'an unknown project showed no error';
  if ((await js(`${composer}?.value`)) !== '') return 'an unknown project still filled in the prompt';
  await js("document.querySelector('[data-link-error] button').click()");

  // No folder in the link: nothing is guessed, the folder list opens, and even autostart waits.
  openDeepLink('switchboard://new-session?prompt=Wait%20for%20me&autostart=1');
  if (!(await waitInPage(win, `${composer}?.value === 'Wait for me' && document.querySelector('[data-folder-select]')?.dataset.value === '' && document.querySelector('[data-folder-select]')?.getAttribute('aria-expanded') === 'true'`, 5_000))) {
    return 'a link without a folder did not leave it empty with the folder list open';
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (!(await js("!!document.querySelector('[data-new-session-view]') && !document.querySelector('[data-current-session]') && document.querySelector('[data-link-notice]')?.innerText.includes('Read it')"))) return 'autostart without a folder did not wait';
  await shot(win, 'deep-link-no-folder.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });

  // No checkout of this repository: the folder is left empty, with the reason.
  openDeepLink('switchboard://new-session?repo=switchboard-smoke/no-such-repo&prompt=hi');
  if (!(await waitInPage(win, "document.querySelector('[data-folder-select]')?.dataset.value === '' && document.querySelector('[data-route-hint]')?.innerText.includes('switchboard-smoke/no-such-repo')", 20_000))) {
    return `a repo without a checkout did not leave the folder empty (${String(await js("document.querySelector('[data-route-hint]')?.innerText"))})`;
  }
  // Empty the prompt the links left: kept, it would count as an unsent New session prompt 2s later, and put a pen on
  // the + button that later steps check for.
  await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
  if (!(await waitInPage(win, `${composer}?.value === ''`, 2_000))) return 'could not empty the prompt the links left';

  if (!smokeSessionId) return 'ok: filled in folder and prompt, refused a bad link, empty folder for an unknown repo (no session to open)';
  openDeepLink(`switchboard://session/${smokeSessionId}`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000))) return 'a session link did not open the session';
  return 'ok: filled in folder and prompt with a notice, sent nothing, refused a bad link and an unknown project, no folder (even with autostart) opens the list and waits, empty folder for an unknown repo, opened a session';
}

/**
 * The VS Code companion, the way the extension uses it: connect to the engine's socket with the token from
 * engine.json, then send a reference to some lines and a piece of terminal output to New session on a folder inside
 * the throwaway profile. They must show as chips there. The Add context picker (⌘⇧A) then adds a file from the same
 * folder, and every chip is removed again. Nothing is ever sent to Claude.
 */
async function runCompanionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const key = (keyCode: string, modifiers: Array<'meta' | 'shift'> = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: platformModifiers(modifiers) });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: platformModifiers(modifiers) });
  };
  const folder = join(app.getPath('userData'), 'smoke-companion');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'auth.ts'), 'export const token = 1;\n');
  writeFileSync(join(folder, 'notes.md'), '# Notes\n');
  const infoFile = join(app.getPath('userData'), COMPANION_DIR, COMPANION_INFO_FILE);
  for (let i = 0; i < 50 && !existsSync(infoFile); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!existsSync(infoFile)) return 'the engine wrote no engine.json';
  const info = JSON.parse(readFileSync(infoFile, 'utf8')) as CompanionInfo;
  const socket = createConnection(info.socket);
  socket.setEncoding('utf8');
  socket.on('error', () => {});
  const client = createRpcClient<CompanionContract>(
    lineTransport({
      write: (text) => void socket.write(text),
      onData(listener) {
        socket.on('data', listener);
        return () => socket.off('data', listener);
      },
      close: () => socket.destroy(),
    }),
    { timeoutMs: 10_000 },
  );
  const tray = "document.querySelector('[data-new-session-view] [data-context-tray]')";
  const chips = `(${tray}?.querySelectorAll('[data-context-chip]').length ?? 0)`;
  try {
    await client.call('hello', { token: info.token, protocol: COMPANION_PROTOCOL, client: { name: 'smoke', version: '0' } });
    const listed = await client.call('sessions.list', { folders: [folder] });
    if (listed.windows < 1) return 'the engine says no window is connected';
    if (listed.sessions.length) return 'a folder made for this step already has sessions';
    await client.call('context.add', {
      target: { kind: 'new', cwd: folder },
      items: [
        { kind: 'file', path: join(folder, 'auth.ts'), range: { start: 1, end: 1 } },
        { kind: 'text', source: 'terminal', label: 'Terminal: zsh', text: '$ npm test\nFAIL auth.test.ts' },
      ],
      reveal: true,
    });
    if (!(await waitInPage(win, `document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)} && ${chips} === 2`, 5_000))) {
      return `the chips did not show in New session on the folder (${String(await js(`${chips} + ' chips in ' + document.querySelector('[data-folder-select]')?.dataset.value`))})`;
    }
    const labels = (await js(`[...${tray}.querySelectorAll('[data-context-chip]')].map((c) => c.innerText.trim()).join(', ')`)) as string;
    // Chips alone are something to send, so Start is ready; it is never pressed.
    if (!(await waitInPage(win, "!document.querySelector('[data-new-session-view] [data-composer-submit]')?.disabled", 3_000))) return 'Start session stayed disabled with only chips in the box';
    await shot(win, 'context-tray.png');

    // The picker: ⌘⇧A in the message box, type to filter, Space picks the file, Enter adds it.
    await js("document.querySelector('[data-new-session-view] [data-composer]').focus()");
    key('A', ['meta', 'shift']);
    if (!(await waitInPage(win, "document.querySelector('[data-add-context-dialog] [data-add-context-file=\"notes.md\"]')", 5_000))) return "the Add context picker did not list the folder's files";
    await setFieldValue(win, '[data-add-context-search]', 'notes');
    if (!(await waitInPage(win, "document.querySelector('[data-add-context-file][data-active=\"true\"]')?.dataset.addContextFile === 'notes.md'", 3_000))) return 'filtering the picker did not put notes.md first';
    key('Space');
    if (!(await waitInPage(win, "document.querySelector('[data-add-context-file=\"notes.md\"]')?.getAttribute('aria-selected') === 'true'", 2_000))) return 'Space did not pick the file';
    await shot(win, 'add-context.png');
    key('Return');
    if (!(await waitInPage(win, `!document.querySelector('[data-add-context-dialog]') && ${chips} === 3`, 3_000))) return 'Enter did not add the picked file as a chip';

    // A long paste goes in a Pasted card, not in the box; a click opens it to read or edit, Esc closes it.
    await js(`(() => {
      const box = document.querySelector('[data-new-session-view] [data-composer]');
      box.focus();
      const data = new DataTransfer();
      data.setData('text/plain', Array.from({ length: 40 }, (_, i) => 'pasted line ' + (i + 1)).join('\\n'));
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    if (!(await waitInPage(win, `${tray}?.querySelector('[data-context-chip="paste"]') && ${chips} === 4 && document.querySelector('[data-new-session-view] [data-composer]').value === ''`, 3_000))) {
      return `a long paste did not become a Pasted card (${String(await js(chips))} chips, ${String(await js("document.querySelector('[data-new-session-view] [data-composer]').value.length"))} characters in the box)`;
    }
    await js(`${tray}.querySelector('[data-context-chip="paste"] [data-context-chip-open]').click()`);
    if (!(await waitInPage(win, "document.querySelector('[data-pasted-text-editor]')?.value.startsWith('pasted line 1')", 3_000))) return 'clicking the Pasted card did not open its text';
    await shot(win, 'pasted-text.png');
    key('Escape');
    if (!(await waitInPage(win, `!document.querySelector('[data-pasted-text-dialog]') && ${chips} === 4`, 2_000))) return 'Esc did not close the pasted text, or took the card with it';

    // Removing every chip empties the box: no unsent prompt is left behind.
    // One at a time: a second click before the first removal renders would land on the same chip.
    for (let left = 4; left > 0; left--) {
      await js(`${tray}?.querySelector('[data-context-chip-remove]')?.click()`);
      if (!(await waitInPage(win, `${chips} === ${left - 1}`, 2_000))) return `removing a chip did not take it away (${String(await js(chips))} left of ${left})`;
    }
    if (!(await waitInPage(win, `!${tray} && !document.querySelector('[data-new-session-draft]')`, 3_000))) {
      if (await js(`!!${tray}`)) return 'removing the chips left the tray behind';
      const left = await js(
        `JSON.stringify({ pen: document.querySelector('[data-new-session-draft]')?.dataset.newSessionDraft ?? null, thisFolder: ${JSON.stringify(folder)}, box: document.querySelector('[data-new-session-view] [data-composer]')?.value ?? null })`,
      );
      return `removing the chips left an unsent New session prompt behind: ${left}`;
    }

    // Settings › VS Code counts this step's socket as a connected editor and links to the extension.
    await js("document.querySelector('[data-open-settings]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"vscode\"]')", 3_000))) return 'Settings has no VS Code section';
    await js("document.querySelector('[data-settings-section=\"vscode\"]').click()");
    const connected = await waitInPage(win, "document.querySelector('[data-companion-status]')?.dataset.companionStatus === 'connected' && document.querySelectorAll('[data-companion-link]').length === 3", 5_000);
    const status = (await js("document.querySelector('[data-companion-status]')?.innerText.trim() ?? 'no status'")) as string;
    await js("document.querySelector('[data-close-settings]').click()");
    if (!connected) return `Settings › VS Code did not show the connected editor (${status})`;
    return `ok: hello with the token, chips from the socket showed in New session on the folder (${labels}), Start ready but not pressed, ⌘⇧A added notes.md, a long paste made a Pasted card that opens, all removed again; Settings › VS Code says "${status}"`;
  } finally {
    client.dispose();
    socket.destroy();
    if (smokeSessionId) await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  }
}

/**
 * The queue, in the throwaway profile and against a temp folder: two prompts go in from New session (Add to queue,
 * filled in by a link), show in the sidebar's Queue (ready: nothing works there) and on Home, ⌥↓ moves the first
 * one down, ⌫ removes it and Undo puts it back, and both are removed at the end. Nothing is ever started.
 */
async function runQueueStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // The real path: the folder picker and the engine compare folders by it (/var is /private/var on macOS).
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-queue-')));
  const sidebarItems = "[...document.querySelectorAll('[data-session-list] [data-queue-item]')].map((el) => el.dataset.queueItem)";
  const started = "!!document.querySelector('[data-current-session]')";
  try {
    if (!(await js("!!document.querySelector('[data-sidebar-open]')"))) return 'the sidebar is not open';
    if ((await js(`${sidebarItems}.length`)) !== 0) return 'the throwaway profile already had a queue';
    const queuePrompt = async (prompt: string) => {
      openDeepLink(`switchboard://new-session?prompt=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(folder)}`);
      const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
      // Add to queue is in Start's menu (the ▾ next to Start).
      if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(prompt)} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)} && !document.querySelector('[data-new-session-view] [data-start-menu]')?.disabled`, 5_000))) return false;
      await js("document.querySelector('[data-new-session-view] [data-start-menu]').click()");
      if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-queue-add]') && !document.querySelector('[role=menu] [data-queue-add]').disabled && !!document.querySelector('[role=menu] [data-start-session]')", 2_000))) return false;
      await js("document.querySelector('[role=menu] [data-queue-add]').click()");
      // Added: the box empties, you stay in New session, and the toast offers Undo.
      return waitInPage(win, `${composer}?.value === '' && !!document.querySelector('[data-new-session-view]') && [...document.querySelectorAll('[data-toast]')].some((t) => t.innerText.includes('Added to the queue'))`, 3_000);
    };
    if (!(await queuePrompt('Smoke queue: first'))) return 'Add to queue did not add the first prompt';
    if (!(await queuePrompt('Smoke queue: second'))) return 'Add to queue did not add the second prompt';
    if (!(await waitInPage(win, `${sidebarItems}.length === 2 && !!document.querySelector('[data-queue-header]')`, 3_000))) return 'the Queue section did not list both';
    const [first, second] = (await js(sidebarItems)) as string[];
    if (!(await js(`document.querySelector('[data-session-list] [data-queue-item="${first}"]').closest('[data-queue-state]')?.dataset.queueState === 'ready'`))) return 'an item in a folder with nothing working was not ready';
    if (!(await js("document.querySelector('[data-queue-header]').innerText.includes('2 ready')"))) return 'the Queue header did not say 2 ready';

    // A queued item opens in a box of its own: New session's prompt is left as it was, and edits stay on the item.
    const box = '[data-new-session-view] [data-composer]';
    const composer = `document.querySelector('${box}')`;
    const label = (id: string | undefined) => `document.querySelector('[data-session-list] [data-queue-item="${id}"]')?.getAttribute('aria-label') ?? ''`;
    await js(`document.querySelector('[data-session-list] [data-queue-item="${first}"]').click()`);
    if (!(await waitInPage(win, `${composer}?.value === 'Smoke queue: first' && !!document.querySelector('[data-later-notice]')`, 3_000))) return 'clicking a queued item did not open it in New session';
    // Longer than a draft takes to count: opening it must not leave an unsent New session prompt.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    // (The pen names the newest New session prompt's folder; an earlier step may have left one in another project.)
    if (await js(`document.querySelector('[data-new-session-draft]')?.dataset.newSessionDraft === ${JSON.stringify(folder)}`)) return 'opening a queued item left an unsent New session prompt';
    await setFieldValue(win, box, 'Smoke queue: first, edited');
    if (!(await waitInPage(win, `${label(first)}.includes('Smoke queue: first, edited')`, 3_000))) return 'an edit to a queued item was not kept on it';
    await js("document.querySelector('[data-close-queued]').click()");
    if (!(await waitInPage(win, `${composer}?.value === '' && !document.querySelector('[data-later-notice]')`, 3_000))) return 'Close did not go back to an empty New session';
    const own = 'Smoke queue: a New session prompt of its own';
    await setFieldValue(win, box, own);
    await js(`document.querySelector('[data-session-list] [data-queue-item="${second}"]').click()`);
    if (!(await waitInPage(win, `${composer}?.value === 'Smoke queue: second'`, 3_000))) return 'a queued item did not open over a New session prompt';
    await js("document.querySelector('[data-new-session]').click()");
    if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(own)} && !document.querySelector('[data-later-notice]')`, 3_000))) return 'the + button did not bring back New session\'s own prompt after a queued item';
    if (!(await js(`${label(second)}.includes('Smoke queue: second')`))) return 'leaving a queued item changed it';
    await setFieldValue(win, box, '');
    // Right under Working (or the top, without it), above Pinned and the rest.
    const placed = (await js(
      "(() => { const headers = [...document.querySelectorAll('[data-session-list] [data-session-group], [data-session-list] [data-queue-header]')]; const at = headers.findIndex((h) => h.matches('[data-queue-header]')); return headers.slice(0, at).every((h) => ['needs-you', 'working'].includes(h.dataset.sessionGroup)); })()",
    )) as boolean;
    if (!placed) return 'the Queue section was not right under Working';
    // An update pill takes the footer's place; otherwise it counts the queue.
    const footer = (await js("document.querySelector('[data-sidebar-open] footer')?.innerText ?? ''")) as string;
    if (/\d+ sessions?/.test(footer) && !(await js("!!document.querySelector('[data-footer-queued]')?.innerText.includes('2 queued')"))) return `the footer did not count 2 queued (${String(await js("document.querySelector('[data-sidebar-open] footer')?.innerText"))})`;
    await shot(win, 'queue-sidebar.png');

    // ⌥↓ on the first moves it below the second.
    await js(`document.querySelector('[data-session-list] [data-queue-item="${first}"]').focus()`);
    pressKey(win, 'Down', ['alt']);
    if (!(await waitInPage(win, `JSON.stringify(${sidebarItems}) === ${JSON.stringify(JSON.stringify([second, first]))}`, 3_000))) return '⌥↓ did not move the item down';

    // Home shows the same queue, in the same order.
    await js("document.querySelector('[data-go-home]').click()");
    if (!(await waitInPage(win, `JSON.stringify([...document.querySelectorAll('[data-home-queue] [data-queue-item]')].map((el) => el.dataset.queueItem)) === ${JSON.stringify(JSON.stringify([second, first]))}`, 3_000))) return 'the Home card did not show the queue in order';
    await shot(win, 'queue-home.png');

    // ⌫ removes it; Undo puts it back in its place.
    await js(`document.querySelector('[data-session-list] [data-queue-item="${first}"]').focus()`);
    pressKey(win, 'Backspace');
    if (!(await waitInPage(win, `JSON.stringify(${sidebarItems}) === ${JSON.stringify(JSON.stringify([second]))}`, 3_000))) return '⌫ did not remove the item';
    if (!(await waitInPage(win, "[...document.querySelectorAll('[data-toast]')].some((t) => t.innerText.includes('Removed from the queue'))", 2_000))) return 'no toast after removing';
    await js("[...document.querySelectorAll('[data-toast]')].find((t) => t.innerText.includes('Removed from the queue')).querySelector('[data-toast-undo]').click()");
    if (!(await waitInPage(win, `JSON.stringify(${sidebarItems}) === ${JSON.stringify(JSON.stringify([second, first]))}`, 3_000))) return 'Undo did not put the item back in its place';

    // Removed again, both of them: the queue and its section are gone.
    for (const id of [first, second]) {
      await js(`document.querySelector('[data-session-list] [data-queue-item="${id}"]').focus()`);
      pressKey(win, 'Backspace');
      if (!(await waitInPage(win, `!document.querySelector('[data-session-list] [data-queue-item="${id}"]')`, 3_000))) return 'removing an item did not take it off the queue';
    }
    if (!(await waitInPage(win, `${sidebarItems}.length === 0 && !document.querySelector('[data-queue-header]') && !document.querySelector('[data-home-queue]')`, 3_000))) return 'removing both did not empty the queue';
    if (await js(started)) return 'a session was started';
    return 'ok: added two from New session, ready in an idle folder, under Working, opened one in its own box (edits kept, New session prompt untouched), ⌥↓ moved one, Home in the same order, ⌫ and Undo, removed both, started nothing';
  } finally {
    // Leave no queued item open and no New session prompt behind.
    if (await js("!!document.querySelector('[data-close-queued]')")) await js("document.querySelector('[data-close-queued]').click()");
    if (await js("!!document.querySelector('[data-new-session-view] [data-composer]')?.value")) await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
    // Whatever happened, nothing stays queued: remove what is left in the temp folder (through the menu, as a person would).
    for (let i = 0; i < 4 && (await js(`${sidebarItems}.length`)) > 0; i++) {
      await js("document.querySelector('[data-session-list] [data-queue-item]').focus()");
      pressKey(win, 'Backspace');
      await waitInPage(win, `${sidebarItems}.length < ${(await js(`${sidebarItems}.length`)) as number}`, 2_000);
    }
    // Back to the session the later steps use.
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // Windows won't delete a folder that is a process's working folder (New session warms Claude Code up in it).
      // A temp folder left behind is harmless.
    }
  }
}

/**
 * Collapsible sections: a click on Today's header (or the first section that can close) hides its rows and keeps
 * the header with its count; ← and → on the focused header close and open it. Earlier starts closed. Back as it was.
 */
async function runSectionsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await js("!!document.querySelector('[data-sidebar-open]')"))) return 'the sidebar is not open';
  const earlier = (await js("document.querySelector('[data-section-toggle=\"earlier\"]')?.dataset.open ?? 'none'")) as string;
  if (earlier === 'true') return 'Earlier did not start closed';
  const group = (await js("['today', 'yesterday', 'pinned', 'working'].find((g) => document.querySelector(`[data-section-toggle=\"${g}\"][data-open=\"true\"]`)) ?? null")) as string | null;
  if (!group) return `ok: no open section to collapse (Earlier ${earlier === 'none' ? 'not shown' : 'closed'})`;
  const toggle = `document.querySelector('[data-section-toggle="${group}"]')`;
  const rowsUnder = `(() => { const rows = [...document.querySelectorAll('[data-session-list] [role=listitem]')]; const at = rows.findIndex((r) => r.querySelector('[data-section-toggle="${group}"]')); const out = []; for (const r of rows.slice(at + 1)) { if (r.querySelector('[data-section-toggle], [data-session-group], [data-archived-toggle]')) break; const s = r.querySelector('[data-session-id]'); if (s) out.push(s.dataset.sessionId); } return out; })()`;
  const before = (await js(`${rowsUnder}.length`)) as number;
  const selected = (await js("document.querySelector('[data-session-list] [aria-current=\"true\"]')?.dataset.sessionId ?? null")) as string | null;
  await js(`${toggle}.click()`);
  // Closed: at most the open session's row stays under it.
  if (!(await waitInPage(win, `${toggle}.dataset.open === 'false' && ${toggle}.getAttribute('aria-expanded') === 'false' && ${rowsUnder}.every((id) => id === ${JSON.stringify(selected)})`, 2_000))) return `closing ${group} did not hide its rows`;
  const header = (await js(`${toggle}.closest('[data-session-group]')?.innerText.replace(/\\s+/g, ' ') ?? ''`)) as string;
  if (!/\d/.test(header)) return `the closed header lost its count (${header})`;
  const summary = (await js(`document.querySelector('[data-section-summary="${group}"]')?.innerText ?? ''`)) as string;
  await shot(win, 'sections-closed.png');
  // → opens it again from the keyboard, ← closes it, → opens it.
  await js(`${toggle}.focus()`);
  pressKey(win, 'Right');
  if (!(await waitInPage(win, `${toggle}.dataset.open === 'true' && ${rowsUnder}.length === ${before}`, 2_000))) return `→ did not open ${group} again`;
  pressKey(win, 'Left');
  if (!(await waitInPage(win, `${toggle}.dataset.open === 'false'`, 2_000))) return `← did not close ${group}`;
  pressKey(win, 'Right');
  if (!(await waitInPage(win, `${toggle}.dataset.open === 'true'`, 2_000))) return `could not open ${group} again`;
  return `ok: closed ${group} (${before} ${before === 1 ? 'row' : 'rows'} hidden, header "${header}"${summary ? `, summary "${summary}"` : ''}), ← → on the header, Earlier ${earlier === 'none' ? 'not shown' : 'starts closed'}`;
}

/**
 * Archived docks under the list while closed (a list that fits doesn't scroll), moves into the list right under the
 * last active row when opened (no gap, its header in the upper half), and back to the dock when closed; → and ← do the
 * same from the keyboard, with focus following the header. Every collapsible header shows its chevron. Sidebar shots
 * of both, in light and dark. Only the throwaway profile's UI state changes.
 */
/**
 * Star on GitHub: scripted runs keep it hidden, so this step asks for it, checks it shows (in the open sidebar or the
 * rail) and that Don't show again hides it for good. It never clicks the star: that would open a browser, or star
 * the repository with a real gh.
 */
async function runStarStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  updatePreferences({ githubStar: 'ask' });
  try {
    if (!(await waitInPage(win, "!!document.querySelector('[data-star-prompt]')", 10_000))) {
      const sessions = (await js("Number.parseInt(document.querySelector('[data-footer-sessions]')?.textContent ?? '', 10)")) as number;
      // The button waits for five sessions (STAR_AFTER_SESSIONS); a footer count tells whether there are.
      return Number.isNaN(sessions) || sessions < 5 ? 'ok: skipped, fewer than five sessions' : 'Star on GitHub did not show';
    }
    const mode = (await js("document.querySelector('[data-star-prompt]').dataset.starPrompt")) as string;
    // The smoke test's gh never reaches GitHub, so it can't tell: the button opens the page instead.
    if (process.env.SWITCHBOARD_GH && mode !== 'open-page') return `Star on GitHub would ${mode} with a gh that can't reach GitHub`;
    // The bottom of the sidebar (or the rail) with the button, in both schemes, to look at.
    const scheme = preferences.get().colorScheme;
    for (const colorScheme of ['light', 'dark'] as const) {
      await setColorScheme(win, colorScheme);
      const rect = (await js("(() => { const s = document.querySelector('[data-sidebar-open]') ?? document.querySelector('[data-star-prompt]').closest('nav'), r = s.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.bottom - 160), width: Math.round(r.width), height: 160 }; })()")) as Electron.Rectangle;
      writeFileSync(join(smokeOutDir!, `star-${colorScheme}.png`), (await win.webContents.capturePage(rect)).toPNG());
    }
    updatePreferences({ colorScheme: scheme });
    if (!(await js("!!document.querySelector('[data-star-dismiss]')"))) {
      // The rail: Don't show again is in the star's context menu.
      await js("document.querySelector('[data-star-button]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 400 }))");
      if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-star-dismiss]')", 2_000))) return "the rail's star has no Don't show again";
    }
    await js("document.querySelector('[data-star-dismiss]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-star-prompt]')", 2_000))) return "Don't show again did not hide Star on GitHub";
    if (preferences.get().githubStar !== 'done') return "Don't show again was not saved";
    return `ok: shown (${mode}), hidden for good`;
  } finally {
    updatePreferences({ githubStar: 'done' });
  }
}

async function runArchivedDockStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const list = "document.querySelector('[data-session-list]')";
  const dock = "document.querySelector('[data-archived-dock]')";
  const header = "document.querySelector('[data-archived-header]')";
  const toggle = (where: string) => `${where}?.querySelector('[data-archived-toggle]')`;
  // Done moving: the header carries no FLIP transform and the archived rows are fully shown.
  const landed = `!!${header} && !${dock} && ${header}.style.transform === '' && ![...document.querySelectorAll('[data-session-list] [role=listitem].opacity-0')].length`;
  const scheme = preferences.get().colorScheme;
  try {
    await js(`${list}.scrollTop = 0`);
    if (await js(`${toggle(header)}?.dataset.open === 'true'`)) {
      await js(`${toggle(header)}.click()`);
      // Docked once it has slid into place: measured during the slide, it is still up in the list.
      if (!(await waitInPage(win, `!!${dock} && ${dock}.style.transform === ''`, 2_000))) return 'closing Archived did not dock it';
    }
    if (!(await js(`!!${dock}`))) return 'ok: skipped, no archived sessions';
    // Every collapsible header shows its chevron, open or closed, without hovering.
    const hidden = (await js("[...document.querySelectorAll('[data-section-toggle], [data-archived-toggle]')].filter((b) => { const svg = b.querySelector('svg'); return !svg || getComputedStyle(svg).opacity !== '1'; }).length")) as number;
    if (hidden) return `${hidden} section header(s) without a visible chevron`;
    const docked = (await js(`(() => {
      const l = ${list}, d = ${dock}, lr = l.getBoundingClientRect(), dr = d.getBoundingClientRect();
      const content = l.firstElementChild.offsetHeight + parseFloat(getComputedStyle(l).paddingBottom);
      return { outside: !l.contains(d), below: dr.top >= lr.bottom - 1, fits: content <= l.clientHeight, scrolls: l.scrollHeight > l.clientHeight, dockTop: dr.top, listBottom: lr.bottom, dpr: devicePixelRatio };
    })()`)) as { outside: boolean; below: boolean; fits: boolean; scrolls: boolean; dockTop: number; listBottom: number; dpr: number };
    if (!docked.outside || !docked.below) return `the closed Archived header is not docked under the list (${JSON.stringify(docked)})`;
    if (docked.fits && docked.scrolls) return 'a list that fits still scrolls';
    const sidebarShot = async (name: string) => {
      await settle(win);
      const rect = (await js("(() => { const r = document.querySelector('[data-sidebar-open]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()")) as Electron.Rectangle;
      writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage(rect)).toPNG());
    };
    for (const colorScheme of ['light', 'dark'] as const) {
      await setColorScheme(win, colorScheme);
      await sidebarShot(`archived-closed-${colorScheme}.png`);
    }

    await js(`${toggle(dock)}.click()`);
    if (!(await waitInPage(win, landed, 2_000))) return 'opening Archived did not move its header into the list';
    const open = (await js(`(() => {
      const item = ${header}.closest('[role=listitem]'), at = Number(item.getAttribute('aria-posinset'));
      const prev = [...document.querySelectorAll('[data-session-list] [role=listitem]')].find((r) => Number(r.getAttribute('aria-posinset')) === at - 1);
      const l = ${list};
      return { gap: prev ? Math.round(item.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : 0, top: item.getBoundingClientRect().top - l.getBoundingClientRect().top, half: l.clientHeight / 2, scrolledToEnd: l.scrollTop >= l.scrollHeight - l.clientHeight - 1 };
    })()`)) as { gap: number; top: number; half: number; scrolledToEnd: boolean };
    if (open.gap !== 0) return `a ${open.gap}px gap above the open Archived header`;
    // Low is fine only when the list can't scroll any further (a short list, archivedRevealTop clamps to it).
    if (open.top > open.half && !open.scrolledToEnd) return `the open Archived header sits low in the list (${Math.round(open.top)}px of ${Math.round(open.half * 2)}px)`;
    for (const colorScheme of ['light', 'dark'] as const) {
      await setColorScheme(win, colorScheme);
      await sidebarShot(`archived-open-${colorScheme}.png`);
    }

    await js(`${toggle(header)}.click()`);
    if (!(await waitInPage(win, `!!${dock} && !${header} && ${dock}.style.transform === ''`, 2_000))) return 'closing Archived did not dock it again';
    // From the keyboard: → opens it and focus follows the header into the list, ← sends both back to the dock.
    await js(`${toggle(dock)}.focus()`);
    pressKey(win, 'Right');
    if (!(await waitInPage(win, `${landed} && document.activeElement === ${toggle(header)}`, 2_000))) return '→ on the docked header did not open Archived with focus on its header';
    pressKey(win, 'Left');
    if (!(await waitInPage(win, `!!${dock} && document.activeElement === ${toggle(dock)}`, 2_000))) return '← on the open header did not dock it with focus';
    // A long list: check a short one too, with the project that has the fewest sessions.
    const short = docked.fits ? null : await shortArchivedList(win, sidebarShot);
    if (short && !short.startsWith('ok')) return short;
    return `ok: docked under the list${docked.fits ? ' (no scrollbar)' : ' (long list scrolls)'}, opens with no gap at ${Math.round(open.top)}px, closes to the dock, → ← with focus${short ? `; ${short.slice(4)}` : ''}`;
  } finally {
    updatePreferences({ colorScheme: scheme });
  }
}

/**
 * The Archived dock on a short list: with every section closed (⌥-click), the list fits without scrolling and Archived
 * opens right under it. The sections that were open are opened again afterwards, from the bottom up.
 */
async function shortArchivedList(win: BrowserWindow, sidebarShot: (name: string) => Promise<void>): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const list = "document.querySelector('[data-session-list]')";
  const dock = "document.querySelector('[data-archived-dock]')";
  const header = "document.querySelector('[data-archived-header]')";
  // Which sections are open: the list is virtualised, so walk it from top to bottom.
  const open: string[] = [];
  const seen = new Set<string>();
  await js(`${list}.scrollTop = 0`);
  for (let i = 0; i < 60; i++) {
    await settle(win, 100);
    const headers = (await js("[...document.querySelectorAll('[data-section-toggle]')].map((b) => [b.dataset.sectionToggle, b.dataset.open])")) as Array<[string, string]>;
    for (const [section, state] of headers) {
      if (seen.has(section)) continue;
      seen.add(section);
      if (state === 'true') open.push(section);
    }
    if (await js(`${list}.scrollTop + ${list}.clientHeight >= ${list}.scrollHeight - 1`)) break;
    await js(`${list}.scrollTop += ${list}.clientHeight / 2`);
  }
  await js(`${list}.scrollTop = 0`);
  if (open.length === 0) return 'ok: every section already closed';
  const toggle = (section: string) => `document.querySelector('[data-section-toggle="${section}"]')`;
  await settle(win, 100);
  await js(`${toggle(open[0]!)}.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`);
  try {
    if (!(await waitInPage(win, "[...document.querySelectorAll('[data-section-toggle]')].every((b) => b.dataset.open === 'false')", 2_000))) return '⌥-click did not close every section';
    await settle(win);
    const fit = (await js(`(() => { const l = ${list}; const content = l.firstElementChild.offsetHeight + parseFloat(getComputedStyle(l).paddingBottom); return { fits: content <= l.clientHeight, scrolls: l.scrollHeight > l.clientHeight }; })()`)) as { fits: boolean; scrolls: boolean };
    if (!fit.fits) return 'ok: the list fills the sidebar even with every section closed';
    if (fit.scrolls) return 'a short list still scrolls';
    await sidebarShot('archived-short-closed.png');
    await js(`${dock}.querySelector('[data-archived-toggle]').click()`);
    if (!(await waitInPage(win, `!!${header} && !${dock} && ${header}.style.transform === '' && ![...document.querySelectorAll('[data-session-list] [role=listitem].opacity-0')].length`, 2_000))) return 'Archived did not open on the short list';
    const placed = (await js(`(() => {
      const item = ${header}.closest('[role=listitem]'), at = Number(item.getAttribute('aria-posinset'));
      const prev = [...document.querySelectorAll('[data-session-list] [role=listitem]')].find((r) => Number(r.getAttribute('aria-posinset')) === at - 1);
      return { gap: prev ? Math.round(item.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : 0, top: item.getBoundingClientRect().top - ${list}.getBoundingClientRect().top, half: ${list}.clientHeight / 2 };
    })()`)) as { gap: number; top: number; half: number };
    await sidebarShot('archived-short-open.png');
    await js(`${header}.querySelector('[data-archived-toggle]').click()`);
    if (!(await waitInPage(win, `!!${dock}`, 2_000))) return 'Archived did not dock again on the short list';
    if (placed.gap !== 0) return `a ${placed.gap}px gap above the open Archived header on a short list`;
    if (placed.top > placed.half) return `the open Archived header sits low on a short list (${Math.round(placed.top)}px)`;
    return 'ok: a short list (every section closed) has no scrollbar, and Archived opens right under it';
  } finally {
    for (const section of [...open].reverse()) {
      await js(`${toggle(section)}?.dataset.open === 'false' && ${toggle(section)}.click()`);
      await settle(win, 50);
    }
  }
}

/** Presses a key in the page (down and up), with modifiers. */
function pressKey(win: BrowserWindow, keyCode: string, modifiers: Array<'meta' | 'shift' | 'alt' | 'control'> = []): void {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: platformModifiers(modifiers) });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: platformModifiers(modifiers) });
}

const PALETTE_MODE = "document.querySelector('[data-command-palette]')?.dataset.paletteMode";
const PALETTE_STEP = "document.querySelector('[data-command-palette]')?.dataset.paletteStep";

/** Opens the command palette with a shortcut and waits for it in `mode`, with the cursor in its field. */
/**
 * The Usage view: a click on the usage bar opens it (the palette's Open usage where no bar shows, as in the demo home
 * without a login), the tabs and periods switch, a row of the breakdown opens its session, and Esc goes back. Only
 * reads: the transcripts' tokens go into the throwaway profile's cache.
 */
async function runUsageViewStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const opened = [];
  if (await js("!!document.querySelector('[data-usage-band]')")) {
    const click = await clickLikeAUser(win, '[data-usage-band]');
    if (!click.hit) return `the usage bar is covered by ${click.at}`;
    opened.push('the usage bar');
  } else {
    if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return '⌘K did not open the commands';
    await setFieldValue(win, '[data-palette-input]', 'Open usage');
    if (!(await waitInPage(win, "[...document.querySelectorAll('[data-command-palette] [role=option]')].some((el) => el.innerText.includes('Open usage'))", 3_000))) return 'the palette has no Open usage';
    pressKey(win, 'Return');
    opened.push('the palette');
  }
  if (!(await waitInPage(win, "document.querySelector('[data-usage-view]')", 5_000))) return `the Usage view did not open from ${opened[0]}`;
  const profile = (await js("document.querySelector('[data-usage-view]').dataset.usageProfile")) as string;

  await js("document.querySelector('[data-usage-tab=\"tokens\"]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-usage-tab=\"tokens\"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('[data-usage-headline], [data-usage-scan]')", 15_000))) return 'the Tokens tab showed no totals';
  for (const period of ['day', 'week', 'month', 'window']) {
    await js(`document.querySelector('[data-usage-period="${period}"]').click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-usage-period="${period}"]')?.getAttribute('aria-checked') === 'true' && document.querySelector('[data-usage-headline]')`, 15_000))) return `the ${period} period did not show`;
  }
  // Keys: ⌘1 for Limits, 3 for 7 days.
  pressKey(win, '1', ['meta']);
  pressKey(win, '3');
  if (!(await waitInPage(win, "document.querySelector('[data-usage-tab=\"limits\"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('[data-usage-period=\"week\"]')?.getAttribute('aria-checked') === 'true'", 3_000))) return '⌘1 and 3 did not pick Limits and 7 days';
  const limits = (await js("document.querySelectorAll('[data-usage-limit]').length")) as number;
  await shot(win, 'usage-view.png');

  // A session from the breakdown, when the period has one that is still in the list (never a running one: opening only reads).
  pressKey(win, '2', ['meta']);
  pressKey(win, '4');
  await waitInPage(win, "document.querySelector('[data-usage-breakdown] [data-usage-row], [data-usage-breakdown] p')", 15_000);
  const running = (await runningSessions())?.ids ?? new Set<string>();
  const row = (await js(`(() => {
    const running = new Set(${JSON.stringify([...running])});
    const rows = [...document.querySelectorAll('[data-usage-breakdown] [data-usage-row][tabindex]')];
    const row = rows.find((el) => !running.has(el.dataset.usageRow));
    return row ? row.dataset.usageRow : null;
  })()`)) as string | null;
  let openedSession = 'no session in the list to open';
  if (row) {
    await js(`document.querySelector('[data-usage-breakdown] [data-usage-row=${JSON.stringify(JSON.stringify(row)).slice(1, -1)}]').click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-current-session=${JSON.stringify(JSON.stringify(row)).slice(1, -1)}]')`, 5_000))) return 'a breakdown row did not open its session';
    openedSession = 'a row opened its session';
    // Back in, to leave with Esc.
    await js("document.querySelector('[data-usage-band]')?.click()");
    if (!(await waitInPage(win, "document.querySelector('[data-usage-view]')", 3_000))) {
      if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return '⌘K did not open the commands';
      await setFieldValue(win, '[data-palette-input]', 'Open usage');
      pressKey(win, 'Return');
      if (!(await waitInPage(win, "document.querySelector('[data-usage-view]')", 3_000))) return 'the Usage view did not open again';
    }
  }
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-usage-view]')", 3_000))) return 'Esc did not leave the Usage view';
  return `ok: opened from ${opened[0]} for ${profile}, ${limits} limit card(s), every period, ${openedSession}, Esc went back`;
}

async function openPalette(win: BrowserWindow, keyCode: string, modifiers: Array<'meta' | 'shift'>, mode: string): Promise<boolean> {
  pressKey(win, keyCode, modifiers);
  return waitInPage(win, `${PALETTE_MODE} === ${JSON.stringify(mode)} && document.activeElement?.matches('[data-palette-input]')`, 3_000);
}

async function closePalette(win: BrowserWindow): Promise<boolean> {
  pressKey(win, 'Escape');
  return waitInPage(win, "!document.querySelector('[data-command-palette]')", 2_000);
}

/**
 * The command palette: ⌘K and ⌘⇧P open its commands, ⌘P go-to (sessions); typing ">" switches to the
 * commands and ⌫ leaves them; "This session" leads with a session open and is gone at Home; "tog chan"
 * and Enter run Toggle changes (and again, to put it back).
 */
async function runPaletteStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const has = (selector: string) => js(`!!document.querySelector(${JSON.stringify(selector)})`) as Promise<boolean>;

  if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return '⌘K did not open the commands';
  if (!(await has('[data-command-palette] [data-palette-group="session"] [data-palette-command="copy-session-id"]'))) return 'no "This session" commands with a session open';
  const firstGroup = await js("document.querySelector('[data-command-palette] [data-palette-group]')?.dataset.paletteGroup ?? null");
  if (firstGroup !== 'session') return `the first group was ${String(firstGroup)}, not "This session"`;
  await shot(win, 'command-palette.png');
  if (!(await closePalette(win))) return 'Esc did not close the palette';
  if (!(await openPalette(win, 'P', ['meta', 'shift'], 'commands'))) return '⌘⇧P did not open the commands';
  if (!(await closePalette(win))) return 'Esc did not close the palette';

  if (!(await openPalette(win, 'P', ['meta'], 'goto'))) return '⌘P did not open go-to';
  if (!(await waitInPage(win, "document.querySelector('[data-command-palette] [data-palette-session]')", 3_000))) return 'go-to listed no sessions';
  await shot(win, 'command-palette-goto.png');
  await setFieldValue(win, '[data-palette-input]', '>');
  if (!(await waitInPage(win, `${PALETTE_MODE} === 'commands' && document.querySelector('[data-palette-input]').value === ''`, 2_000))) return 'typing ">" did not switch to the commands';
  pressKey(win, 'Backspace');
  if (!(await waitInPage(win, `${PALETTE_MODE} === 'goto'`, 2_000))) return '⌫ in the empty field did not go back to go-to';
  if (!(await closePalette(win))) return 'Esc did not close go-to';

  const panelOpen = () => has('[data-changes-panel]');
  const before = await panelOpen();
  // Outside git the session has no Changes panel to show: the command still runs, but only its ranking is checked.
  const onGit = await has('[data-current-session] [data-toggle-changes]');
  const runCommand = async (text: string) => {
    if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return null;
    await setFieldValue(win, '[data-palette-input]', text);
    await settle(win);
    const first = await js("document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand ?? null");
    pressKey(win, 'Return');
    await waitInPage(win, "!document.querySelector('[data-command-palette]')", 2_000);
    return first;
  };
  const first = await runCommand('tog chan');
  if (first !== 'toggle-changes') return `"tog chan" ranked ${String(first)} first`;
  if (onGit && !(await waitInPage(win, before ? "!document.querySelector('[data-changes-panel]')" : "!!document.querySelector('[data-changes-panel]')", 2_000))) return 'Toggle changes did nothing';
  await runCommand('tog chan');
  if (onGit && (await panelOpen()) !== before) return 'could not toggle the panel back';

  // Home: nothing for a session.
  pressKey(win, 'H', ['meta', 'shift']);
  if (!(await waitInPage(win, "!document.querySelector('[data-current-session]')", 3_000))) return '⌘⇧H did not go Home';
  if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return '⌘K did not open at Home';
  const sessionCommands = (await has('[data-command-palette] [data-palette-group="session"]')) || (await has('[data-palette-command="copy-session-id"]'));
  await closePalette(win);
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"] [data-transcript-item]')`, 5_000);
  if (sessionCommands) return '"This session" commands showed at Home';
  return 'ok: ⌘K and ⌘⇧P open the commands with "This session" first, ⌘P lists sessions, ">" and ⌫ switch mode, "tog chan" ran Toggle changes, nothing for a session at Home';
}

const SHEET = "document.querySelector('[data-shortcuts-sheet]')";
/** The ids of the rows the shortcuts sheet shows. */
const SHEET_ROWS = "[...document.querySelectorAll('[data-shortcuts-sheet] [data-shortcut-row]')].map((el) => el.dataset.shortcutRow)";

/**
 * The shortcuts sheet: ⌘/ from the message box opens it with the filter focused and Command palette (⌘K)
 * listed, in light and dark; "terminal" leaves only rows about the terminal; ⌘J pressed in the filter is
 * typed rather than run; ⌘/ closes it; at Home, Here hides Stop Claude (All fades it); Esc closes and
 * focus goes back to where it was.
 */
async function runShortcutsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const scheme = preferences.get().colorScheme;
  try {
    return await shortcutsChecks(win, js);
  } finally {
    updatePreferences({ colorScheme: scheme });
    // Leave the sheet in All mode and closed, and go back to the session the later steps use.
    if (await js(`!!${SHEET}`)) {
      await js("document.querySelector('[data-shortcut-mode-option=\"all\"]')?.click()");
      pressKey(win, 'Escape');
    }
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"] [data-transcript-item]')`, 5_000);
  }
}

async function shortcutsChecks(win: BrowserWindow, js: (code: string) => Promise<unknown>): Promise<string> {
  const open = async () => {
    pressKey(win, '/', ['meta']);
    return waitInPage(win, `${SHEET} && document.activeElement?.matches('[data-shortcut-filter]')`, 3_000);
  };
  if (!(await js("(() => { const box = document.querySelector('textarea[data-composer]'); box?.focus(); return document.activeElement === box && !!box; })()"))) return 'no message box to start from';
  if (!(await open())) return '⌘/ in the message box did not open the sheet with the filter focused';
  const palette = (await js(
    "(() => { const row = document.querySelector('[data-shortcut-row=\"palette.commands\"]'); return row ? { text: row.innerText, caps: [...row.querySelectorAll('kbd')].map((k) => k.textContent), edge: getComputedStyle(row.querySelector('kbd')).borderBottomWidth } : null; })()",
  )) as { text: string; caps: string[]; edge: string } | null;
  if (!palette?.text.includes('Command palette')) return 'no Command palette row';
  const paletteCaps = process.platform === 'darwin' ? '⌘ K' : 'Ctrl K';
  if (palette.caps.slice(0, 2).join(' ') !== paletteCaps) return `Command palette showed ${palette.caps.join(' ')}, not ${paletteCaps}`;
  if (palette.edge !== '2px') return `keycaps have a ${palette.edge} bottom border, not 2px`;
  if ((await js("document.querySelector('[data-shortcuts-sheet]')?.getAttribute('role')")) !== 'dialog') return 'the sheet is not a dialog';
  for (const colorScheme of ['light', 'dark'] as const) {
    await setColorScheme(win, colorScheme);
    if (!(await js(`!!document.querySelector('[data-shortcut-row="palette.commands"]')`))) return `the sheet lost its rows in ${colorScheme} mode`;
    await shot(win, `shortcuts-${colorScheme}.png`);
  }

  await setFieldValue(win, '[data-shortcut-filter]', 'terminal');
  if (!(await waitInPage(win, `${SHEET_ROWS}.includes('terminal.toggle') && !${SHEET_ROWS}.includes('session.new')`, 2_000))) return `"terminal" left ${String(await js(SHEET_ROWS))}`;
  const strays = (await js(
    "[...document.querySelectorAll('[data-shortcut-row]')].filter((el) => !el.innerText.toLowerCase().includes('terminal')).map((el) => el.dataset.shortcutRow)",
  )) as string[];
  if (strays.length) return `"terminal" kept rows without it: ${strays.join(', ')}`;
  await shot(win, 'shortcuts-filter.png');

  await setFieldValue(win, '[data-shortcut-filter]', '');
  const terminalBefore = await js("!!document.querySelector('[data-terminal-panel], section[aria-label=\"Terminal\"]')");
  pressKey(win, 'J', ['meta']);
  const typed = process.platform === 'darwin' ? '⌘J' : 'Ctrl+J';
  if (!(await waitInPage(win, `document.querySelector('[data-shortcut-filter]').value === ${JSON.stringify(typed)} && ${SHEET_ROWS}.join() === 'terminal.toggle'`, 2_000))) {
    return `⌘J in the filter typed ${String(await js("document.querySelector('[data-shortcut-filter]').value"))} and left ${String(await js(SHEET_ROWS))}`;
  }
  if ((await js("!!document.querySelector('[data-terminal-panel], section[aria-label=\"Terminal\"]')")) !== terminalBefore) return '⌘J in the filter also toggled the terminal';

  pressKey(win, '/', ['meta']);
  if (!(await waitInPage(win, `!${SHEET}`, 2_000))) return '⌘/ did not close the sheet';

  // At Home: All fades Stop Claude, Here hides it.
  pressKey(win, 'H', ['meta', 'shift']);
  if (!(await waitInPage(win, "!document.querySelector('[data-current-session]')", 3_000))) return '⌘⇧H did not go Home';
  if (!(await open())) return '⌘/ did not open the sheet at Home';
  if ((await js("document.querySelector('[data-shortcut-row=\"claude.stop\"]')?.dataset.available")) !== 'false') return 'Stop Claude was not faded at Home in All';
  if ((await js("document.querySelector('[data-shortcut-row=\"composer.send-now\"]')?.dataset.available")) !== 'false') return 'Send now was missing or not faded at Home in All';
  await js("document.querySelector('[data-shortcut-mode-option=\"here\"]').click()");
  if (!(await waitInPage(win, `${SHEET}?.dataset.shortcutMode === 'here' && !document.querySelector('[data-shortcut-row="claude.stop"]')`, 2_000))) return 'Here still showed Stop Claude at Home';
  if (!(await js("!!document.querySelector('[data-shortcut-row=\"session.new\"]')"))) return 'Here hid New session at Home';
  await js("document.querySelector('[data-shortcut-mode-option=\"all\"]').click()");

  // Esc closes, and focus goes back to where it was.
  await js("document.querySelector('[data-shortcuts-sheet]') && document.querySelector('[data-shortcut-filter]').focus()");
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, `!${SHEET}`, 2_000))) return 'Esc did not close the sheet';
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"] textarea[data-composer]')`, 5_000))) return 'could not reopen the session';
  await js("document.querySelector('textarea[data-composer]').focus()");
  if (!(await open())) return '⌘/ did not open the sheet again';
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, `!${SHEET} && document.activeElement?.matches('textarea[data-composer]')`, 2_000))) return `Esc did not put focus back in the message box (${String(await js('document.activeElement?.outerHTML.slice(0, 80)'))})`;
  return 'ok: ⌘/ opens it from the message box with Command palette ⌘ K (light and dark), "terminal" filters, ⌘J is typed not run, ⌘/ closes, Stop Claude and Send now fade at Home, Here hides Stop Claude there, Esc closes and gives focus back';
}

/**
 * New session from the palette, starting nothing: New session… lists the projects, the first one opens
 * the prompt step (route, prompt, chips, Start), which takes a pasted image and shows a drop target;
 * Esc closes it and keeps the draft; clicking the project goes back to the projects and the draft moves
 * to the one picked next; ⌫ in an empty prompt goes back to the projects. Needs a project (run while the projects step has one added).
 */
async function runPaletteNewSessionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const draft = 'Smoke test draft: never started';
  const sessionsBefore = (await js("document.querySelectorAll('[data-session-id]').length")) as number;
  const viewBefore = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? (document.querySelector('[data-new-session-view]') ? 'new' : 'home')")) as string;
  let project: string | null = null;
  const toPrompt = async (): Promise<string | null> => {
    if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return '⌘K did not open the commands';
    await setFieldValue(win, '[data-palette-input]', 'new session');
    if (!(await waitInPage(win, "document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand === 'new-session'", 2_000))) return '"new session" did not rank New session… first';
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `${PALETTE_STEP} === 'projects' && document.querySelector('[data-command-palette] [data-palette-chips]') && document.querySelector('[data-palette-project]')`, 3_000))) return 'New session… did not list the projects';
    project = (await js("document.querySelector('[data-palette-project]').dataset.paletteProject")) as string;
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `${PALETTE_STEP} === 'prompt' && document.activeElement?.matches('[data-palette-prompt]')`, 3_000))) return 'picking a project did not show the prompt step';
    return null;
  };

  let failure = await toPrompt();
  if (failure) return (await closePalette(win), failure);
  const parts = (await js(
    `({ project: document.querySelector('[data-palette-route-project]')?.dataset.paletteRouteProject ?? null, chips: !!document.querySelector('[data-command-palette] [data-palette-model-select]') && !!document.querySelector('[data-command-palette] [data-palette-mode-select]'), start: !!document.querySelector('[data-palette-start]'), width: Math.round(document.querySelector('[data-command-palette]').getBoundingClientRect().width) })`,
  )) as { project: string | null; chips: boolean; start: boolean; width: number };
  if (parts.project !== project || !parts.chips || !parts.start) return (await closePalette(win), `the prompt step is missing parts: ${JSON.stringify(parts)}`);
  // The step shares New session's unsent prompt for the project, which an earlier step may have left: start empty.
  await setFieldValue(win, '[data-palette-prompt]', '');
  await win.webContents.insertText(draft);
  if (!(await waitInPage(win, `document.querySelector('[data-palette-prompt]')?.value === ${JSON.stringify(draft)}`, 2_000))) return (await closePalette(win), 'typing in the prompt step did not stick');
  // Paste an image and hold a drag over the step, as in the message box; then remove the image again. Nothing is dropped.
  await js(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'smoke.png', { type: 'image/png' }));
    document.querySelector('[data-palette-prompt]').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  if (!(await waitInPage(win, "document.querySelector('[data-command-palette] [data-attachments] img')", 2_000))) return (await closePalette(win), 'pasting an image in the prompt step did not attach it');
  const dropState = (await js(`(async () => {
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'smoke.png', { type: 'image/png' }));
    const prompt = document.querySelector('[data-palette-prompt]');
    const read = () => document.querySelector('[data-command-palette] [data-drop-overlay]')?.dataset.dropState ?? 'none';
    // Held like a real drag (dragover every 50ms), or the overlay times out before it is read (see runDropStep).
    prompt.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
    const over = () => prompt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    over();
    const hold = setInterval(over, 50);
    const end = performance.now() + 2000;
    while (performance.now() < end && read() !== 'ok') await new Promise((resolve) => setTimeout(resolve, 20));
    const state = read();
    clearInterval(hold);
    window.dispatchEvent(new DragEvent('dragend'));
    return state;
  })()`)) as string;
  if (dropState !== 'ok') return (await closePalette(win), `dragging an image over the prompt step showed ${dropState}, not the drop target`);
  if (!(await waitInPage(win, "!document.querySelector('[data-command-palette] [data-drop-overlay]')", 1_000))) return (await closePalette(win), 'the prompt step kept the drop target after the drag ended');
  await js("document.querySelector('[data-command-palette] [data-attachments] button').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-command-palette] [data-attachments]')", 1_000))) return (await closePalette(win), 'removing the pasted image did not work');
  await shot(win, 'command-palette-prompt.png');
  if (!(await closePalette(win))) return 'Esc did not close the prompt step';

  const sessionsAfter = (await js("document.querySelectorAll('[data-session-id]').length")) as number;
  const viewAfter = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? (document.querySelector('[data-new-session-view]') ? 'new' : 'home')")) as string;
  if (sessionsAfter !== sessionsBefore || viewAfter !== viewBefore) return `closing the prompt step started something (${sessionsBefore} → ${sessionsAfter} sessions, ${viewBefore} → ${viewAfter})`;

  failure = await toPrompt();
  if (failure) return (await closePalette(win), `again: ${failure}`);
  const kept = (await js("document.querySelector('[data-palette-prompt]')?.value")) as string;
  // Change the project from the route: back to the list, then the next project (or the same one) takes the draft.
  await js("document.querySelector('[data-palette-route-project]')?.click()");
  const changed = await waitInPage(win, `${PALETTE_STEP} === 'projects' && document.activeElement?.matches('[data-palette-input]')`, 2_000);
  if (!changed) return (await closePalette(win), 'clicking the project did not go back to the projects');
  const others = (await js("document.querySelectorAll('[data-palette-project]').length")) as number;
  if (others > 1) pressKey(win, 'Down');
  pressKey(win, 'Return');
  if (!(await waitInPage(win, `${PALETTE_STEP} === 'prompt' && document.activeElement?.matches('[data-palette-prompt]')`, 3_000))) return (await closePalette(win), 'picking another project did not show the prompt step');
  const moved = (await js("({ project: document.querySelector('[data-palette-route-project]')?.dataset.paletteRouteProject ?? null, text: document.querySelector('[data-palette-prompt]')?.value })")) as { project: string | null; text: string };
  if (moved.text !== draft) return (await closePalette(win), `the draft did not move to the other project (${JSON.stringify(moved.text)})`);
  if (others > 1 && moved.project === project) return (await closePalette(win), 'picking the next project kept the same one');
  await setFieldValue(win, '[data-palette-prompt]', '');
  await settle(win);
  pressKey(win, 'Backspace');
  const wentBack = await waitInPage(win, `${PALETTE_STEP} === 'projects' && document.activeElement?.matches('[data-palette-input]')`, 2_000);
  await closePalette(win);
  if (kept !== draft) return `Esc did not keep the draft (${JSON.stringify(kept)})`;
  if (!wentBack) return '⌫ in the empty prompt did not go back to the projects';
  return `ok: New session… listed the projects, ${String(project).split('/').pop()} opened the prompt step (${parts.width}px) with its route, chips and Start; a pasted image attached and a drag showed the drop target; Esc kept the draft and started nothing; clicking the project went back and the draft moved${others > 1 ? ' to another project' : ''}; ⌫ went back`;
}

/** In the terminal, ⌘K clears the screen and the palette stays closed; ⌘⇧P opens the palette from there. */
async function runTerminalClearStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[data-terminal] textarea')", 5_000))) return 'the terminal did not open';
  await settle(win);
  await js("document.querySelector('[data-terminal] textarea').focus()");
  const cleared = "Number(document.activeElement?.closest('[data-terminal]')?.dataset.cleared ?? 0)";
  const before = (await js(cleared)) as number;
  pressKey(win, 'K', ['meta']);
  const didClear = await waitInPage(win, `${cleared} > ${before}`, 2_000);
  // The palette would open on the same key press: a settled page shows whether it did.
  await settle(win);
  const paletteOpened = (await js("!!document.querySelector('[data-command-palette]')")) as boolean;
  if (paletteOpened) await closePalette(win);
  pressKey(win, 'P', ['meta', 'shift']);
  const opened = await waitInPage(win, `${PALETTE_MODE} === 'commands'`, 2_000);
  if (opened) await closePalette(win);
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  if (!didClear) return '⌘K in the terminal did not clear it';
  if (paletteOpened) return '⌘K in the terminal opened the palette';
  if (!opened) return '⌘⇧P in the terminal did not open the palette';
  return 'ok: ⌘K cleared the terminal without opening the palette; ⌘⇧P opened it from there';
}

/** The Tools window: MCP servers, skills, agents and plugins for the session's folder (a prompt-less helper answers). */
async function runToolsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-open-tools]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-capabilities]') && !document.querySelector('[data-capabilities]').innerText.includes('Asking Claude Code')", 30_000))) {
    return 'the Tools window did not load';
  }
  const counts = (await js(
    "Object.fromEntries([...document.querySelectorAll('[data-capabilities-tab]')].map((t) => [t.dataset.capabilitiesTab, Number(t.querySelector('span')?.innerText ?? 0)]))",
  )) as Record<string, number>;
  await shot(win, 'tools.png');
  await js("document.querySelector('[data-capabilities-tab=\"commands\"]').click()");
  await shot(win, 'tools-commands.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await waitInPage(win, "!document.querySelector('[data-capabilities]')", 2_000);
  return `ok: ${counts.mcp} MCP servers, ${counts.commands} skills and commands, ${counts.agents} agents, ${counts.plugins} plugins`;
}

/** ⌥-click a second session: two panes; clicking one makes it active; closing one leaves the other. */
async function runSplitStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const active = () => js("document.querySelector('[data-pane-active=\"true\"]')?.dataset.pane ?? null") as Promise<string | null>;
  await js(
    `[...document.querySelectorAll('[data-session-id]')].find((row) => row.dataset.sessionId !== '${smokeSessionId}').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`,
  );
  if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 2", 5_000))) return '⌥-click did not open a second pane';
  if ((await active()) !== 'split') return 'the new pane is not the active one';
  await waitInPage(win, "document.querySelectorAll('[data-transcript-item]').length > 0", 5_000);
  // The git split button stays in a narrow pane (on a git checkout, where the Changes button shows).
  const gitInEveryPane = "[...document.querySelectorAll('[data-current-session]')].every((pane) => !pane.querySelector('[data-toggle-changes]') || pane.querySelector('[data-git-button]'))";
  if (!(await waitInPage(win, gitInEveryPane, 3_000))) return 'no git button in a narrow pane';
  await shot(win, 'split.png');
  // Nothing may stick out past a pane's right edge (the composer and footer used to; the header's buttons could).
  const overflow = (await js(
    "[...document.querySelectorAll('[data-current-session]')].flatMap((pane) => { const edge = pane.getBoundingClientRect().right + 1; return [...pane.querySelectorAll('[data-composer-submit], [data-open-tools], [data-context-meter], [data-git-menu], [data-more-menu]')].filter((el) => el.getBoundingClientRect().right > edge).map((el) => el.dataset.composerSubmit !== undefined ? 'send' : el.dataset.openTools !== undefined ? 'tools' : el.dataset.gitMenu !== undefined ? 'git' : el.dataset.moreMenu !== undefined ? 'more' : 'context'); })",
  )) as string[];
  if (overflow.length) return `in split view these stick out of their pane: ${overflow.join(', ')}`;
  await js("document.querySelector('[data-pane=\"main\"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
  if (!(await waitInPage(win, "document.querySelector('[data-pane-active=\"true\"]')?.dataset.pane === 'main'", 2_000))) return 'clicking the left pane did not make it active';
  await js("document.querySelector('[data-pane=\"split\"] [data-close-pane]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-split]') && document.querySelector('[data-current-session]')", 2_000))) return 'closing the pane did not go back to one';
  // Closing the last session lands on Home; picking it in the sidebar opens it again.
  const remaining = (await js("document.querySelector('[data-current-session]').dataset.currentSession")) as string;
  await js("document.querySelector('[data-close-session]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-current-session]') && document.querySelector('[data-home], [data-onboarding]')", 2_000))) return 'closing the session did not land on Home';
  await js(`document.querySelector('[data-session-id="${remaining}"]').click()`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${remaining}"]')`, 3_000))) return 'could not reopen the closed session';
  return 'ok: ⌥-click opened a second pane, focus follows clicks, closing returns to one, closing that lands on New session';
}

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/**
 * Split view's layout. Two panes swap places by dragging a header onto the other (Esc cancels, a click doesn't
 * swap), by ⌘⇧X and from the palette, and no pane is remounted or moved in the DOM (each keeps its mark and
 * scroll). They stack one above the other and back (the layout buttons, ⌘⇧O), with nothing sticking out of a
 * pane, a terminal docked below a stacked pane leaving the message box room, and a window too short to stack
 * them shows them side by side again. Only the layout (kept in the throwaway profile) changes, and it is put back.
 */
async function runSplitLayoutStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const sessionIn = (pane: string) => js(`document.querySelector('[data-pane-slot="${pane}"] [data-current-session]')?.dataset.currentSession ?? null`) as Promise<string | null>;
  const box = (selector: string) =>
    js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; })()`) as Promise<Box | null>;
  const activePane = () => js("document.querySelector('[data-pane-active=\"true\"]')?.dataset.pane ?? null") as Promise<string | null>;
  const orientation = () => js("document.querySelector('[data-split]')?.dataset.splitOrientation ?? null") as Promise<string | null>;
  const domOrder = () => js("[...document.querySelectorAll('[data-current-session]')].map((el) => el.dataset.currentSession).join()") as Promise<string>;
  const shows = (value: string) => `document.querySelector('[data-split-orientation-toggle]')?.dataset.splitShown === '${value}'`;
  // Tags each pane's view and notes its scroll position: a remounted or moved view loses both.
  const mark = async () => {
    // Scrolled up a little, then left alone until the conversations stop moving (they open at their end).
    await js("for (const t of document.querySelectorAll('[data-current-session] [data-transcript]')) t.scrollTop = 30");
    await waitInPage(
      win,
      "(() => { const now = [...document.querySelectorAll('[data-current-session] [data-transcript]')].map((t) => t.scrollTop + '/' + t.scrollHeight).join(); const at = performance.now(); if (window.__smokeScroll?.now !== now) { window.__smokeScroll = { now, at }; return false; } return at - window.__smokeScroll.at > 500; })()",
      6_000,
    );
    await js("for (const view of document.querySelectorAll('[data-current-session]')) { view.dataset.smokeMark = view.dataset.currentSession; const t = view.querySelector('[data-transcript]'); if (t) view.dataset.smokeScroll = String(t.scrollHeight - t.scrollTop - t.clientHeight); }");
  };
  /** What changed in a pane since `mark()` (remounted, or how far its conversation is from the end), or an empty string when nothing did. */
  const changed = () =>
    js("[...document.querySelectorAll('[data-current-session]')].map((view) => { const t = view.querySelector('[data-transcript]'); return (view.dataset.smokeMark !== view.dataset.currentSession ? 'remounted' : '') + (String(t ? t.scrollHeight - t.scrollTop - t.clientHeight : '') !== (view.dataset.smokeScroll ?? '') ? 'scrolled, ' + view.dataset.smokeScroll + 'px from the end to ' + (t.scrollHeight - t.scrollTop - t.clientHeight) : ''); }).filter(Boolean).join('; ')") as Promise<string>;
  /** What sticks out of its pane, or overlaps: the header, the message box with its chips and Send, and the conversation above it. */
  const stickingOut = () =>
    js(`[...document.querySelectorAll('[data-current-session]')].flatMap((view) => {
      const pane = view.getBoundingClientRect(), header = view.querySelector('header').getBoundingClientRect(), found = [];
      const inside = (name, el) => { const b = el.getBoundingClientRect(); if (b.right > pane.right + 1 || b.bottom > pane.bottom + 1 || b.left < pane.left - 1 || b.top < pane.top - 1) found.push(name); return b; };
      for (const [name, selector] of [['header', 'header'], ['message box', '[data-composer]'], ['chips', '[data-composer-chips]'], ['Send', '[data-composer-submit]'], ['more menu', '[data-more-menu]']]) {
        const el = view.querySelector(selector);
        if (!el) continue;
        const b = inside(name, el);
        if (name !== 'header' && name !== 'more menu' && b.top < header.bottom - 1) found.push(name + ' under the header');
      }
      return found.map((what) => view.dataset.currentSession.slice(0, 8) + ': ' + what);
    })`) as Promise<string[]>;

  /** Presses on `from`'s title, drags to the middle of `to` and lets go ('drop'), presses Esc first ('escape'), or lets go in place ('click'). */
  const drag = async (from: 'main' | 'split', to: 'main' | 'split', finish: 'drop' | 'escape' | 'click', picture?: string): Promise<string | null> => {
    const handle = await box(`[data-pane-slot="${from}"] [data-pane-handle] h1`);
    const target = await box(`[data-pane-slot="${to}"]`);
    if (!handle || !target) return 'there is no header to drag or no pane to drop on';
    const start = { x: handle.left + 12, y: Math.round(handle.top + handle.height / 2) };
    const end = { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) };
    win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    let problem: string | null = null;
    if (finish !== 'click') {
      for (let i = 1; i <= 6; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + Math.round(((end.x - start.x) * i) / 6), y: start.y + Math.round(((end.y - start.y) * i) / 6), button: 'left' });
      if (!(await waitInPage(win, `document.querySelector('[data-pane-drop-target="${to}"]')`, 2_000))) problem = 'no drop indicator showed over the other pane while dragging';
      else {
        const frame = (await js(`(() => { const el = document.querySelector('[data-pane-drop-target="${to}"]'); return { ring: getComputedStyle(el).boxShadow !== 'none', label: el.innerText.trim(), cursor: getComputedStyle(document.body).cursor }; })()`)) as { ring: boolean; label: string; cursor: string };
        if (!frame.ring || frame.label !== 'Swap panes') problem = `the drop indicator is wrong: ${JSON.stringify(frame)}`;
        if (picture) await shot(win, picture);
      }
    }
    if (finish === 'escape') pressKey(win, 'Escape');
    const up = finish === 'click' ? start : end;
    win.webContents.sendInputEvent({ type: 'mouseUp', x: up.x, y: up.y, button: 'left', clickCount: 1 });
    await settle(win);
    return problem;
  };
  const ended = "!document.querySelector('[data-pane-drop-target]') && !document.documentElement.hasAttribute('data-pane-dragging')";

  const firstView = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  if (!firstView || !smokeSessionId) return 'failed: no session open to split';
  await js(
    `[...document.querySelectorAll('[data-session-id]')].find((row) => row.dataset.sessionId !== '${smokeSessionId}').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`,
  );
  if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 2", 5_000))) return 'failed: ⌥-click did not open a second pane';
  await waitInPage(win, "document.querySelectorAll('[data-transcript-item]').length > 0", 5_000);
  const bounds = win.getBounds();
  let left = await sessionIn('main');
  let right = await sessionIn('split');
  if (!left || !right || left === right) return `failed: the panes show ${left} and ${right}`;
  const extra = left === smokeSessionId ? right : left;
  try {
    if ((await orientation()) !== 'side') return `failed: split view did not open side by side (${await orientation()})`;
    const region = (await js("getComputedStyle(document.querySelector('[data-pane-handle]')).getPropertyValue('-webkit-app-region')")) as string;
    if (region && region !== 'no-drag') return `failed: the header's handle is part of the window's drag region (${region}), which takes the mouse`;

    // Drag the left pane's header onto the right pane: they trade places, and the active pane stays with its session.
    await mark();
    const order = await domOrder();
    const dragged = await drag('main', 'split', 'drop', 'split-drag.png');
    if (dragged) return `failed: ${dragged}`;
    if (!(await waitInPage(win, `document.querySelector('[data-pane-slot="main"] [data-current-session="${right}"]') && document.querySelector('[data-pane-slot="split"] [data-current-session="${left}"]')`, 3_000))) {
      return 'failed: dragging a header onto the other pane did not swap them';
    }
    [left, right] = [right, left];
    const lost = await changed();
    if (lost || (await domOrder()) !== order) return `failed: the swap remounted or moved a pane (${lost || 'its place in the DOM changed'})`;
    const [one, two] = [await box('[data-pane-slot="main"]'), await box('[data-pane-slot="split"]')];
    if (!one || !two || one.left >= two.left) return 'failed: after the swap the first pane is not on the left';
    if ((await activePane()) !== 'split' || (await sessionIn('split')) !== right) return 'failed: the active pane did not stay with its session';
    if (!(await waitInPage(win, ended, 2_000))) return 'failed: the drag indicator stayed after the drop';

    // Esc cancels a drag; a click on the header, without moving, swaps nothing.
    const cancelled = await drag('main', 'split', 'escape');
    if (cancelled) return `failed: ${cancelled}`;
    if (!(await waitInPage(win, ended, 2_000)) || (await sessionIn('main')) !== left) return 'failed: Esc did not cancel the drag';
    const clicked = await drag('main', 'split', 'click');
    if (clicked || (await sessionIn('main')) !== left) return 'failed: a click on a header swapped the panes';

    // The keyboard and the palette do the same.
    pressKey(win, 'X', ['meta', 'shift']);
    if (!(await waitInPage(win, `document.querySelector('[data-pane-slot="main"] [data-current-session="${right}"]')`, 3_000))) return 'failed: ⌘⇧X did not swap the panes';
    [left, right] = [right, left];
    if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return 'failed: ⌘K did not open the palette';
    await setFieldValue(win, '[data-palette-input]', 'swap panes');
    if (!(await waitInPage(win, "document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand === 'swap-panes'", 3_000))) return 'failed: the palette does not put Swap panes first for "swap panes"';
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `!document.querySelector('[data-command-palette]') && document.querySelector('[data-pane-slot="main"] [data-current-session="${right}"]')`, 3_000))) return 'failed: Swap panes in the palette did not swap';
    [left, right] = [right, left];
    if (await changed()) return 'failed: swapping from the keyboard remounted a pane';

    // Stacked: one pane above the other, filling the area.
    const area = await box('[data-split]');
    let stacked = '';
    if (area && area.height >= 700) {
      const click = await clickLikeAUser(win, '[data-split-orientation-toggle]');
      if (!(await waitInPage(win, `document.querySelector('[data-split]')?.dataset.splitOrientation === 'stacked' && ${shows('stacked')}`, 3_000))) return `failed: Stacked did not stack the panes (the click landed on ${click.at})`;
      await settle(win);
      const [top, bottom] = [await box('[data-pane-slot="main"]'), await box('[data-pane-slot="split"]')];
      if (!top || !bottom || bottom.top < top.bottom - 1 || Math.abs(top.width - bottom.width) > 1 || top.height < 300 || bottom.height < 300) return `failed: the stacked panes are not one above the other (${JSON.stringify({ top, bottom })})`;
      const sticking = await stickingOut();
      if (sticking.length) return `failed: stacked, these stick out of their pane: ${sticking.join(', ')}`;
      await shot(win, 'split-stacked.png');
      // Drag works in rows too.
      await mark();
      const dragged2 = await drag('main', 'split', 'drop');
      if (dragged2) return `failed: stacked, ${dragged2}`;
      if (!(await waitInPage(win, `document.querySelector('[data-pane-slot="main"] [data-current-session="${right}"]') && document.querySelector('[data-pane-slot="split"] [data-current-session="${left}"]')`, 3_000))) return 'failed: stacked, dragging a header did not swap the panes';
      [left, right] = [right, left];
      const [first, second] = [await box('[data-pane-slot="main"]'), await box('[data-pane-slot="split"]')];
      if ((await changed()) || !first || !second || first.top >= second.top) return 'failed: stacked, the swap remounted a pane or left the first one below';
      // A terminal docked below a short pane leaves the conversation its room: the smoke session's panel, in its folder.
      const view = `[data-current-session="${smokeSessionId}"]`;
      await js(`document.querySelector('${view} [data-toggle-terminal]')?.click()`);
      if (!(await waitInPage(win, `document.querySelector('${view} [data-terminal-panel]')`, 3_000))) return 'failed: the terminal did not open in the stacked pane';
      await settle(win);
      const panel = await box(`${view} [data-terminal-panel]`);
      const pane = await box(view);
      const send = await box(`${view} [data-composer-submit]`);
      const transcript = await box(`${view} [data-transcript]`);
      if (!panel || !pane || !send || !transcript) return 'failed: no panel, message box or conversation in the stacked pane';
      if (panel.bottom > pane.bottom + 1 || send.bottom > panel.top + 1 || transcript.height < 40) return `failed: in a stacked pane the terminal pushes the message box out (${JSON.stringify({ pane, panel, send, transcript })})`;
      await shot(win, 'split-stacked-terminal.png');
      const stuck = await stickingOut();
      if (stuck.length) return `failed: stacked with a terminal, these stick out of their pane: ${stuck.join(', ')}`;
      await js(`document.querySelector('${view} [data-terminal-panel] [data-terminal-tab-close]')?.click()`);
      if (!(await waitInPage(win, `!document.querySelector('${view} [data-terminal-panel]')`, 3_000))) return 'failed: closing the terminal tab did not hide the panel';

      // ⌘⇧O flips it back, and a window too short to stack them shows them side by side (the choice is kept).
      pressKey(win, 'O', ['meta', 'shift']);
      if (!(await waitInPage(win, `document.querySelector('[data-split]')?.dataset.splitOrientation === 'side' && ${shows('side')}`, 3_000))) return 'failed: ⌘⇧O did not put the panes side by side';
      pressKey(win, 'O', ['meta', 'shift']);
      if (!(await waitInPage(win, "document.querySelector('[data-split]')?.dataset.splitOrientation === 'stacked'", 3_000))) return 'failed: ⌘⇧O did not stack the panes';
      win.setContentSize(1280, 600);
      if (!(await waitInPage(win, `document.querySelector('[data-split]')?.dataset.splitOrientation === 'side' && ${shows('side')} && document.querySelector('[data-split-orientation-toggle]').dataset.tooltip.includes('taller')`, 3_000))) {
        return 'failed: in a window too short to stack, the panes did not go side by side with a reason';
      }
      await settle(win);
      const short = await stickingOut();
      if (short.length) return `failed: in the small window these stick out of their pane: ${short.join(', ')}`;
      win.setBounds(bounds);
      if (!(await waitInPage(win, "document.querySelector('[data-split]')?.dataset.splitOrientation === 'stacked'", 3_000))) return 'failed: the stacked layout did not come back in the taller window';
      pressKey(win, 'O', ['meta', 'shift']);
      if (!(await waitInPage(win, `document.querySelector('[data-split]')?.dataset.splitOrientation === 'side'`, 3_000))) return 'failed: ⌘⇧O did not put the panes side by side again';
      stacked = ', stacked them (also with a terminal and in a window too short for it)';
    } else {
      stacked = `; the window is too short here (${area?.height}px) to check stacking`;
    }
    return `ok: dragged a header to swap the panes (Esc cancels, a click does not), swapped with ⌘⇧X and the palette without remounting${stacked}`;
  } finally {
    win.setBounds(bounds);
    // Put things back: side by side, one pane (the smoke session), a settled window.
    if ((await orientation()) === 'stacked') await js(`document.querySelector('[data-split-orientation-toggle]')?.click()`);
    await js(`document.querySelector('[data-current-session="${extra}"]')?.closest('[data-pane-slot]')?.querySelector('[data-close-pane]')?.click()`);
    await waitInPage(win, "!document.querySelector('[data-split]')", 2_000);
    await settle(win);
  }
}

/**
 * The app's own controls: drag the sidebar edge (clamped at both ends, double-click resets), a themed
 * tooltip on hover, and the pointer cursor on buttons. Only the throwaway profile's state changes, and
 * it is put back. The themed dropdown is checked in the projects step, on a throwaway project's defaults.
 */
async function runControlsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pause = () => settle(win);
  const center = async (selector: string) => (await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
  const width = () => js("Math.round(document.querySelector('[data-sidebar]').getBoundingClientRect().width)") as Promise<number>;
  const drag = async (dx: number) => {
    const { x, y } = await center('[data-sidebar-resize]');
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 5; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round((dx * i) / 5), y, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y, button: 'left', clickCount: 1 });
    await pause();
  };

  // Sidebar: wider, clamped at 520, narrower to its 240 minimum (further snaps to the rail: the sidebar
  // states step checks that), double-click back to 320.
  const start = await width();
  await drag(400);
  const widest = await width();
  await drag(-280);
  const narrowest = await width();
  // At the narrowest width, rows truncate instead of sticking out.
  const overflowing = (await js("(() => { const edge = document.querySelector('[data-sidebar]').getBoundingClientRect().right + 1; return [...document.querySelectorAll('[data-session-id]')].filter((row) => row.getBoundingClientRect().right > edge).length; })()")) as number;
  await shot(win, 'sidebar-narrow.png');
  const { x, y } = await center('[data-sidebar-resize]');
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 2 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 2 });
  await pause();
  const reset = await width();
  if (widest !== 520 || narrowest !== 240) return `sidebar resize not clamped: ${start} → ${widest} → ${narrowest}`;
  if (overflowing) return `${overflowing} sidebar rows stick out at the minimum width`;
  if (reset !== 320) return `double-click did not reset the sidebar (${reset}px)`;

  // Buttons show the pointer; the resize handle keeps its own cursor.
  const cursors = (await js("({ button: getComputedStyle(document.querySelector('[data-new-session]')).cursor, handle: getComputedStyle(document.querySelector('[data-sidebar-resize]')).cursor })")) as { button: string; handle: string };
  if (cursors.button !== 'pointer' || cursors.handle !== 'col-resize') return `cursors: ${JSON.stringify(cursors)}`;

  // Tooltip on hover. The layer drops a tooltip that is waiting to show on a scroll around it, a key, a
  // click or the window losing focus, so note those to say why it didn't show. The conversation scrolls
  // to its end after the resize above, which must not count.
  await js(
    "(() => { const seen = []; const stop = new AbortController(); window.__smokeTooltipWatch = { seen, stop }; const opts = { capture: true, signal: stop.signal }; const name = (t) => !t || t === document ? 'document' : t.tagName + Object.keys(t.dataset ?? {}).map((k) => '[data-' + k + ']').join(''); for (const type of ['scroll', 'keydown', 'pointerdown']) document.addEventListener(type, (e) => seen.push(type + ' on ' + name(e.target)), opts); window.addEventListener('blur', () => seen.push('window blur'), { signal: stop.signal }); document.addEventListener('mouseout', (e) => e.relatedTarget === null && seen.push('pointer left the window'), { signal: stop.signal }); })()",
  );
  const tip = await center('[data-new-session]');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: tip.x, y: tip.y });
  const tooltip = await waitInPage(win, "document.querySelector('[data-tooltip-layer]')?.innerText.includes('New session')", 2_000);
  const under = (await js(
    `(() => { const watch = window.__smokeTooltipWatch; watch.stop.abort(); delete window.__smokeTooltipWatch; const el = document.elementFromPoint(${tip.x}, ${tip.y}); return { at: el ? el.tagName + (el.closest('[data-new-session]') ? ' in the button' : '') : 'nothing', layer: document.querySelector('[data-tooltip-layer]')?.innerText ?? null, events: [...new Set(watch.seen)] }; })()`,
  )) as { at: string; layer: string | null; events: string[] };
  win.webContents.sendInputEvent({ type: 'mouseMove', x: tip.x + 400, y: tip.y + 300 });
  if (!tooltip) return `no themed tooltip on the New session button (${JSON.stringify(under)})`;

  // Tab that picks a slash command stays in the message box: it must not turn on the keyboard focus ring.
  // Picking only fills in the text; the box is emptied again and nothing is sent.
  let slashTab = '';
  if (await js("!!document.querySelector('[data-composer]')")) {
    await js("document.documentElement.removeAttribute('data-keyboard-nav'); document.querySelector('[data-composer]').focus()");
    await win.webContents.insertText('/');
    if (!(await waitInPage(win, "document.querySelector('[data-palette] [role=option]')", 15_000))) return 'slash palette did not open';
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await pause();
    const after = (await js("({ value: document.querySelector('[data-composer]').value, ring: document.documentElement.hasAttribute('data-keyboard-nav'), focused: document.activeElement?.matches('[data-composer]') ?? false })")) as { value: string; ring: boolean; focused: boolean };
    win.webContents.selectAll();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    await pause();
    if (!after.value.startsWith('/') || after.value === '/') return `Tab did not pick a slash command (${JSON.stringify(after.value)})`;
    if (!after.focused) return 'Tab on a slash command moved focus out of the message box';
    if (after.ring) return 'Tab on a slash command turned on the keyboard focus ring';
    slashTab = ', Tab picks a slash command without a focus ring';
  }

  if (smokeSessionId) await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  const scrolledElsewhere = under.events.some((event) => event.startsWith('scroll')) ? ' (through a scroll elsewhere)' : '';
  return `ok: sidebar ${start} → ${widest} → ${narrowest} → ${reset}px, pointer cursors, themed tooltip${scrolledElsewhere}${slashTab}`;
}

/**
 * The sidebar's three states: ⌘B goes to the minimal rail and back; with "When collapsed" set to Hidden
 * it closes (the session view takes the whole window) and reopens; dragging the edge snaps to the rail
 * and back open; ⌃⇥ moves to another session and ⌃⇧⇥ back, with the HUD while the rail shows. The rail
 * and the closed header are captured in light and dark. Only the throwaway profile's preferences and
 * sidebar state change, and they are put back.
 */
async function runSidebarStatesStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // Preferences reach the page over IPC; anything else is waited for with settle (the sidebar animates its width).
  const pause = (ms?: number) => (ms ? new Promise((resolve) => setTimeout(resolve, ms)) : settle(win));
  const state = "document.querySelector('[data-sidebar]')?.dataset.sidebarState";
  const width = () => js("Math.round(document.querySelector('[data-sidebar]').getBoundingClientRect().width)") as Promise<number>;
  const inState = (name: string) => waitInPage(win, `${state} === '${name}'`, 2_000);
  const before = preferences.get();
  const restore = async () => {
    updatePreferences({ sidebarCollapsed: before.sidebarCollapsed, colorScheme: before.colorScheme });
    // From minimal or closed, ⌘B always opens.
    if ((await js(state)) !== 'open') pressKey(win, 'B', ['meta']);
    await waitInPage(win, `${state} === 'open'`, 2_000);
    if (smokeSessionId) await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  };
  const themed = async (name: string) => {
    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(win, scheme);
      await shot(win, `${name}-${scheme}.png`);
    }
    updatePreferences({ colorScheme: before.colorScheme });
  };

  if (!(await inState('open'))) return `the sidebar did not start open (${String(await js(state))})`;
  if (!(await js("!!document.querySelector('[data-current-session] [data-sidebar-toggle]')"))) return 'no sidebar toggle in the session header';
  const openWidth = await width();

  // ⌘B: open → minimal → open, with "When collapsed" on the rail.
  updatePreferences({ sidebarCollapsed: 'minimal' });
  await pause(100);
  pressKey(win, 'B', ['meta']);
  if (!(await inState('minimal'))) return '⌘B did not minimize the sidebar';
  if (!(await waitInPage(win, "document.querySelector('[data-sidebar-rail] [data-sidebar-rail-row]')", 2_000))) return 'the rail lists no sessions';
  await pause();
  if ((await width()) !== 80) return `the rail is ${await width()}px wide, not 80`;
  const railLabel = (await js("document.querySelector('[data-sidebar-rail-row]').getAttribute('aria-label')")) as string;
  if (!railLabel) return 'a rail row has no accessible name';
  await themed('sidebar-minimal');

  // ⌃⇥ and ⌃⇧⇥ walk the rail's order; the HUD says where you landed.
  await js("document.querySelector('[data-sidebar-rail-row]').click()");
  const first = (await js("document.querySelector('[data-sidebar-rail-row]').dataset.sidebarRailRow")) as string;
  await waitInPage(win, `document.querySelector('[data-current-session="${first}"]')`, 3_000);
  const rows = (await js("document.querySelectorAll('[data-sidebar-rail-row]').length")) as number;
  let navigation = 'only one session, so ⌃⇥ was not checked';
  if (rows > 1) {
    pressKey(win, 'Tab', ['control']);
    if (!(await waitInPage(win, `document.querySelector('[data-current-session]') && !document.querySelector('[data-current-session="${first}"]')`, 3_000))) return '⌃⇥ did not move to another session';
    if (!(await waitInPage(win, "document.querySelector('[data-session-hud]')", 1_000))) return 'no HUD after ⌃⇥ with the rail showing';
    pressKey(win, 'Tab', ['control', 'shift']);
    if (!(await waitInPage(win, `document.querySelector('[data-current-session="${first}"]')`, 3_000))) return '⌃⇧⇥ did not go back to the first session';
    navigation = '⌃⇥ moved on and ⌃⇧⇥ back, with the HUD';
  }
  pressKey(win, 'B', ['meta']);
  if (!(await inState('open'))) return '⌘B did not open the sidebar again';
  await pause();
  if ((await width()) !== openWidth) return `the open width was not kept (${openWidth} → ${await width()}px)`;

  // Hidden: ⌘B closes it; the session view takes the whole window.
  updatePreferences({ sidebarCollapsed: 'closed' });
  await pause(100);
  pressKey(win, 'B', ['meta']);
  if (!(await inState('closed'))) return '⌘B did not close the sidebar with "When collapsed" set to Hidden';
  await pause();
  const fullWidth = (await js(
    "(() => { const view = document.querySelector('[data-current-session]').getBoundingClientRect(); return Math.round(view.left) === 0 && Math.round(view.width) === window.innerWidth && !document.querySelector('[data-sidebar-open], [data-sidebar-rail]'); })()",
  )) as boolean;
  if (!fullWidth) return 'the session view is not full width with the sidebar closed';
  // The toggle moves right of the traffic lights (macOS); elsewhere the window's buttons are in its title bar, and it stays at the edge.
  const toggleLeft = (await js("document.querySelector('[data-current-session] [data-sidebar-toggle]').getBoundingClientRect().left")) as number;
  if (process.platform === 'darwin' ? toggleLeft < 72 : toggleLeft > 32) return `the toggle sits at ${Math.round(toggleLeft)}px, ${process.platform === 'darwin' ? 'under the traffic lights' : 'away from the edge'}`;
  await themed('sidebar-closed');
  await js("document.querySelector('[data-current-session] [data-sidebar-toggle]').click()");
  if (!(await inState('open'))) return 'the header toggle did not reopen the sidebar';
  await pause();

  // Drag the edge into the rail's zone, then back out past 200: it snaps to minimal, then open.
  const edge = (await js("(() => { const r = document.querySelector('[data-sidebar-resize]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()")) as { x: number; y: number };
  const drag = async (from: number, to: number) => {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: from, y: edge.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 5; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from + ((to - from) * i) / 5), y: edge.y, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: to, y: edge.y, button: 'left', clickCount: 1 });
    await pause();
  };
  await drag(edge.x, 150);
  if (!(await inState('minimal'))) return `dragging the edge to 150px did not snap to the rail (${String(await js(state))})`;
  await drag(80, 260);
  if (!(await inState('open'))) return `dragging the rail's edge past 200px did not open the sidebar (${String(await js(state))})`;
  const reopened = await width();
  await restore();
  return `ok: ⌘B open → minimal (80px rail) → open at ${openWidth}px, Hidden closes it with a full-width session view, the toggle reopens it, the edge snaps to the rail and back open (${reopened}px), ${navigation}, both themes captured`;
}

/**
 * Dragging images over a session shows a drop target on the message box; other files offer an @ mention. Synthetic drag events only:
 * nothing is dropped, so nothing is attached or sent.
 */
async function runDropStep(win: BrowserWindow): Promise<string> {
  if (smokeSessionId) await win.webContents.executeJavaScript(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  const view = smokeSessionId ? `document.querySelector('[data-current-session=${JSON.stringify(smokeSessionId)}]')` : "document.querySelector('[data-current-session]')";
  if (!(await waitInPage(win, `${view}?.querySelector('[data-composer]') && !document.querySelector('[data-drop-overlay]')`, 5_000))) return 'no session view to drag onto';
  const report = (await win.webContents.executeJavaScript(`(async () => {
    const view = document.querySelector('[data-current-session]');
    const overlay = () => { const el = view.querySelector('[data-drop-overlay]'); return el ? el.dataset.dropState + (Number(el.dataset.dropMention) > 0 ? '+mention' : '') + (el.dataset.dropOver === 'true' ? '+over' : '') : 'none'; };
    const drag = (type, target, extra = {}) => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'smoke', { type }));
      const event = new DragEvent(extra.kind ?? 'dragover', { bubbles: true, cancelable: true, dataTransfer: data, relatedTarget: extra.relatedTarget ?? null });
      target.dispatchEvent(event);
    };
    // A real drag fires dragover every few dozen milliseconds, and the overlay goes when they stop (STALE_MS in
    // useDropTarget): hold one over the target like that while waiting for the overlay, instead of one event and a sleep.
    let hold;
    const enter = (type, target) => {
      clearInterval(hold);
      drag(type, target, { kind: 'dragenter' });
      drag(type, target);
      hold = setInterval(() => drag(type, target), 50);
    };
    const release = () => clearInterval(hold);
    const reach = async (want) => {
      const end = performance.now() + 2000;
      while (performance.now() < end && overlay() !== want) await new Promise((resolve) => setTimeout(resolve, 20));
      return overlay();
    };
    const transcript = view.querySelector('[data-transcript]');
    const composer = view.querySelector('[data-composer]');
    const steps = [];
    enter('image/png', transcript);
    steps.push(await reach('ok'));
    enter('image/png', composer);
    steps.push(await reach('ok+over'));
    release();
    drag('image/png', composer, { kind: 'dragleave', relatedTarget: document.querySelector('[data-sidebar]') ?? document.body });
    steps.push(await reach('none'));
    enter('application/pdf', transcript);
    steps.push(await reach('ok+mention'));
    release();
    window.dispatchEvent(new DragEvent('dragend'));
    steps.push(await reach('none'));
    return steps;
  })()`)) as string[];
  // dropEffect can't be read back from synthetic events (it only sticks during a real drag), so this checks the overlay.
  // A PDF can't be attached; it would be mentioned as @path instead.
  const expected = ['ok', 'ok+over', 'none', 'ok+mention', 'none'];
  if (report.join(' ') !== expected.join(' ')) return `drop target went ${report.join(' → ')} (expected ${expected.join(' → ')})`;
  // Hold a drag over the message box for the screenshot, then end it.
  await win.webContents.executeJavaScript(`(() => {
    const composer = document.querySelector('[data-current-session] [data-composer]');
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'smoke.png', { type: 'image/png' }));
    composer.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
    window.__smokeDrag = setInterval(() => composer.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })), 50);
  })()`);
  if (!(await waitInPage(win, "document.querySelector('[data-drop-overlay]')", 1_000))) return 'no overlay while a drag is held over the message box';
  await shot(win, 'drop-target.png');
  await win.webContents.executeJavaScript("clearInterval(window.__smokeDrag); window.dispatchEvent(new DragEvent('dragend'))");
  if (!(await waitInPage(win, "!document.querySelector('[data-drop-overlay]')", 1_000))) return 'the overlay stayed after the drag ended';
  return 'ok: overlay on enter, stronger over the message box, gone on leave, offers to mention a PDF, cleared on dragend';
}

/**
 * Prompt history: in a session with a message you sent, ↑ in the message box brings it back and ↓ puts
 * the draft back. Only the box's text changes, and it is emptied again; nothing is sent.
 */
/**
 * Read-only part of Send now, on the smoke session (not running here): the message box has its plain Send
 * button, with no Queue ▾, and the hint doesn't offer ⌘⇧↩. The live step sends one for real in the sandbox.
 */
async function runSendNowStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pane = `[data-current-session="${smokeSessionId}"]`;
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  if (!(await waitInPage(win, `document.querySelector('${pane} [data-composer-submit]')`, 5_000))) return 'no submit button in the smoke session';
  if (await js(`!!document.querySelector('${pane} [data-send-menu]')`)) return 'Queue ▾ shown for a session that is not working';
  const label = ((await js(`document.querySelector('${pane} [data-composer-submit]').innerText`)) as string).trim();
  if (label === 'Queue') return 'the button says Queue for a session that is not working';
  const hint = (await js(`document.querySelector('${pane} textarea[data-composer]').placeholder`)) as string;
  if (hint.includes('sends it now')) return `the placeholder offers Send now while idle: ${JSON.stringify(hint)}`;
  return `ok: plain ${JSON.stringify(label)} button, no Queue ▾ while Claude isn't working`;
}

/**
 * Side questions (/btw) in the smoke session, answered by the engine's stub (SWITCHBOARD_STUB_BTW), so no model is
 * called and nothing reaches the session: the transcript and Up next must not change. It asks with the Ask button,
 * never Enter, so a broken token could never send the question as a message.
 */
async function runSideQuestionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pause = () => settle(win);
  const pane = '[data-current-session]';
  const box = `document.querySelector('${pane} [data-composer]')`;
  const has = (selector: string) => `!!document.querySelector('${pane} ${selector}')`;
  const press = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const running = await runningSessions();
  if (!running) return 'could not ask the engine which sessions are running, so none is safe to type in';
  if (!smokeSessionId || running.ids.has(smokeSessionId)) return 'ok: skipped, no idle smoke session to ask in';
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  if (!(await waitInPage(win, `${box} && !${box}.disabled && ${box}.value === ''`, 5_000))) return 'the smoke session has no empty message box';
  const transcript = `document.querySelectorAll('${pane} [data-transcript-item]').length`;
  const before = (await js(transcript)) as number;
  const typeToken = async (question: string) => {
    await js(`${box}.focus()`);
    await win.webContents.insertText(`/btw ${question}`);
    return waitInPage(win, `${has('[data-btw-token]')} && ${box}.value === ${JSON.stringify(question)} && ${has('[data-composer-ask]')} && !${has('[data-composer-submit]')}`, 2_000);
  };
  const ask = async () => {
    // Only with the token in place: Ask is the only button then, and it never sends a message.
    if (!(await js(`${has('[data-btw-token]')} && ${has('[data-composer-ask]')}`))) return false;
    await js(`document.querySelector('${pane} [data-composer-ask]').click()`);
    return true;
  };
  const position = () => js(`document.querySelector('${pane} [data-btw-position]')?.textContent?.trim() ?? ''`) as Promise<string>;
  const fail = async (why: string) => {
    await js(`document.querySelector('${pane} [data-btw-close]')?.click()`);
    return why;
  };

  // The slash menu offers /btw first for /b.
  await js(`${box}.focus()`);
  await win.webContents.insertText('/b');
  if (!(await waitInPage(win, `document.querySelector('${pane} [data-palette] [role=option]')?.textContent?.startsWith('/btw')`, 3_000))) return 'the slash menu did not offer /btw first for /b';
  press('Escape');
  press('Backspace');
  press('Backspace');
  if (!(await waitInPage(win, `${box}.value === ''`, 1_000))) return 'could not empty the message box after /b';

  // The token, and Backspace taking it out.
  if (!(await typeToken(''))) return '"/btw " did not become the token with Ask in place of Send';
  const blue = (await js(`!!document.querySelector('${pane} [data-side-question]')`)) as boolean;
  press('Backspace');
  if (!(await waitInPage(win, `!${has('[data-btw-token]')} && ${has('[data-composer-submit]')}`, 1_000))) return 'Backspace on an empty question did not take the token out';
  if (!blue) return 'the message box did not get the side question frame';

  // A bare /btw before any was asked: how to ask one.
  await typeToken('');
  await ask();
  if (!(await waitInPage(win, `document.querySelector('${pane} [data-btw-panel]')?.dataset.btwPanel === 'usage'`, 2_000))) return 'a bare /btw did not show how to ask one';
  if (await js(has('[data-btw-copy], [data-btw-prev]'))) return await fail('the usage panel has Copy or the arrows');
  await js(`document.querySelector('${pane} [data-btw-close]').click()`);

  // Ask, and the stubbed answer shows in the panel.
  if (!(await typeToken('Which flag did we use for the beta publish?'))) return 'could not type a side question';
  await ask();
  if (!(await waitInPage(win, `document.querySelector('${pane} [data-btw-answer="done"]')?.textContent?.includes('--cleanStart')`, 10_000))) return await fail('the side answer did not come in');
  if (((await js(`${box}.value`)) as string) !== '' || (await js(has('[data-btw-token]')))) return await fail('the message box kept the question or the token after asking');
  await pause();

  // A second one, hidden with Esc while it answers: the chip says so, and brings it back once it is ready.
  await typeToken('What changed since the last commit?');
  await ask();
  if (!(await waitInPage(win, has('[data-btw-answering]'), 3_000))) return await fail('no Answering while the second answer came in');
  await js(`${box}.focus()`);
  press('Escape');
  if (!(await waitInPage(win, `!${has('[data-btw-panel]')} && document.querySelector('${pane} [data-btw-chip]')?.dataset.btwChip === 'answering'`, 2_000)))
    return await fail('Esc did not hide the panel and leave an Answering chip');
  if (!(await waitInPage(win, `document.querySelector('${pane} [data-btw-chip]')?.dataset.btwChip === 'done'`, 10_000))) return 'the chip did not say the side answer was ready';
  await js(`document.querySelector('${pane} [data-btw-chip]').click()`);
  if (!(await waitInPage(win, `document.querySelector('${pane} [data-btw-answer="done"]')?.textContent?.includes('scheduler') && !${has('[data-btw-chip]')}`, 2_000))) return await fail('the chip did not bring the answer back');

  // ‹ › move through them, Copy copies.
  const last = await position();
  await js(`document.querySelector('${pane} [data-btw-prev]').click()`);
  await pause();
  const first = await position();
  await js(`document.querySelector('${pane} [data-btw-next]').click()`);
  await pause();
  const back = await position();
  await js(`document.querySelector('${pane} [data-btw-copy]').click()`);
  const copied = await waitInPage(win, `document.querySelector('${pane} [data-btw-copy]')?.dataset.btwCopy === 'copied'`, 2_000);
  await js(`document.querySelector('${pane} [data-btw-close]').click()`);
  if (last !== '2 of 2' || first !== '1 of 2' || back !== '2 of 2') return `‹ › went ${last} → ${first} → ${back}`;
  if (!copied) return 'Copy did not say Copied';

  // A bare /btw now opens the latest one.
  await typeToken('');
  await ask();
  const latest = (await waitInPage(win, `document.querySelector('${pane} [data-btw-panel]')?.dataset.btwPanel === 'item'`, 2_000)) && (await position()) === '2 of 2';
  await js(`document.querySelector('${pane} [data-btw-close]')?.click()`);
  if (!latest) return 'a bare /btw did not open the latest side question';

  const after = (await js(transcript)) as number;
  if (after !== before) return `the transcript changed: ${before} items, then ${after}`;
  if (await js(has('[data-queue-item]'))) return 'a side question went into Up next';
  return `ok: /btw first for /b, token and Backspace, usage, two answers (one hidden with Esc, back from the chip), ‹ › and Copy; transcript unchanged at ${before} items`;
}

async function runHistoryStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pause = () => settle(win);
  const box = "document.querySelector('[data-current-session] [data-composer]')";
  const press = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const ready = `${box} && !${box}.disabled && Number(${box}.dataset.history) > 0`;
  // The smoke session, or else one of the newest sessions with a message you sent, never one that is running.
  const running = await runningSessions();
  if (!running) return 'could not ask the engine which sessions are running, so none is safe to type in';
  const rows = (await js("[...document.querySelectorAll('[data-session-id]')].slice(0, 8).map((row) => row.dataset.sessionId)")) as string[];
  const candidates = [smokeSessionId, ...rows];
  let found = false;
  for (const id of candidates) {
    if (!id || running.ids.has(id)) continue;
    await js(`document.querySelector('[data-session-id="${id}"]')?.click()`);
    if (await waitInPage(win, ready, 3_000)) {
      found = true;
      break;
    }
  }
  if (!found) return 'no session with a sent message to recall';
  if (((await js(`${box}.value`)) as string) !== '') return 'the message box was not empty to start with';

  const draft = 'smoke draft, never sent';
  await js(`${box}.focus()`);
  await win.webContents.insertText(draft);
  await pause();
  // In your own text ↑ first takes the caret to the start of the box, as in any text field; the next ↑ steps.
  press('Up');
  const toStart = await waitInPage(win, `${box}.selectionStart === 0 && ${box}.value === ${JSON.stringify(draft)}`, 2_000);
  await pause();
  press('Up');
  const recalled = await waitInPage(win, `${box}.value !== ${JSON.stringify(draft)}`, 2_000);
  const afterUp = (await js(`({ value: ${box}.value, said: document.querySelector('[data-current-session] [data-history-announcer]')?.textContent ?? '', total: Number(${box}.dataset.history) })`)) as {
    value: string;
    said: string;
    total: number;
  };
  await pause();
  press('Down');
  const restored = await waitInPage(win, `${box}.value === ${JSON.stringify(draft)}`, 2_000);
  const afterDown = (await js(`({ value: ${box}.value, said: document.querySelector('[data-current-session] [data-history-announcer]')?.textContent ?? '' })`)) as { value: string; said: string };
  // Empty the box again, whatever happened above.
  await js(`${box}.focus()`);
  win.webContents.selectAll();
  press('Backspace');
  await pause();
  const left = (await js(`${box}.value`)) as string;
  if (smokeSessionId) await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);

  if (!toStart) return '↑ at the end of a draft did not take the caret to the start of the box first';
  if (!recalled || !afterUp.value.trim()) return '↑ at the start of the box did not bring back the last message';
  if (afterUp.said.trim() !== `Earlier message 1 of ${afterUp.total}`) return `↑ announced ${JSON.stringify(afterUp.said)}`;
  if (!restored) return `↓ did not put the draft back (${JSON.stringify(afterDown.value.slice(0, 60))})`;
  if (afterDown.said.trim() !== 'Back to your draft') return `↓ announced ${JSON.stringify(afterDown.said)}`;
  if (left !== '') return 'could not empty the message box afterwards';
  return `ok: ↑ brought back the last of ${afterUp.total} messages, ↓ put the draft back, nothing sent`;
}

/**
 * Right-click → Archive moves a session out of the main list, even one that's working (its updates
 * used to bring it straight back); "Unarchive" returns it. Flags live in the throwaway profile.
 */
async function runArchiveStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // Prefer a session that's working right now: that's the case that used to do nothing.
  const id = (await js(
    "(() => { const rows = [...document.querySelectorAll('[data-session-id]')]; const busy = rows.find((r) => r.querySelector('[aria-label=\"Claude is working\"]')); return (busy ?? rows[0])?.dataset.sessionId ?? null; })()",
  )) as string | null;
  if (!id) return 'no session to archive';
  const working = (await js(`!!document.querySelector('[data-session-id="${id}"] [aria-label="Claude is working"]')`)) as boolean;
  const menu = async (label: string) => {
    const opened = await js(
      `(() => { const row = document.querySelector('[data-session-id="${id}"]'); if (!row) return false; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 })); return true; })()`,
    );
    if (!opened) return false;
    if (!(await waitInPage(win, `[...document.querySelectorAll('[role=menuitem]')].some((b) => b.innerText.startsWith(${JSON.stringify(label)}))`, 3_000))) return false;
    await js(`[...document.querySelectorAll('[role=menuitem]')].find((b) => b.innerText.startsWith(${JSON.stringify(label)})).click()`);
    return true;
  };
  // In the main list: rendered and above the "Archived" header. The list is virtualised, so check from the top.
  const toTop = "document.querySelector('[data-session-list]').scrollTop = 0";
  const inMainList = `(() => { const row = document.querySelector('[data-session-id="${id}"]'); if (!row) return false; const header = document.querySelector('[data-archived-toggle]'); return !header || row.getBoundingClientRect().top < header.getBoundingClientRect().top; })()`;
  if (!(await menu('Archive'))) return 'no Archive item';
  await js(toTop);
  if (!(await waitInPage(win, `!${inMainList}`, 3_000))) return `archiving did nothing${working ? ' (a working session)' : ''}`;
  // Open the Archived section (scroll down until its header renders) and move it back.
  for (let i = 0; i < 40 && !(await js("!!document.querySelector('[data-archived-toggle]')")); i++) {
    await js("document.querySelector('[data-session-list]').scrollTop += 400");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if ((await js("document.querySelector('[data-archived-toggle]')?.dataset.open ?? 'missing'")) === 'false') await js("document.querySelector('[data-archived-toggle]').click()");
  // Archived rows render as they scroll into view: keep scrolling until this one appears.
  for (let i = 0; i < 60 && !(await js(`!!document.querySelector('[data-session-id="${id}"]')`)); i++) {
    await js("document.querySelector('[data-session-list]').scrollTop += 300");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await js(`document.querySelector('[data-session-id="${id}"]')?.scrollIntoView({ block: 'center' })`);
  if (!(await waitInPage(win, `!!document.querySelector('[data-session-id="${id}"]')`, 3_000))) {
    const seen = await js(
      `JSON.stringify({ header: document.querySelector('[data-archived-toggle]')?.innerText, open: document.querySelector('[data-archived-toggle]')?.dataset.open, rows: document.querySelectorAll('[data-session-id]').length, scroll: document.querySelector('[data-archived-toggle]')?.closest('.overflow-y-auto')?.scrollTop })`,
    );
    return `archived session not found under Archived: ${seen}`;
  }
  if (!(await menu('Unarchive'))) return 'no Unarchive item';
  // Scroll to the top on every check: opening Archived above slides the list down to it for 200ms, which would undo a
  // single scroll made while it runs and leave the unarchived row out of the virtualised list.
  if (!(await waitInPage(win, `(${toTop}, ${inMainList})`, 3_000))) return 'unarchiving did nothing';
  return `ok: archived ${working ? 'a working session' : 'a session'} and unarchived it`;
}

/**
 * Rename… in a row's context menu, and F2 on the focused row, open the rename dialog with the title selected; Rename
 * stays off until the name changes. Read-only: it never renames, because the title lives in the real transcript.
 */
async function runRenameStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-session-list]').scrollTop = 0");
  const id = (await js("document.querySelector('[data-session-id]')?.dataset.sessionId ?? null")) as string | null;
  if (!id) return 'no session to rename';
  const row = `document.querySelector('[data-session-id="${id}"]')`;
  const dialog = "document.querySelector('[data-rename-session-dialog]')";
  const input = "document.querySelector('[data-rename-session-input]')";
  const save = "document.querySelector('[data-rename-session-save]')";
  await js(`(() => { const r = ${row}.getBoundingClientRect(); ${row}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 })); })()`);
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-rename-session]')", 3_000))) return 'no Rename… item in the context menu';
  await js("document.querySelector('[role=menuitem][data-rename-session]').click()");
  if (!(await waitInPage(win, `${dialog} && document.activeElement === ${input}`, 3_000))) return 'Rename… did not open the dialog with the field focused';
  const prefilled = (await js(`(() => { const el = ${input}; return el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length && ${row}.innerText.includes(el.value); })()`)) as boolean;
  if (!prefilled) return "the field doesn't hold the session's title, selected";
  if (!(await js(`${save}.disabled`))) return 'Rename is on before the name changed';
  await setFieldValue(win, '[data-rename-session-input]', 'Smoke rename (never saved)');
  if (!(await waitInPage(win, `!${save}.disabled`, 2_000))) return 'Rename stayed off after typing a new name';
  await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  if (!(await waitInPage(win, `!${dialog}`, 2_000))) return 'Escape did not close the dialog';
  if ((await js(`${row}.innerText`)).includes('Smoke rename')) return 'the title changed without Rename';
  await js(`${row}.focus(); ${row}.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))`);
  if (!(await waitInPage(win, dialog, 2_000))) return 'F2 on the focused row did not open the dialog';
  await js(`[...${dialog}.querySelectorAll('button')].find((b) => b.innerText === 'Cancel').click()`);
  if (!(await waitInPage(win, `!${dialog}`, 2_000))) return 'Cancel did not close the dialog';
  return 'ok: Rename… and F2 open the dialog with the title selected; Rename waits for a new name; Escape and Cancel keep the title';
}

/**
 * ⌘-click picks a second session, right-click → "Archive 2 sessions" moves both under "Archived" and closes the one that
 * was open, and the selection bar there brings them back. Flags live in the throwaway profile.
 */
async function runArchiveManyStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
  const list = "document.querySelector('[data-session-list]')";
  await js(`${list}.scrollTop = 0`);
  await pause(100);
  // Two sessions from the main list (above the Archived header), leaving the smoke session alone.
  const ids = (await js(`(() => {
    const header = document.querySelector('[data-archived-toggle]');
    const top = header ? header.getBoundingClientRect().top : Infinity;
    return [...document.querySelectorAll('[data-session-id]')]
      .filter((r) => r.getBoundingClientRect().top < top && r.dataset.sessionId !== ${JSON.stringify(smokeSessionId)} && r.dataset.indexed === 'true' && !r.querySelector('[aria-label="Claude is working"]'))
      .slice(0, 2).map((r) => r.dataset.sessionId);
  })()`)) as string[];
  if (ids.length < 2) return `ok: skipped, only ${ids.length} idle indexed session(s) in the main list`;
  const row = (id: string) => `document.querySelector('[data-session-id="${id}"]')`;
  const click = (id: string, meta: boolean) => js(`${row(id)}?.dispatchEvent(new MouseEvent('click', { bubbles: true, ${MOD_KEY_PROPERTY}: ${meta} }))`);
  const inMainList = (id: string) =>
    `(() => { const r = ${row(id)}; if (!r) return false; const h = document.querySelector('[data-archived-toggle]'); return !h || r.getBoundingClientRect().top < h.getBoundingClientRect().top; })()`;
  const [a, b] = ids as [string, string];

  const open = (id: string) => `!!document.querySelector('[data-current-session="${id}"]')`;
  await click(a, false);
  if (!(await waitInPage(win, open(a), 3_000))) return 'clicking a session did not open it';
  await click(b, true);
  if (!(await waitInPage(win, "document.querySelector('[data-selection-count]')?.dataset.selectionCount === '2'", 2_000))) return 'picking a second session with ⌘-click showed no selection bar for 2';
  // While picking, every row shows a round checkbox in place of its project icon, and picked rows sit on a tinted block.
  if (!(await js("[...document.querySelectorAll('[data-session-id]')].every((r) => r.querySelector('[data-pick-box]'))"))) return 'picking did not show a checkbox on every row';
  if (!(await js(`${row(a)}?.querySelector('[data-pick-box]')?.dataset.pickBox === 'true' && !!${row(a)}?.parentElement?.querySelector('[data-pick-block]')`))) return 'the picked row has no ticked checkbox or tinted block';
  await shot(win, 'multi-select.png');
  await js(`(() => { const r = ${row(a)}.getBoundingClientRect(); ${row(a)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 })); })()`);
  const item = "[...document.querySelectorAll('[role=menuitem]')].find((b) => b.innerText.startsWith('Archive 2 sessions'))";
  if (!(await waitInPage(win, `!!${item}`, 3_000))) {
    const seen = await js("JSON.stringify([...document.querySelectorAll('[role=menuitem]')].map((b) => b.innerText))");
    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    return `no "Archive 2 sessions" item in the menu: ${seen}`;
  }
  await js(`${item}.click()`);
  await js(`${list}.scrollTop = 0`);
  if (!(await waitInPage(win, `!${inMainList(a)} && !${inMainList(b)} && !document.querySelector('[data-selection-bar]')`, 3_000))) return 'archiving left the sessions in the main list';
  if (!(await waitInPage(win, `!${open(a)}`, 2_000))) return 'archiving the open session left it open';

  // Find them under Archived (scroll until its header renders) and bring them back.
  for (let i = 0; i < 80 && !(await js("!!document.querySelector('[data-archived-toggle]')")); i++) {
    await js(`${list}.scrollTop += 400`);
    await pause();
  }
  if (!(await js("!!document.querySelector('[data-archived-toggle]')"))) return 'no Archived header';
  const opened = (await js("document.querySelector('[data-archived-toggle]').dataset.open")) === 'false';
  if (opened) await js("document.querySelector('[data-archived-toggle]').click()");
  for (let i = 0; i < 40 && !(await js(`!!${row(a)} && !!${row(b)}`)); i++) {
    await js(`${list}.scrollTop += 300`);
    await pause();
  }
  if (!(await waitInPage(win, `!!${row(a)} && !!${row(b)}`, 2_000))) return 'archived sessions not listed under Archived';
  await click(a, false);
  await click(b, true);
  if (!(await waitInPage(win, "!!document.querySelector('[data-unarchive-selected]')", 2_000))) return 'no Unarchive button for two archived sessions';
  await js("document.querySelector('[data-unarchive-selected]').click()");
  // Clicking `a` in Archived opened it again, so the list may follow it: look for both rows wherever they now sit.
  const unarchived = async () => {
    const seen = new Set<string>();
    await js(`${list}.scrollTop = 0`);
    for (let i = 0; i < 80 && seen.size < 2; i++) {
      for (const id of [a, b]) if (await js(`!!${row(id)} && !${row(id)}.dataset.archived`)) seen.add(id);
      if (await js(`${list}.scrollTop + ${list}.clientHeight >= ${list}.scrollHeight`)) break;
      await js(`${list}.scrollTop += 300`);
      await pause();
    }
    return seen.size === 2;
  };
  let back = false;
  for (const started = Date.now(); !back && Date.now() - started < 3_000; ) back = await unarchived();
  if (!back) return 'unarchiving did not bring the sessions back to the main list';
  if (opened && (await js("document.querySelector('[data-archived-toggle]')?.dataset.open")) === 'true') await js("document.querySelector('[data-archived-toggle]').click()");
  if (smokeSessionId) {
    // Back to the smoke session for the steps after this one; its row is near the top of the virtualised list.
    await js(`${list}.scrollTop = 0`);
    await waitInPage(win, `!!${row(smokeSessionId)}`, 2_000);
    await js(`${row(smokeSessionId)}?.click()`);
    if (!(await waitInPage(win, open(smokeSessionId), 3_000))) return 'the smoke session did not open again';
  }
  return 'ok: ⌘-click picked two sessions, archived both from the menu (closing the open one) and unarchived them from the selection bar';
}

/** Closes a dialog, menu or palette a step left open (with Escape, as a person would), so the next step starts clean. */
async function closeOverlays(win: BrowserWindow | undefined): Promise<string | null> {
  if (!win || win.isDestroyed()) return null;
  const open = "[...document.querySelectorAll('[role=dialog], [role=alertdialog], [role=menu], [data-command-palette]')].map((el) => el.getAttribute('aria-label') || el.dataset.menu || el.getAttribute('role'))";
  let left = (await win.webContents.executeJavaScript(open)) as string[];
  if (!left.length) return null;
  const found = left.join(', ');
  for (let i = 0; i < 4 && left.length; i++) {
    pressKey(win, 'Escape');
    await waitInPage(win, `${open}.length < ${left.length}`, 1_000);
    left = (await win.webContents.executeJavaScript(open)) as string[];
  }
  return left.length ? `could not close ${left.join(', ')}` : `closed what it left open (${found})`;
}

/**
 * Sessions running in Claude Code right now, in Switchboard or anywhere else, and their folders, plus the Claude
 * Code session that started this run (CLAUDE_CODE_SESSION_ID, in case the registry doesn't list it yet, with the
 * folder the run started in). Smoke steps never type into them or run anything in their folders. Null when the
 * engine can't be asked: then no session is safe.
 */
async function runningSessions(): Promise<{ ids: Set<string>; folders: string[] } | null> {
  const running = await notifier.runningSessions().catch(() => null);
  if (running && process.env.CLAUDE_CODE_SESSION_ID) {
    running.ids.add(process.env.CLAUDE_CODE_SESSION_ID);
    running.folders.push(process.cwd());
  }
  return running;
}

/**
 * Whether `root` is a running session's folder or inside it. An idle session there would have the smoke steps run
 * their actions and terminal where Claude Code is working. A folder around it (the project's main checkout, while a
 * session works in one of its worktrees) is another folder: the steps there are read-only, and only run test commands.
 */
const inRunningFolder = (root: string, folders: string[]) => folders.some((folder) => isSameOrInside(root, folder));

/**
 * Opens the newest session with messages and tool activity (a brand-new or chat-only one has less to check);
 * failing that, the newest with messages. Later steps (actions, Changes, git) need its folder to be known.
 * Never a running session (`runningSessions`): later steps type drafts into it and run actions in its folder.
 * Those rows are not even clicked. Nor one whose own folder or project root is in a running session's folder
 * (`inRunningFolder`).
 */
async function openSmokeSession(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const running = await runningSessions();
  if (!running) return 'failed: could not ask the engine which sessions are running, so none is safe to use';
  const rows = (await js("[...document.querySelectorAll('[data-session-id]')].map((row) => row.dataset.sessionId)")) as string[];
  const listed = [...new Set(rows)];
  const notRunning = listed.filter((id) => !running.ids.has(id));
  // The 8 newest it can use, looking further down the list past sessions in a running session's folder (the
  // older sessions of a project someone is working in), but not forever.
  const candidates = notRunning.slice(0, 30);
  const skipped = listed.length - notRunning.length;
  let tried = 0;
  let shared = 0;
  const left = () =>
    [skipped ? `, left ${skipped} running session${skipped === 1 ? '' : 's'} alone` : '', shared ? `, and ${shared} in a running session's folder` : ''].join('');
  let fallback: string | null = null;
  for (const id of candidates) {
    if (tried === 8) break;
    await js(`document.querySelector('[data-session-id="${id}"]')?.click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-current-session]')?.dataset.currentSession === ${JSON.stringify(id)} && document.querySelector('[data-current-session] [data-transcript-item]')`, 5_000))) continue;
    const { root, cwd } = (await js("(() => { const view = document.querySelector('[data-current-session]'); return { root: view?.dataset.projectRoot ?? '', cwd: view?.dataset.cwd ?? '' }; })()")) as { root: string; cwd: string };
    if (!isAbsolutePath(root)) continue;
    // The terminal and the actions run in the session's own folder (a worktree's, or a subfolder of the project) or in
    // the project's root: neither may be where Claude Code is working.
    if (inRunningFolder(root, running.folders) || (isAbsolutePath(cwd) && inRunningFolder(cwd, running.folders))) {
      shared++;
      continue;
    }
    tried++;
    fallback ??= id;
    if (await waitInPage(win, "document.querySelector('[data-activity], [data-tool]')", 1_000)) {
      smokeSessionId = id;
      return `ok: with tool activity${left()}`;
    }
  }
  if (!fallback) return `failed: none of the newest sessions that aren't running opened with messages outside a running session's folder${left()} (running in: ${[...new Set(running.folders)].join(', ') || 'none'})`;
  smokeSessionId = fallback;
  await js(`document.querySelector('[data-session-id="${fallback}"]').click()`);
  return (await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000)) ? `ok: without tool activity${left()}` : 'failed: the fallback session did not render';
}

/** The opened transcript is scrolled to the very end, with space between the last message and the composer. */
async function checkTranscriptEnd(win: BrowserWindow): Promise<string> {
  const atBottom = "(() => { const el = document.querySelector('[data-transcript]'); return el.scrollHeight - el.scrollTop - el.clientHeight < 2; })()";
  const bottomGap =
    "(() => { const el = document.querySelector('[data-transcript]'); const rows = [...el.querySelectorAll('[data-transcript-item]')]; const last = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom)); return Math.round(el.getBoundingClientRect().bottom - last); })()";
  const fits = "(() => { const el = document.querySelector('[data-transcript]'); return el.scrollHeight <= el.clientHeight + 1; })()";
  // Images in the last rows load after they're first measured, and a live session keeps growing:
  // read the position and the gap together, and give the view up to 4 s to settle at the end.
  const deadline = Date.now() + 4_000;
  let reading = { atEnd: false, gap: 0, fits: false };
  do {
    reading = (await win.webContents.executeJavaScript(`({ atEnd: ${atBottom}, gap: ${bottomGap}, fits: ${fits} })`)) as typeof reading;
    if (reading.atEnd && (reading.fits || (reading.gap >= 16 && reading.gap <= 60))) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  await shot(win, 'transcript.png');
  if (reading.fits) return 'ok: conversation shorter than the window';
  if (reading.atEnd && reading.gap >= 16 && reading.gap <= 60) return `ok: ${reading.gap}px above the composer`;
  const detail = await win.webContents.executeJavaScript(
    "(() => { const el = document.querySelector('[data-transcript]'); if (!el) return 'no transcript on screen'; const list = el.firstElementChild; return JSON.stringify({ scrollHeight: el.scrollHeight, scrollTop: Math.round(el.scrollTop), clientHeight: el.clientHeight, listHeight: list?.offsetHeight, streaming: !!el.querySelector('[data-streaming]'), lastKind: [...el.querySelectorAll('[data-transcript-item]')].at(-1)?.dataset.itemKind, gap: " + bottomGap + " }); })()",
  );
  return `failed: ${reading.atEnd ? `${reading.gap}px above the composer` : 'not at the end'} (${detail})`;
}

/** Diagnostics (in Settings) renders a sample through Shiki, which loads in its own chunks on first use. */
async function runDiagnosticsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-open-settings]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"diagnostics\"]')", 3_000))) return 'failed: Settings did not open';
  await js("document.querySelector('[data-settings-section=\"diagnostics\"]').click()");
  try {
    if (!(await waitInPage(win, "document.querySelector('[data-rendering-check] .shiki span[style*=\"--shiki\"]')", 5_000))) return 'failed: syntax highlighting did not colour the code block';
    // Present without hovering (only invisible), so it can be reached with Tab. Not clicked: that would overwrite the clipboard.
    if (!(await js("document.querySelector('[data-rendering-check] [data-code-copy]')?.getAttribute('aria-label') === 'Copy code'"))) return 'failed: the code block has no copy button';
    // Run needs a session's terminal, so the sample here, outside a session, has none.
    if (await js("!!document.querySelector('[data-rendering-check] [data-code-run]')")) return 'failed: a code block outside a session has a Run button';
    const markdownPreview =
      (await waitInPage(win, "document.querySelector('[data-rendering-check] [data-code-preview] h2')", 3_000)) &&
      (await js("document.querySelector('[data-rendering-check] [data-code-view=\"source\"]')?.click(), true")) &&
      (await waitInPage(win, "!document.querySelector('[data-rendering-check] [data-code-preview]') && document.querySelector('[data-rendering-check] [data-code-preview-block]').innerText.includes('## Markdown blocks')", 3_000)) &&
      (await js("document.querySelector('[data-rendering-check] [data-code-view=\"preview\"]')?.click(), true")) &&
      (await waitInPage(win, "document.querySelector('[data-rendering-check] [data-code-preview] h2')", 3_000));
    if (!markdownPreview) return 'failed: the markdown block did not open rendered and switch to its source and back';
    // Not clicked: it would open Finder.
    if (!(await waitInPage(win, "document.querySelector('[data-diagnostics-reveal=\"config-dir\"]') && document.querySelector('[data-diagnostics-reveal=\"database\"]')", 3_000))) return 'failed: no Finder buttons for the config folder and the cache database';
    await shot(win, 'diagnostics.png');
    return 'ok: syntax highlighting coloured a code block with a copy button and no Run, markdown opens rendered and switches to its source, Finder buttons for the config folder and cache database';
  } finally {
    await js("document.querySelector('[data-close-settings]')?.click()");
  }
}

let smokeFinished = false;

/** The window's size when a scripted run starts, and the screen's, for result.json. */
let smokeWindow: { content: number[]; workArea: { width: number; height: number } } | null = null;

/** Writes result.json once: the steps' results and what the run measured. */
function writeSmokeResult(): void {
  if (smokeFinished || !smokeOutDir) return;
  smokeFinished = true;
  mkdirSync(smokeOutDir, { recursive: true });
  writeFileSync(
    join(smokeOutDir, 'result.json'),
    JSON.stringify(
      {
        connectedMs: readyReports[0]?.connectedMs ?? null,
        loadedMs: readyReports[0]?.loadedMs ?? null,
        sessionCount: readyReports[0]?.sessionCount ?? 0,
        steps: smokeRun.steps,
        stoppedBy: smokeRun.stoppedBy,
        slowest: smokeRun.slowest(8),
        notifications: recordedNotifications,
        rendering,
        reports: readyReports,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        window: smokeWindow,
      },
      null,
      2,
    ),
  );
}

/**
 * Smoke test: first ready → run every step against the real UI, then kill the engine; second ready (after
 * the automatic restart and reconnect) → record how long that took, write the results and quit.
 */
async function runSmokeStep(win: BrowserWindow | null): Promise<void> {
  if (!smokeOutDir || !win) return;
  mkdirSync(smokeOutDir, { recursive: true });
  if (readyReports.length > 1) {
    await smokeRun.step('engine restarted and renderer reconnected', async () => `ok: in ${Math.round(performance.now() - crashedAt)}ms`, { cleanup: false });
    writeSmokeResult();
    exitApp(0);
    return;
  }
  // The page must act as the focused window (toasts count down only then, focus moves as with a person at the
  // keyboard), but macOS won't let an app take focus while another is in front or the screen is locked. Chromium's
  // focus emulation makes the page behave as focused whatever the system does, and leaves your focus alone.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  console.log(`[smoke] page focused: ${await win.webContents.executeJavaScript('document.hasFocus()')} (window focused: ${win.isFocused()})`);
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const step = smokeRun.step.bind(smokeRun);

  await step('sessions listed after the initial scan', async () => {
    if (!(await waitInPage(win, "document.querySelector('[data-session-id]')", 5_000))) return 'failed: no session rows';
    await shot(win, 'window.png');
    await js("document.querySelector('[data-project-filter]')?.click()");
    await waitInPage(win, "document.querySelector('[role=menu]')", 1_000);
    await shot(win, 'projects.png');
    pressKey(win, 'Escape');
    await waitInPage(win, "!document.querySelector('[role=menu]')", 1_000);
    return `ok: ${await js("document.querySelectorAll('[data-session-id]').length")} rows (${readyReports[0]!.sessionCount} in the first snapshot)`;
  });
  await step('newest session with messages rendered', () => openSmokeSession(win));
  await step('transcript opens at the end', () => checkTranscriptEnd(win));
  await step('permission mode for new sessions: a fixed mode starts New session in it, the last one picked comes back', () => runNewSessionModeStep(win));
  await step('tool calls summarised', async () => {
    const activity = await runActivityStep(win);
    if (!activity) return 'failed: no groups';
    const summary = `${activity.groups} groups; "${activity.label}" opens to ${activity.steps} steps`;
    return activity.steps ? `ok: ${summary}` : `failed: ${summary}`;
  });
  await step('changes panel', () => runChangesStep(win));
  await step('branch button', () => runBranchStep(win));
  await step('open in menu', () => runOpenInStep(win));
  await step('check transcript', () => runCheckTranscriptStep(win));
  await step('git menu', () => runGitStep(win));
  await step('create pull request dialog', () => runPullRequestStep(win));
  await step('find in session', () => runFindStep(win));
  await step('file links', () => runFileLinksStep(win));
  await step('long prompts', () => runLongPromptStep(win));
  await step('copy messages', () => runCopyMessageStep(win));
  await step('reply actions', () => runReplyActionsStep(win));
  await step('remember this', () => runRememberStep(win));
  await step('selection toolbar', () => runSelectionToolbarStep(win));
  await step('run code blocks', () => runCodeRunStep(win));
  await step('unsent drafts', () => runDraftStep(win));
  await step('unsent messages', () => runUnsentStep(win));
  await step('search', () => runSearchStep(win));
  await step('command palette', () => runPaletteStep(win));
  await step('shortcuts sheet', () => runShortcutsStep(win));
  await step('tools', () => runToolsStep(win));
  await step('split panes', () => runSplitStep(win));
  await step('split layout: swap and stack', () => runSplitLayoutStep(win));
  await step('archive', () => runArchiveStep(win));
  await step('rename', () => runRenameStep(win));
  await step('multi-select and archive', () => runArchiveManyStep(win));
  await step('drop target', () => runDropStep(win));
  await step('prompt history', () => runHistoryStep(win));
  await step('send now only while Claude works', () => runSendNowStep(win));
  await step('side questions with /btw, nothing added to the conversation', () => runSideQuestionStep(win));
  await step('controls', () => runControlsStep(win));
  await step('sidebar states', () => runSidebarStatesStep(win));
  await step('new session view', () => runNewSessionStep(win));
  // Finding a checkout of an unknown repository walks the folders on disk.
  await step('links', () => runDeepLinkStep(win), { timeoutMs: 45_000 });
  await step('VS Code companion', () => runCompanionStep(win));
  await step('queue', () => runQueueStep(win));
  await step('collapsible sections', () => runSectionsStep(win));
  await step('archived dock', () => runArchivedDockStep(win));
  await step('star on GitHub', () => runStarStep(win));
  await step('quick question', () => runQuickQuestionStep(win));
  await step('usage band above the composer', async () => {
    if (!(await waitInPage(win, "document.querySelector('[data-usage-band]')", 15_000))) {
      // Under a session the band needs Claude Code's usage report, which takes a login the demo home doesn't have.
      return process.env.SWITCHBOARD_SMOKE_DEMO ? 'ok: skipped, no login in the demo home to read usage from' : 'failed: not shown';
    }
    await shot(win, 'usage.png');
    return `ok: ${await js("document.querySelector('[data-usage-band]').innerText.replace(/\\s+/g, ' ')")}`;
  });
  await step('usage view: open from the usage bar, tabs and periods, a session from a row, Esc', () => runUsageViewStep(win), { timeoutMs: 45_000 });
  await step('⌘Q asks first, Cancel keeps the app open, a second ⌘Q quits', () => runQuitStep(win));
  await step('settings: theme, sidebar style, session scope, tool activity, startup and quit prompt apply at once and are saved', () => runSettingsStep(win));
  await step('settings search: ⌘F, results per page, Enter and Escape, and every setting opens at its row', () => runSettingsSearchStep(win), { timeoutMs: 90_000 });
  await step('focus limit', () => runFocusStep(win));
  await step('settings › sessions: archive days, deleting asks first, overview picks a month (nothing deleted)', () => runSessionsSettingsStep(win));
  await step('terminal panel opened a shell', () => runTerminalStep(win));
  await step('⌘K in the terminal', () => runTerminalClearStep(win));
  await step('terminal layout', () => runTerminalLayoutStep(win));
  await step("the window's own terminal, outside a session", () => runAppTerminalStep(win));
  await step('project action added through the editor and run in a terminal tab', () => runActionStep(win));
  await step('action terminal', () => runActionTerminalStep(win));
  await step('action menu', () => runActionMenuStep(win));
  await step('settings › notifications: both switches, the blocked notice, a test notification, a sound per moment, ▶, hover and the volume (recorded, never heard)', () => runNotificationsStep(win));
  await step('projects', () => runProjectsStep(win), { timeoutMs: 60_000 });
  await step('profiles', () => runProfilesStep(win));
  await step('about', () => runAboutStep(win));
  await step('backup', () => runBackupStep(win));
  await step('themes: export, import, pick, remove, and every built-in in light and dark', () => runThemeStep(win));
  await step('diagnostics', () => runDiagnosticsStep(win));
  rendering = (await js(
    "({ diffs: document.querySelectorAll('[data-diff]').length, highlighted: document.querySelectorAll('.shiki').length, codeBlocks: document.querySelectorAll('.code-block').length, todos: document.querySelectorAll('[data-todos]').length, images: document.querySelectorAll('[data-transcript-image] img').length })",
  )) as Record<string, number>;
  const liveCwd = process.env.SWITCHBOARD_SMOKE_LIVE_CWD;
  if (liveCwd) await step('live session through the UI', () => runLiveSessionStep(win, liveCwd), { timeoutMs: 180_000 });
  crashedAt = performance.now();
  engine.crash();
  // The second ready finishes the run; if it never comes, say so instead of waiting for the watchdog.
  setTimeout(() => {
    if (smokeFinished) return;
    void smokeRun.step('engine restarted and renderer reconnected', async () => 'failed: the renderer did not reconnect within 15s', { cleanup: false }).then(() => {
      writeSmokeResult();
      exitApp(0);
    });
  }, 15_000).unref();
}

app.whenReady().then(() => {
  // Packaged builds take the icon from the bundle's icon.icns; in development, set it on the Dock.
  if (!app.isPackaged) app.dock?.setIcon(join(here, '../../build/icon.png'));
  // The commit shows in brackets after the version, handy when someone reports a bug from a build.
  app.setAboutPanelOptions({
    applicationName: 'Switchboard',
    applicationVersion: appInfo.dev ? `${appInfo.version} (dev)` : appInfo.version,
    version: appInfo.commit ?? '',
    iconPath: join(here, '../../build/icon.png'),
  });
  engine = new EngineProcess({
    entry: join(here, 'engine.js'),
    dataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    onRequest: handleEngineRequest,
    onRestarted: () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.engineRestarted);
      notifier.connect();
    },
  });
  sendEngineSettings(preferences.get());
  engine.start();
  themes.watch();
  installMenu();
  notifier = new Notifier({
    engine,
    window: () => BrowserWindow.getAllWindows()[0],
    focusedSession: () => focusedSession,
    openSession,
    showAllSessions: () => preferences.get().sessionScope === 'all',
    alerts: () => preferences.get(),
    sounds,
    ...(smokeOutDir ? { record: (event: RecordedAlert) => void recordedNotifications.push(event) } : {}),
  });
  notifier.connect();
  createWindow();
  updater.start();
  // The packaged app declares the scheme in Info.plist; this also takes it back if another app claimed it.
  // Development and smoke builds leave the system's link handlers alone.
  if (app.isPackaged && !scripted && !app.isDefaultProtocolClient(DEEP_LINK_SCHEME)) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  const launchLink = linkFromArgv(process.argv);
  if (launchLink) openDeepLink(launchLink);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // A last resort for a run that hangs outside a step (each step has its own time limit); it still writes what ran.
  if (smokeOutDir) {
    setTimeout(() => {
      writeSmokeResult();
      exitApp(2);
    }, process.env.SWITCHBOARD_SMOKE_LIVE_CWD ? 300_000 : 180_000).unref();
  }
  if (screenshotOutDir) setTimeout(() => exitApp(2), 240_000).unref();
});

// macOS delivers links here, also the one that launched the app (before 'ready', so it waits in pendingMessages).
app.on('open-url', (event, url) => {
  event.preventDefault();
  openDeepLink(url);
});

app.on('second-instance', (_event, argv) => {
  // Elsewhere a link arrives as an argument to a second instance.
  const link = linkFromArgv(argv);
  if (link) return openDeepLink(link);
  // Launching the app again shows it, with a new window if they were all closed.
  if (app.isReady()) showWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  themes.close();
  updater.stop();
  engine?.stop();
});
