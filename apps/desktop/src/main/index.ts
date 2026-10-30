import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { basename, join, resolve, sep } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, MessageChannelMain, nativeImage, nativeTheme, powerMonitor, powerSaveBlocker, screen, shell, systemPreferences, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { DEFAULT_PREFERENCES, IMAGE_EXTENSIONS, IpcChannel, REMOTE_LOG_FILE, isSoundId, isThemeId, POPOUT_QUERY, resolveSound, sanitizePreferences, type AppInfo, type DeepLinkMessage, type MainWindowRequest, type NotificationPermission, type OpenAtLogin, type Preferences, type RendererReadyReport, type SessionView, type ShellCommandResult, type ThemeCommand, type UpdateCommand } from '@seshboard/protocol/bridge';
import { isAbsolutePath, isLocalAbsolutePath, isSameOrInside } from '@seshboard/protocol/paths';
import type { RemoteContract } from '@seshboard/protocol';
import { previewKind, type ScheduleRunEvent } from '@seshboard/protocol/client';
import { COMPANION_DIR, COMPANION_INFO_FILE, COMPANION_PROTOCOL, createRpcClient, lineTransport, type CompanionContract, type CompanionInfo } from '@seshboard/protocol/companion-client';
import { BUILT_IN_THEMES } from '../../../ui/src/themes/index.ts';
import { AppIcon } from './appIcon.ts';
import { DockActivity } from './dockActivity.ts';
import { EngineProcess } from './engineProcess.ts';
import { remoteIdentity, throwawayRemoteKey } from './remoteIdentity.ts';
import { adoptLegacyEnv, cameFromSwitchboard, legacyDataFolder } from './rename.ts';
import { DEEP_LINK_SCHEME, isShowLink, LEGACY_DEEP_LINK_SCHEME, linkFromArgv, parseDeepLink } from './deepLink.ts';
import { Notifier, type RecordedAlert } from './notifier.ts';
import { setFieldValue, settle, until, waitInPage } from './pageDriver.ts';
import { closeRemotePhone, runPhoneCatchUpStep, runPhoneDrawerNewStep, runPhoneDrawerStep, runPhoneMoreStep, runPhoneOptionsStep, runPhoneSessionMoreStep, runPhoneSettingsThemeStep, runPhoneStartStep } from './remotePhoneSmoke.ts';
import { PreferencesStore } from './preferences.ts';
import { QuitGuard } from './quitGuard.ts';
import { ReloadLimiter } from './reloadLimiter.ts';
import { RendererQueue } from './rendererQueue.ts';
import { runScreenshotTour } from './screenshotTour.ts';
import { SmokeRun } from './smokeRunner.ts';
import { SoundPlayer } from './sounds.ts';
import { KeepAwake } from './keepAwake.ts';
import { loginItemsSettingsUrl, openAtLoginFrom } from './loginItem.ts';
import { notificationPermission, notificationSettingsUrl } from './notificationPermission.ts';
import { Cancelled, commandFolders, folderFromArgv, installShellCommand, pathCheck, readShellCommand, removeShellCommand, SHELL_COMMAND_NAMES, shellCommandDir, shellCommandPlan, type ShellCommandPlan } from './shellCommand.ts';
import { ThemeStore } from './themes.ts';
import { isConfigDir, isTrashableInstructionFile, isTrashableMemoryFile, isTrashableRepoFile, isTrashableSessionPath, isTrashableThemeFile } from './trashGuard.ts';
import { Updater } from './updater.ts';
import { acceptsPreviewRemote, updatesDisabledReason } from './updateState.ts';
import { guarded } from './guarded.ts';
import { placePopout, placeWindow, POPOUT_MIN, POPOUT_SIZE, WindowStateStore } from './windowState.ts';
import { MOD_KEY_PROPERTY, MOD_MODIFIER, platformModifiers } from './smokeKeys.ts';

const here = import.meta.dirname;
// Variables named before the rename (SWITCHBOARD_…) still count, before anything reads them.
adoptLegacyEnv(process.env);
const smokeOutDir = process.env.SESHBOARD_SMOKE_OUT;
// npm run screenshots: a tour through the app in a made-up home folder, for the README.
const screenshotOutDir = process.env.SESHBOARD_SCREENSHOTS_OUT;
// npm run website:screenshots: Playwright drives the window from outside (scripts/website-screenshots.ts); the app
// only has to run on a throwaway profile, like the tours above.
const driven = process.env.SESHBOARD_DRIVEN === '1';
const scripted = Boolean(smokeOutDir || screenshotOutDir || driven);

// `Seshboard --version` prints the version for scripts and support, before any window opens.
if (process.argv.includes('--version')) {
  process.stdout.write(`${app.getVersion()}\n`);
  app.exit(0);
}

/** The running build. The commit is baked in at build time (electron.vite.config.ts). */
const appInfo: AppInfo = { version: app.getVersion(), commit: __SESHBOARD_COMMIT__ || null, dev: !app.isPackaged, fromSwitchboard: false };
ipcMain.on(IpcChannel.getAppInfo, (event) => {
  event.returnValue = appInfo;
});

// The smoke test and the screenshots run against a throwaway profile so they never touch real app data. A driven run
// may name its own folder (SESHBOARD_DRIVEN_PROFILE), so a restart finds the same profile (scripts/chaos); never one
// inside the app data folder, where the installed app keeps the user's real data.
const drivenProfile = driven ? process.env.SESHBOARD_DRIVEN_PROFILE : undefined;
if (drivenProfile && isAbsolutePath(drivenProfile) && !isSameOrInside(drivenProfile, app.getPath('appData'))) {
  mkdirSync(drivenProfile, { recursive: true });
  app.setPath('userData', drivenProfile);
} else if (scripted) app.setPath('userData', mkdtempSync(join(tmpdir(), 'seshboard-smoke-')));
// The engine inherits these: the Claude Code check reads a mock registry that offers a newer version, and an
// update is refused even if one were clicked, so the user's real `claude` is never touched.
if (scripted) {
  process.env.SESHBOARD_CLAUDE_REGISTRY ??= `data:application/json,${encodeURIComponent(JSON.stringify({ latest: '999.0.0', stable: '999.0.0' }))}`;
  process.env.SESHBOARD_NO_CLAUDE_UPDATE = '1';
  // Auto model never calls a real model here: the engine picks from the prompt's words instead.
  process.env.SESHBOARD_STUB_ROUTER = '1';
  // Ask about this session (and /btw) gets a made-up answer, so nothing here asks a model.
  process.env.SESHBOARD_STUB_BTW = '1';
  // Catch-up cards are written from the tool calls, never by a model.
  process.env.SESHBOARD_STUB_CATCHUP = '1';
  // Queued items that start by themselves leave the queue without sending their prompt to Claude.
  process.env.SESHBOARD_STUB_QUEUE = '1';
  // Clone from GitHub clones from local bare repositories in the throwaway profile, never from the network.
  process.env.SESHBOARD_CLONE_SOURCE ??= join(app.getPath('userData'), 'clone-source');
}

// The single-instance lock belongs to the data folder. Development builds keep their own ("Seshboard Dev"), so
// `npm run dev` starts next to the installed app instead of handing over to it, and a newer migration never touches
// the installed app's database. SESHBOARD_DATA_DIR picks another folder, for a second dev build (another worktree).
// Before the rename the folders were called Switchboard and Switchboard Dev: the old one moves to the new name (or into
// the new folder, when one without data is there already) the first time, or stays in use where it is while a running
// copy uses it or it can't move (rename.ts). A development build never moves the installed app's.
if (!scripted) {
  const appData = app.getPath('appData');
  let dataDir = process.env.SESHBOARD_DATA_DIR || (app.isPackaged ? undefined : legacyDataFolder(join(appData, 'Seshboard Dev'), join(appData, 'Switchboard Dev')));
  if (!dataDir && app.isPackaged) {
    const folder = legacyDataFolder(app.getPath('userData'), join(appData, 'Switchboard'));
    if (folder !== app.getPath('userData')) dataDir = folder;
  }
  if (dataDir) {
    const installedPreferences = [app.getPath('userData'), join(appData, 'Switchboard')].map((dir) => join(dir, 'preferences.json')).find((file) => existsSync(file)) ?? '';
    mkdirSync(dataDir, { recursive: true });
    // A fresh folder starts with the installed app's theme and layout rather than the defaults.
    if (!existsSync(join(dataDir, 'preferences.json')) && existsSync(installedPreferences)) copyFileSync(installedPreferences, join(dataDir, 'preferences.json'));
    app.setPath('userData', dataDir);
  }
}
// The window explains the rename once to people whose data comes from Switchboard. Scripted runs use a throwaway
// profile, so the smoke test asks for it (SESHBOARD_SMOKE_FROM_SWITCHBOARD).
appInfo.fromSwitchboard = scripted ? process.env.SESHBOARD_SMOKE_FROM_SWITCHBOARD === '1' : cameFromSwitchboard(app.getPath('userData'));

// A second launch hands its arguments to the running instance (its second-instance event) and stops here.
// app.quit() would let this module run on: the updater would delete the running instance's update marker and
// whenReady would start a second engine. app.exit() ends the process before the next line.
if (!app.requestSingleInstanceLock()) app.exit(0);

// Windows shows an app's notifications only under an AppUserModelID: the installer's (the appId) once installed,
// Electron's own path in development, where no Start menu entry carries one.
const appUserModelId = app.isPackaged ? 'dev.switchboard.app' : process.execPath;
if (process.platform === 'win32') app.setAppUserModelId(appUserModelId);

// On Linux, Chromium picks the keychain from the desktop's name: one it doesn't know (Hyprland, Sway, i3) gets no
// keychain at all, even with gnome-keyring or KeePassXC running, and Remote can't keep its keys. Ask for the Secret
// Service there; KDE keeps KWallet, and a --password-store the user passes wins.
if (process.platform === 'linux' && !app.commandLine.hasSwitch('password-store') && !/KDE/i.test(process.env.XDG_CURRENT_DESKTOP ?? '')) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

// SESHBOARD_COLOR_SCHEME=light|dark forces a scheme without saving it (to check both in the smoke test).
const forcedScheme = process.env.SESHBOARD_COLOR_SCHEME;
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

// SESHBOARD_MOCK_UPDATES=1 points the updater at a local feed (scripts/mock-update-server.ts).
const mockFeedUrl = process.env.SESHBOARD_MOCK_UPDATES === '1' ? (process.env.SESHBOARD_MOCK_UPDATES_URL ?? 'http://localhost:8484') : undefined;
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
    // On Linux electron-updater replaces the AppImage it runs from, or installs the .deb or .rpm the build marked
    // in package-type; the unpacked folder is neither.
    installer: process.platform !== 'linux' || Boolean(process.env.APPIMAGE) || (app.isPackaged && existsSync(join(process.resourcesPath, 'package-type'))),
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

/**
 * Settings › Theme › App icon, in the Dock or on the windows; applied on `ready`, before the first window, and on every
 * change. The colourways ship with the app (extraResources), from resources/app-icons in development.
 */
const appIcon = new AppIcon({
  platform: process.platform,
  dir: app.isPackaged ? join(process.resourcesPath, 'app-icons') : join(here, '../../resources/app-icons'),
  bundled: app.isPackaged,
  dock: app.dock,
  windows: () => BrowserWindow.getAllWindows(),
  exists: existsSync,
});
/**
 * Settings › Theme › App icon › Show when Claude is working: the Dock's icon lights its jacks in turn while a session
 * works (macOS only; the Notifier says when). Frames are drawn from the colourway's own Dock file.
 */
const dockActivity = new DockActivity<NativeImage>({
  file: () => appIcon.dockFile(),
  bitmap: (file, size) => {
    const image = nativeImage.createFromPath(file);
    return image.isEmpty() ? undefined : image.resize({ width: size, height: size, quality: 'best' }).toBitmap();
  },
  image: (bitmap, size) => nativeImage.createFromBitmap(bitmap, { width: size, height: size }),
  show: (image) => app.dock?.setIcon(image),
  restore: () => appIcon.restore(),
  reducedMotion: () => systemPreferences.getAnimationSettings().prefersReducedMotion,
  every: (ms, tick) => {
    const timer = setInterval(guarded('dock activity', tick), ms);
    return () => clearInterval(timer);
  },
});
/**
 * Settings › General › Keep awake: `caffeinate` on macOS, Electron's sleep blocker elsewhere. Applied on `ready` and on
 * every change; let go on quit.
 */
const keepAwake = new KeepAwake({
  platform: process.platform,
  pid: process.pid,
  spawn: (file, args) => spawn(file, args, { stdio: 'ignore' }),
  blocker: { start: () => powerSaveBlocker.start('prevent-app-suspension'), stop: (id) => powerSaveBlocker.stop(id) },
});
ipcMain.handle(IpcChannel.keepAwakeStatus, () => keepAwake.active);
/**
 * Keep awake until done (#241): held while the engine says a session works with the flag on, on battery too, since it
 * lets go by itself. Apart from the setting, so each starts and stops on its own.
 */
const sessionsAwake = new KeepAwake({
  platform: process.platform,
  pid: process.pid,
  onBattery: true,
  spawn: (file, args) => spawn(file, args, { stdio: 'ignore' }),
  blocker: { start: () => powerSaveBlocker.start('prevent-app-suspension'), stop: (id) => powerSaveBlocker.stop(id) },
});

/** A new window's icon option: the colourway's, where the bundle's isn't the one chosen. */
const windowIcon = (): Electron.BrowserWindowConstructorOptions => {
  const icon = appIcon.windowIcon();
  return icon ? { icon } : {};
};

/** Applies a change from any window or the menu bar, and tells every window. */
function updatePreferences(patch: unknown): void {
  const next = preferences.update(patch);
  if (next.appIcon !== appIcon.key) {
    appIcon.apply(next.appIcon);
    dockActivity.iconChanged();
  }
  dockActivity.setEnabled(next.dockActivity);
  keepAwake.apply(next.keepAwake);
  updater.setAutoCheck(next.autoUpdate);
  updater.setChannel(next.updateChannel);
  const item = Menu.getApplicationMenu()?.getMenuItemById(`scheme-${next.colorScheme}`);
  if (item) item.checked = true;
  updateWindowBackgrounds();
  sendEngineSettings(next);
  notifier?.prefsChanged();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.preferencesChanged, next);
}

/** Settings the engine acts on: Settings › Sessions (the archive days, which the VS Code companion lists by, and deleting), Auto model, catch-up summaries, mods and Claude in Chrome. */
function sendEngineSettings(prefs: Preferences): void {
  engine?.sendStanding({ type: 'retention', archiveAfterDays: prefs.archiveAfterDays, deleteArchived: prefs.deleteArchived });
  // Settings › Conversation › Auto model: the queue routes its prompts in the engine, with these.
  engine?.sendStanding({ type: 'autoModel', prefs: prefs.autoModel });
  // Settings › Conversation › Catch-up: whether Haiku writes the summaries.
  engine?.sendStanding({ type: 'catchUp', summaries: prefs.catchUpSummaries });
  // Settings › Conversation › Resume after a usage limit resets: Always arms a session the moment a limit stops it.
  engine?.sendStanding({ type: 'limits', resume: prefs.resumeAtLimit });
  // Settings › General › Global permission mode: a phone's new session starts in it where its profile and project set
  // none. Remember last counts as Ask before edits there: the mode picked last is kept in the window.
  engine?.sendStanding({ type: 'permissionMode', mode: prefs.newSessionMode === 'remember' ? 'default' : prefs.newSessionMode });
  // Settings › Mods › Show mods: sessions attach or detach their mods without a restart.
  engine?.sendStanding({ type: 'mods', show: prefs.showMods });
  // Settings › General › Use Claude in Chrome: sessions started or resumed from now on get --chrome.
  engine?.sendStanding({ type: 'chrome', enabled: prefs.chrome });
  // The focus limit: a queued item that starts by itself waits for a free slot instead of asking.
  engine?.sendStanding({ type: 'focus', limit: prefs.focusLimit, countExternal: prefs.focusCountExternal });
  // Settings › Theme › App icon: the colourway paired phones show, or Graphite with "Use it on your phone too" off.
  engine?.sendStanding({ type: 'appIcon', key: prefs.appIconOnRemote ? prefs.appIcon : DEFAULT_PREFERENCES.appIcon });
  // Settings › About › Channel: Beta also lets paired phones use the preview's remote app, Stable only the website's.
  engine?.sendStanding({ type: 'remotePreview', enabled: acceptsPreviewRemote({ packaged: app.isPackaged, version: app.getVersion(), channel: prefs.updateChannel }) });
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
        filters: [{ name: 'Seshboard theme', extensions: ['json', 'jsonc'] }],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    }
    case 'check-file':
      return typeof command.path === 'string' && isLocalAbsolutePath(command.path, process.platform) ? themes.check(command.path) : { ok: false, error: "Seshboard couldn't read this file.", fileName: '' };
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
          filters: [{ name: 'Seshboard theme', extensions: ['json'] }],
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
/** The window with the sidebar; null while it is closed (macOS keeps running without it). */
let mainWindow: BrowserWindow | null = null;
/** Pop-out windows by the session each one shows. */
const popouts = new Map<string, BrowserWindow>();
/**
 * How each pop-out's session has its panels laid out, by session (a `SessionView`, which main never looks inside): what
 * the main window had when the session popped out, then what the pop-out last reported. It goes back to the main window
 * when the pop-out goes. In memory only.
 */
const popoutViews = new Map<string, SessionView>();
/** The session on screen in each window (by webContents id), as its renderer reports it. */
const focusedSessions = new Map<number, string | null>();

/** The session on screen in the window in front, or null when no Seshboard window has focus. */
function sessionOnScreen(): string | null {
  const win = BrowserWindow.getFocusedWindow();
  return win ? (focusedSessions.get(win.webContents.id) ?? null) : null;
}
const recordedNotifications: RecordedAlert[] = [];
/** Scheduled runs the engine reported (the smoke run's schedules step reads their titles). */
const recordedScheduleRuns: ScheduleRunEvent[] = [];
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

/** Open at login for scripted runs, which never add Seshboard to the real login items. */
let scriptedOpenAtLogin: OpenAtLogin = 'off';
/** How Open at login stands. A development build would add Electron itself, and Electron has no login items on Linux. */
function readOpenAtLogin(): OpenAtLogin {
  if (scripted) return scriptedOpenAtLogin;
  if (!app.isPackaged || !loginItemsSettingsUrl(process.platform)) return 'unavailable';
  return openAtLoginFrom(app.getLoginItemSettings(), process.platform);
}
ipcMain.handle(IpcChannel.getOpenAtLogin, () => readOpenAtLogin());
ipcMain.handle(IpcChannel.setOpenAtLogin, (_event, on: unknown) => {
  if (typeof on !== 'boolean' || readOpenAtLogin() === 'unavailable') return readOpenAtLogin();
  if (scripted) return (scriptedOpenAtLogin = on ? 'on' : 'off');
  try {
    // On Windows `enabled` also turns it back on when Task Manager or Startup apps turned it off.
    app.setLoginItemSettings({ openAtLogin: on, enabled: on });
  } catch {
    // The answer below says how it really stands.
  }
  return readOpenAtLogin();
});
ipcMain.on(IpcChannel.openLoginItemsSettings, () => {
  const url = loginItemsSettingsUrl(process.platform);
  if (url && !scripted) void shell.openExternal(url);
});

/**
 * The `seshboard`, `sesh` and `switchboard` shell commands (Settings › General › Shell command), or null in a development
 * build, whose commands would start Electron. Scripted runs keep them in their throwaway profile and never touch the PATH.
 */
function shellCommandHere(): ShellCommandPlan | null {
  if (!app.isPackaged && !scripted) return null;
  const dir = scripted ? join(app.getPath('userData'), 'shell-command') : shellCommandDir(process.platform, { home: homedir(), userData: app.getPath('userData') });
  // macOS opens the bundle (…/Seshboard.app); an AppImage runs from a folder that changes each time, so its own file.
  const target = process.platform === 'darwin' ? resolve(process.execPath, '../../..') : process.env.APPIMAGE || process.execPath;
  // A scripted run looks only in its own profile, so the machine's commands never change what it sees.
  const lookIn = scripted ? [] : commandFolders(process.platform, homedir(), process.env.PATH);
  return shellCommandPlan(process.platform, dir, target, process.env, lookIn);
}
ipcMain.handle(IpcChannel.shellCommand, async (_event, action: unknown): Promise<ShellCommandResult> => {
  const plan = shellCommandHere();
  if (!plan) return { state: { status: 'unavailable', names: [...SHELL_COMMAND_NAMES], dir: '', taken: [] }, error: null };
  // On Windows the commands' folder goes on the user's PATH.
  const editsPath = process.platform === 'win32' && !scripted;
  let error: string | null = null;
  try {
    if (action === 'install') await installShellCommand(plan, editsPath);
    else if (action === 'remove') await removeShellCommand(plan, editsPath);
  } catch (caught) {
    if (!(caught instanceof Cancelled)) error = caught instanceof Error ? caught.message : String(caught);
  }
  // Reading the PATH can fail too (no PowerShell); the files still say most of it.
  const state = await readShellCommand(plan, pathCheck(plan, editsPath)).catch(() => readShellCommand(plan));
  return { state, error };
});

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

ipcMain.on(IpcChannel.focusSession, (event, sessionId: unknown) => {
  focusedSessions.set(event.sender.id, typeof sessionId === 'string' ? sessionId : null);
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

/** Shows a session: in its pop-out when it has one, otherwise in the main window. */
function openSession(sessionId: string): void {
  const popout = popouts.get(sessionId);
  if (popout && !popout.isDestroyed()) return bringToFront(popout);
  sendToWindow(showWindow(), IpcChannel.selectSession, sessionId, { latestOnly: true });
}

async function handleEngineRequest(message: unknown): Promise<unknown> {
  const request = message as { type?: unknown; id?: unknown; key?: unknown; paths?: unknown; repoRoot?: unknown; configDir?: unknown; memoryDir?: unknown; instructionsRoot?: unknown; on?: unknown } | null;
  // Keep awake until done: a session with the flag on works, or the last one finished.
  if (request?.type === 'keep-awake') {
    sessionsAwake.apply(request.on === true);
    return undefined;
  }
  // Remote's keys, only asked for once Remote is on or another computer is paired (so the keychain is left alone otherwise).
  if (request?.type === 'remote-identity' && typeof request.id === 'number') {
    try {
      const key = request.key === 'device' ? 'device' : 'identity';
      return { type: 'remote-identity-result', id: request.id, secret: scripted ? throwawayRemoteKey(key) : remoteIdentity(app.getPath('userData'), key) };
    } catch (error) {
      console.error('[main] Remote key unavailable', error);
      return { type: 'remote-identity-result', id: request.id, secret: null };
    }
  }
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
    const win = mainWindow;
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
      .showMessageBox({ type: 'question', message: 'Quit Seshboard?', detail: 'Sessions running in Seshboard will stop.', buttons: ['Quit', 'Cancel'], defaultId: 0, cancelId: 1 })
      .then(({ response }) => quitGuard.answer(response === 0 ? 'quit' : 'cancel'));
  },
  quit: () => quitApp(),
});

ipcMain.on(IpcChannel.quitAnswer, (_event, answer: unknown) => {
  if (answer === 'quit' || answer === 'cancel') quitGuard.answer(answer);
});

/**
 * A session with a large context is open and Settings › Usage warns about it on quitting (or hasn't said yet that it
 * can): the window reports it, so quitting asks even with Ask before quitting off.
 */
let quitContext = false;
ipcMain.on(IpcChannel.quitContext, (_event, ask: unknown) => {
  quitContext = ask === true;
});
/** Whether ⌘Q (or closing the window on Windows and Linux) asks first. */
const asksBeforeQuit = () => preferences.get().confirmQuit || quitContext;

/**
 * Messages that arrived before a window could take them: the link that launched the app, a notification
 * clicked after the window was closed (a new one is still loading), Settings… with no window open.
 */
const pendingMessages = new RendererQueue();

function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** The pop-out a menu item was clicked in, or null (the main window is meant). */
function popoutIn(win: Electron.BaseWindow | undefined): BrowserWindow | null {
  return [...popouts.values()].find((popout) => popout === win && !popout.isDestroyed()) ?? null;
}

/** The main window, to show something in: created if it was closed, and brought to the front. */
function showWindow(): BrowserWindow {
  const win = mainWindow ?? createWindow();
  bringToFront(win);
  return win;
}

/** Sends now if the window's renderer is listening, otherwise when it reports ready. */
function sendToWindow(win: BrowserWindow, channel: string, payload: unknown, options: { latestOnly?: boolean } = {}): void {
  if (readyRenderers.has(win.webContents.id)) win.webContents.send(channel, payload);
  else pendingMessages.push(channel, payload, options);
}

/**
 * Opens a `seshboard://` link. It is validated here, then handed to the window, which fills in New
 * session (never sends) or shows the session. A refused link only shows why.
 */
function openDeepLink(url: string): void {
  // Only brings the window up (the VS Code companion starting Seshboard); before 'ready' the window opens anyway.
  if (isShowLink(url)) {
    if (app.isReady()) showWindow();
    return;
  }
  const parsed = parseDeepLink(url);
  console.log(`[main] link: ${parsed.ok ? parsed.link.action : `refused (${parsed.error})`}`);
  deliverLinkMessage(parsed.ok ? { link: parsed.link } : { error: parsed.error });
}

/** Hands a link (or why one was refused) to the window, or keeps it until the window is ready. */
function deliverLinkMessage(message: DeepLinkMessage): void {
  if (!app.isReady()) {
    pendingMessages.push(IpcChannel.deepLink, message);
    return;
  }
  sendToWindow(showWindow(), IpcChannel.deepLink, message);
}

/**
 * A folder on the command line opens New session there: `seshboard .` runs the executable with the folder on Windows
 * and Linux (on macOS it sends a link). Returns false when the command line has no folder.
 */
function openFolderArgument(argv: string[], workingDirectory: string): boolean {
  // A development build runs as `electron <app>`.
  const folder = folderFromArgv(argv.slice(process.defaultApp ? 2 : 1), workingDirectory, process.platform);
  if (!folder) return false;
  let isFolder = false;
  try {
    isFolder = statSync(folder).isDirectory();
  } catch {
    // Not there: said below.
  }
  if (isFolder) openDeepLink(`${DEEP_LINK_SCHEME}://new-session?cwd=${encodeURIComponent(folder)}`);
  else deliverLinkMessage({ error: `${folder} is not a folder.` });
  return true;
}

// The smoke test checks quitting without ending its own run.
const quitApp = () => (smokeOutDir ? (quitRecorded = true) : app.quit());
/** Set once the app is quitting, so closing its windows on the way out doesn't ask again. */
let quitting = false;

function openSettings(section: 'about' | null = null): void {
  sendToWindow(showWindow(), IpcChannel.openSettings, section, { latestOnly: true });
}

/** Seshboard → Check for Updates…: checks, and opens Settings → About where the result shows. */
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
  const quit: MenuItemConstructorOptions = { id: 'quit', label: mac ? 'Quit Seshboard' : 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => (asksBeforeQuit() ? quitGuard.request() : quitApp()) };
  const settings: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() };
  const checkUpdates: MenuItemConstructorOptions = { id: 'check-updates', label: 'Check for Updates…', click: () => checkForUpdates() };
  const top: MenuItemConstructorOptions[] = mac
    ? [
        {
          label: 'Seshboard',
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
        // The page handles ⌘/ itself (in the terminal and the message box too), so the menu only shows the key. The sheet opens in
        // the window in front: a pop-out has its own, for its session.
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          registerAccelerator: false,
          click: (_item, focused) => sendToWindow(popoutIn(focused) ?? showWindow(), IpcChannel.toggleShortcuts, null, { latestOnly: true }),
        },
        // On macOS these are in the app menu; Windows and Linux have none.
        ...(mac ? [] : ([{ type: 'separator' }, checkUpdates, { label: 'About Seshboard', click: () => openSettings('about') }] satisfies MenuItemConstructorOptions[])),
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

/** Every window's page: sandboxed, with the preload as its only way to main. */
const webPreferences = (): Electron.WebPreferences => ({
  preload: join(here, '../preload/index.cjs'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
});

/**
 * macOS: the traffic lights over the content. Elsewhere the system's own title bar, which follows light and dark
 * mode, and the menu bar shows with Alt (the command palette has every command).
 */
const titleBar = (): Electron.BrowserWindowConstructorOptions =>
  process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: WINDOW_BUTTONS.default } : { autoHideMenuBar: true };

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
    ...titleBar(),
    ...windowIcon(),
    backgroundColor: windowBackground(),
    webPreferences: webPreferences(),
  });
  mainWindow = win;

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
    if (process.platform === 'darwin' || quitting || scripted || !asksBeforeQuit()) return;
    event.preventDefault();
    quitGuard.request();
  });
  // Pop-outs go with the main window: without it there is no sidebar to come back to.
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    for (const popout of [...popouts.values()]) if (!popout.isDestroyed()) popout.close();
  });
  loadRenderer(win);
  return win;
}

/** What every window's page needs: ready tracking, a reload after a crash, links in the browser, and the page itself. */
function loadRenderer(win: BrowserWindow, popout?: string): void {
  const contentsId = win.webContents.id;
  // Only a new page in the window itself: `did-start-loading` also fires for frames inside it (a previewed HTML file),
  // and the page says it is ready only once, so it would never count as ready again.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) readyRenderers.delete(contentsId);
  });
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
  win.on('closed', () => {
    readyRenderers.delete(contentsId);
    focusedSessions.delete(contentsId);
  });

  // The renderer is a local app: links open in the browser, never inside the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    if (popout) url.searchParams.set(POPOUT_QUERY, popout);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(join(here, '../renderer/index.html'), popout ? { query: { [POPOUT_QUERY]: popout } } : undefined);
  }
}

/** Tells every window which sessions have a window of their own. */
function broadcastPopouts(): void {
  const ids = [...popouts.keys()];
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.popoutsChanged, ids);
}

/**
 * Shows a session in a window of its own, beside the main window, or brings its pop-out to the front. It shows
 * the session and nothing else; closing it only closes the window (the session keeps running) and never asks
 * to quit. Pop-outs aren't saved: they close with the main window and don't come back after a restart.
 */
function popOut(sessionId: string, view: unknown = null): void {
  const open = popouts.get(sessionId);
  if (open && !open.isDestroyed()) return bringToFront(open);
  if (isSessionView(view)) popoutViews.set(sessionId, view);
  else popoutViews.delete(sessionId);
  const from = mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized() ? mainWindow.getBounds() : null;
  const placed = from ? placePopout(from, screen.getDisplayMatching(from).workArea, POPOUT_SIZE, POPOUT_MIN, popouts.size) : undefined;
  const win = new BrowserWindow({
    ...POPOUT_SIZE,
    ...placed,
    minWidth: POPOUT_MIN.width,
    minHeight: POPOUT_MIN.height,
    show: false,
    ...titleBar(),
    ...windowIcon(),
    backgroundColor: windowBackground(),
    webPreferences: webPreferences(),
  });
  popouts.set(sessionId, win);
  win.once('ready-to-show', () => win.show());
  // Looking at a pop-out is looking at Seshboard: the main window's taskbar button stops flashing (Notifier).
  if (process.platform !== 'darwin') win.on('focus', () => mainWindow?.flashFrame(false));
  win.on('closed', () => {
    if (popouts.get(sessionId) !== win) return;
    popouts.delete(sessionId);
    broadcastPopouts();
    // Closed with the window's button, the header's ×, or by archiving: the main window gets the panels as they were left
    // (it has none to get when it is closing, which is why the pop-outs close: `mainWindow` is null by then).
    if (!quitting) returnView(sessionId, false);
  });
  loadRenderer(win, sessionId);
  broadcastPopouts();
}

/** A panel view is a plain object; main passes it on without reading it. */
function isSessionView(view: unknown): view is SessionView {
  return !!view && typeof view === 'object' && !Array.isArray(view);
}

/**
 * Hands a session's panels, as its pop-out left them, to the main window and forgets them here. `create`: the window is made
 * when there is none (Move back to main window shows the session there); otherwise a closed main window gets nothing.
 */
function returnView(sessionId: string, create: boolean): void {
  const view = popoutViews.get(sessionId);
  popoutViews.delete(sessionId);
  if (!view) return;
  const win = create ? showWindow() : mainWindow;
  if (!win || win.isDestroyed()) return;
  sendToWindow(win, IpcChannel.viewReturned, { sessionId, view });
}

ipcMain.on(IpcChannel.getPopouts, (event) => {
  event.returnValue = [...popouts.keys()];
});
ipcMain.on(IpcChannel.getPopoutView, (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = [...popouts].find(([, popout]) => popout === win);
  event.returnValue = entry ? (popoutViews.get(entry[0]) ?? null) : null;
});
ipcMain.on(IpcChannel.popOut, (_event, sessionId: unknown, view: unknown) => {
  if (typeof sessionId === 'string' && sessionId) popOut(sessionId, view);
});
// A pop-out keeps main up to date with its session's panels, for when it goes.
ipcMain.on(IpcChannel.reportView, (event, view: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = [...popouts].find(([, popout]) => popout === win);
  if (entry && isSessionView(view)) popoutViews.set(entry[0], view);
});
// Move back to main window: the session leaves its pop-out first, so the main window shows it in a pane.
ipcMain.on(IpcChannel.popIn, (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = [...popouts].find(([, popout]) => popout === win);
  if (!win || !entry) return;
  popouts.delete(entry[0]);
  broadcastPopouts();
  win.close();
  // The panels first, so the pane shows them from its first paint.
  returnView(entry[0], true);
  openSession(entry[0]);
});
ipcMain.on(IpcChannel.showSession, (_event, sessionId: unknown) => {
  if (typeof sessionId === 'string' && sessionId) openSession(sessionId);
});
// An app-wide shortcut pressed in a pop-out runs in the main window, which comes to the front for it.
ipcMain.on(IpcChannel.forwardKeys, (_event, keys: unknown) => {
  if (!keys || typeof keys !== 'object' || typeof (keys as { key?: unknown }).key !== 'string') return;
  sendToWindow(showWindow(), IpcChannel.keysForwarded, keys);
});
// A view a pop-out doesn't have (Settings, Usage, a project, New session, Go to, Search) opens in the main window, which comes to the front.
const MAIN_REQUESTS = new Set(['settings', 'usage', 'project', 'new-session', 'go-to', 'search', 'navigate', 'upcoming']);
ipcMain.on(IpcChannel.showInMain, (_event, request: unknown) => {
  if (!request || typeof request !== 'object' || !MAIN_REQUESTS.has((request as { kind?: unknown }).kind as string)) return;
  sendToWindow(showWindow(), IpcChannel.mainRequested, request);
});
// Unsent messages typed in one window show in the others (only the main window saves them).
ipcMain.on(IpcChannel.relayDrafts, (event, change: unknown) => {
  if (!change || typeof change !== 'object') return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.id !== event.sender.id) win.webContents.send(IpcChannel.draftsRelayed, change);
  }
});
// A new pop-out takes the main window's drafts, with their images (saved drafts have none).
ipcMain.on(IpcChannel.requestDrafts, (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id !== event.sender.id) mainWindow.webContents.send(IpcChannel.draftsRequested);
});

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
  // A smoke or screenshot run has no one to answer the dialog: a step that needs one sets the folder to pick, once.
  const answer = scripted ? process.env.SESHBOARD_PICK_FOLDER : undefined;
  if (answer) {
    delete process.env.SESHBOARD_PICK_FOLDER;
    return answer;
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a folder for the new session',
    properties: ['openDirectory', 'createDirectory'],
    ...(typeof defaultPath === 'string' ? { defaultPath } : {}),
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(IpcChannel.pasteClipboard, (event) => {
  event.sender.paste();
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
  const name = typeof defaultName === 'string' && /^[\w.-]+\.json$/.test(defaultName) ? defaultName : 'seshboard-settings.json';
  const options: Electron.SaveDialogOptions = {
    title: 'Export Seshboard settings',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Seshboard settings', extensions: ['json'] }],
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
    title: 'Import Seshboard settings',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Seshboard settings', extensions: ['json'] }],
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

// Settings › Remote › Advanced: the engine writes it in the data folder, which is also main's userData.
ipcMain.on(IpcChannel.showRemoteLog, () => {
  const file = join(app.getPath('userData'), REMOTE_LOG_FILE);
  if (existsSync(file)) shell.showItemInFolder(file);
  else void shell.openPath(app.getPath('userData'));
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
  const win = BrowserWindow.fromWebContents(event.sender);
  // What waited for a window is for the main one; a pop-out only shows its session.
  if (!win || win !== mainWindow) return;
  for (const { channel, payload } of pendingMessages.drain()) event.sender.send(channel, payload);
  if (readyReports.length === 1) {
    console.log(`[main] engine connected ${timed.connectedMs}ms, diagnostics loaded ${timed.loadedMs}ms after process start`);
  }
  if (smokeOutDir) void runSmokeStep(win);
  if (screenshotOutDir && readyReports.length === 1) {
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
      // A choice applies to that prompt only: the next New session starts from the defaults again, so pick Auto anew.
      // Wait for its folder first: the project's defaults arrive with it and would replace an earlier pick.
      if (!(await waitInPage(win, `!!document.querySelector('${view} [data-folder-select]')?.dataset.value && document.querySelector('${view} [data-model-select]')?.dataset.value === ${JSON.stringify(previousModel)}`, 3_000))) return 'New session remembered Auto instead of starting from the defaults';
      if (!(await chooseChoice(win, 'model', 'auto', view))) return 'could not pick Auto again';
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
 * Optional live step (SESHBOARD_SMOKE_LIVE_CWD): starts a real Haiku session
 * through the UI, approves its permission prompt and waits for the reply.
 */
async function runLiveSessionStep(win: BrowserWindow, cwd: string): Promise<string> {
  const click = (selector: string) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shot = async (name: string) => writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage()).toPNG());
  await click('[data-new-session]');
  // Pick the sandbox in the folder picker: open it, filter by the path, choose the match.
  await openFolderFilter(win);
  if (!(await waitInPage(win, "document.querySelector('[data-folder-list] input')", 3_000))) return 'folder picker did not open';
  // A typed path lists the folder; choosing it adds it to the throwaway profile's projects and picks it.
  const suggestion = `document.querySelector(${JSON.stringify(`[data-path-suggestion=${JSON.stringify(cwd)}]`)})`;
  await setFieldValue(win, '[data-folder-list] input', cwd);
  if (!(await waitInPage(win, suggestion, 5_000))) return 'folder not offered';
  await shot('folder-picker.png');
  await win.webContents.executeJavaScript(`${suggestion}.click()`);
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
// npm run smoke -- --only "<pattern>": only the steps whose label matches (case-insensitive), to check one while building.
const smokeOnly = process.env.SESHBOARD_SMOKE_ONLY ? new RegExp(process.env.SESHBOARD_SMOKE_ONLY, 'i') : null;
const RESTART_STEP = 'engine restarted and renderer reconnected';
const smokeRun = new SmokeRun({ log: (line) => console.log(line), cleanup: () => closeOverlays(mainWindow ?? undefined), only: smokeOnly });

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

  // Changes also lives on the right: the terminal stays there as a tab, behind Changes until you pick it.
  let changes = 'no Changes button (not a git checkout)';
  if (await js("document.querySelector('[data-current-session] [data-toggle-changes]') !== null")) {
    await js("document.querySelector('[data-current-session] [data-toggle-changes]').click()");
    if (!(await waitInPage(win, `document.querySelector('[data-changes-panel]') && !document.querySelector('[data-terminal-panel]') && document.querySelector('[data-right-tab="terminal"][aria-selected="false"]')`, 3_000))) {
      return 'failed: with Changes open the terminal did not wait behind it as a tab';
    }
    await shot(win, 'terminal-with-changes.png');
    await js(`document.querySelector('[data-right-tab="terminal"]').click()`);
    if (!(await waitInPage(win, "!document.querySelector('[data-changes-panel]') && document.querySelector('[data-terminal-panel]')?.dataset.terminalDockSide === 'right' && document.querySelector('[data-terminal-panel] [data-right-tabs]')", 3_000))) {
      return 'failed: the Terminal tab did not bring the terminal to the front on the right';
    }
    // Behind the terminal, the Changes button brings Changes to the front first; the second click closes it.
    await js("document.querySelector('[data-current-session] [data-toggle-changes]').click()");
    await js("document.querySelector('[data-current-session] [data-toggle-changes]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-changes-panel]') && !document.querySelector('[data-right-tabs]') && document.querySelector('[data-terminal-panel]')?.dataset.terminalDockSide === 'right'", 3_000))) {
      return 'failed: closing Changes did not leave the terminal alone on the right';
    }
    changes = 'a tab next to Changes on the right, alone there again after';
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
  // The menu places itself once it has measured; a point taken before then can miss the item when the click lands.
  await settle(win);
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
  // Headless Linux runners can have no frame to capture yet (UnknownVizError). The picture is a by-product, not what a
  // step checks: try again after a frame, and only log if it still fails.
  for (let attempt = 1; ; attempt++) {
    try {
      writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage()).toPNG());
      return;
    } catch (error) {
      if (attempt === 3) return void console.log(`[smoke] could not take ${name}: ${error instanceof Error ? error.message : String(error)}`);
      await settle(win, 1_000);
    }
  }
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
    // Middle-click on a tab closes it.
    const tabs = "document.querySelectorAll('[data-terminal-panel] [role=tab]')";
    const before = (await js(`${tabs}.length`)) as number;
    await js("document.querySelector('[data-terminal-panel] [data-new-terminal]').click()");
    if (!(await waitInPage(win, `${tabs}.length === ${before + 1}`, 5_000))) return 'failed: a second tab did not open';
    await js(`${tabs}[${before}].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))`);
    if (!(await waitInPage(win, `${tabs}.length === ${before}`, 3_000))) return 'failed: middle-click did not close the tab';
    return `ok: ran a command in ${read()}, and middle-click closed a tab`;
  } finally {
    rmSync(marker, { force: true });
    // Leave the next run's panel closed again.
    await js("document.querySelector('[data-terminal-panel]') && document.querySelector('[data-toggle-terminal]')?.click()");
  }
}
/**
 * A session in its own window is the whole session: the header has the panel buttons (and Move back to main
 * window and Close window in place of Open in new window and Close session), Ask opens as a panel next to the
 * conversation, the terminal's key shows and hides the terminal panel there, and at the smallest size a panel
 * doesn't push anything out of the window. The palette key opens the command palette in the pop-out, with the session's
 * commands (Toggle agents opens its panel there) and none of the panes', the sidebar's or Home's, and its Go to session…
 * opens Go to in the main window; the shortcuts sheet opens there too. Move back to main window then shows the session
 * in the main window again. The panels go with the session: Ask open in the main window is open in the pop-out, and
 * what the pop-out leaves open (the terminal, with Ask closed) is what the main window shows after Move back; closing
 * the pop-out with its button hands the panels back the same way.
 */
async function runPopoutStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const id = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  if (!id) return 'failed: no session is open to pop out';
  const mainView = `document.querySelector('[data-current-session="${id}"]')`;
  const mainHas = (selector: string) => `${mainView} && ${mainView}.querySelector('${selector}')`;
  // Ask open here, so the pop-out has to open with it (the main window's own button, which hands the panels over).
  if (await js(`!!${mainHas('[data-ask-panel]')}`)) await js(`${mainView}.querySelector('[data-toggle-ask]').click()`);
  if (!(await waitInPage(win, `!(${mainHas('[data-ask-panel]')})`, 3_000))) return 'failed: Ask did not close in the main window';
  await js(`${mainView}.querySelector('[data-toggle-ask]').click()`);
  if (!(await waitInPage(win, mainHas('[data-ask-panel]'), 5_000))) return 'failed: Ask did not open in the main window';
  if (!(await js(`!!${mainView}.querySelector('[data-open-in-new-window]')`))) return 'failed: the main window has no Open in new window button';
  await js(`${mainView}.querySelector('[data-open-in-new-window]').click()`);
  let pop: BrowserWindow | undefined;
  try {
    if (!(await until(() => popouts.has(id), 5_000))) return 'failed: the pop-out did not open';
    pop = popouts.get(id)!;
    const popJs = (code: string) => pop!.webContents.executeJavaScript(code);
    const inPop = (expression: string, timeoutMs = 5_000) => waitInPage(pop!, expression, timeoutMs);
    pop.webContents.debugger.attach('1.3');
    await pop.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const view = `document.querySelector('[data-current-session="${id}"]')`;
    if (!(await inPop(`${view} && ${view}.querySelector('[data-panel-toggles]')`, 20_000))) return 'failed: the pop-out shows no panel buttons';
    // Its pane in the main window closes: the session is open in one window.
    if (!(await waitInPage(win, `!document.querySelector('[data-current-session="${id}"]')`, 5_000))) return 'failed: the main window still shows the session';
    const header = (await popJs(
      `({ moveBack: !!document.querySelector('[data-move-to-main-window]'), closeWindow: !!document.querySelector('[data-close-window]'), newWindow: !!document.querySelector('[data-open-in-new-window]'), closeSession: !!document.querySelector('[data-close-session]'), sidebarToggle: !!document.querySelector('[data-sidebar-toggle]'), ask: !!document.querySelector('[data-toggle-ask]'), terminal: !!document.querySelector('[data-toggle-terminal]'), width: window.innerWidth })`,
    )) as Record<string, boolean | number>;
    if (!header.moveBack || !header.closeWindow) return `failed: no Move back to main window or Close window (${JSON.stringify(header)})`;
    if (header.newWindow || header.closeSession || header.sidebarToggle) return `failed: the pop-out's header has a main window button (${JSON.stringify(header)})`;
    if (!header.ask || !header.terminal) return `failed: the panel buttons are missing (${JSON.stringify(header)})`;
    const wide = header.width as number;
    // Ask was open in the main window: it is open here, beside the conversation, and closes again.
    if (!(await inPop("document.querySelector('[data-ask-panel]')"))) return 'failed: Ask, open in the main window, is not open in the pop-out';
    const askBeside = (await popJs("(() => { const a = document.querySelector('[data-ask-panel]').getBoundingClientRect(); return a.left >= 300 && a.right <= window.innerWidth + 1; })()")) as boolean;
    if (!askBeside) return 'failed: the Ask panel does not sit beside the conversation';
    await popJs("document.querySelector('[data-toggle-ask]').click()");
    if (!(await inPop("!document.querySelector('[data-ask-panel]')"))) return 'failed: Ask did not close in the pop-out';
    // The terminal's key, which is the window's own shortcut, shows and hides the terminal panel in the pop-out.
    pressKey(pop, 'J', ['meta']);
    if (!(await inPop("document.querySelector('[data-terminal-panel]')", 8_000))) return "failed: the terminal's key did not open the terminal in the pop-out";
    await shot(pop, 'popout.png');
    pressKey(pop, 'J', ['meta']);
    if (!(await inPop("!document.querySelector('[data-terminal-panel]')", 5_000))) return "failed: the terminal's key did not close the terminal in the pop-out";
    // The command palette opens in the pop-out, not the main window, with the session's commands and none of the main window's.
    if (!(await openPalette(pop, 'K', ['meta'], 'commands'))) return "failed: the palette's key did not open the command palette in the pop-out";
    if (await waitInPage(win, "!!document.querySelector('[data-command-palette]')", 500)) return 'failed: the palette key also opened the command palette in the main window';
    const offered = (await popJs(
      "(() => { const has = (id) => !!document.querySelector('[data-command-palette] [data-palette-command=\"' + id + '\"]'); return { session: has('copy-session-id') && has('toggle-agents'), main: has('go-to-session') && has('new-session') && has('quick-question'), panes: ['focus-other-pane', 'swap-panes', 'close-pane'].some(has), sidebar: ['toggle-sidebar', 'sidebar-close'].some(has), home: has('home'), newWindow: has('open-in-new-window'), first: document.querySelector('[data-command-palette] [data-palette-group]')?.dataset.paletteGroup ?? null }; })()",
    )) as { session: boolean; main: boolean; panes: boolean; sidebar: boolean; home: boolean; newWindow: boolean; first: string | null };
    if (!offered.session || offered.first !== 'session') return `failed: the pop-out's palette does not lead with this session's commands (${JSON.stringify(offered)})`;
    if (!offered.main) return `failed: the pop-out's palette lacks New session, Quick question or Go to (${JSON.stringify(offered)})`;
    if (offered.panes || offered.sidebar || offered.home || offered.newWindow) return `failed: the pop-out's palette offers a command for the main window's panes, sidebar or Home (${JSON.stringify(offered)})`;
    // No way into Go to from inside: ⌫ in the empty field stays, and "+" is text.
    pressKey(pop, 'Backspace');
    await settle(pop);
    if ((await popJs(PALETTE_MODE)) !== 'commands') return "failed: ⌫ in the pop-out's palette left the commands";
    await shot(pop, 'popout-palette.png');
    // Toggle agents runs on this window's session: its Agents panel opens in the pop-out.
    await setFieldValue(pop, '[data-palette-input]', 'toggle agents');
    if (!(await inPop("document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand === 'toggle-agents'", 3_000))) return '"toggle agents" did not rank Toggle agents first in the pop-out';
    pressKey(pop, 'Return');
    if (!(await inPop("document.querySelector('[data-agents-panel]') && !document.querySelector('[data-command-palette]')", 5_000))) return "failed: Toggle agents in the pop-out's palette did not open the Agents panel there";
    if (await waitInPage(win, `!!document.querySelector('[data-current-session="${id}"] [data-agents-panel]')`, 300)) return 'failed: Toggle agents opened a panel in the main window';
    // And again, to put it back.
    if (!(await openPalette(pop, 'K', ['meta'], 'commands'))) return 'failed: the pop-out palette did not open a second time';
    await setFieldValue(pop, '[data-palette-input]', 'toggle agents');
    await inPop("document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand === 'toggle-agents'", 3_000);
    pressKey(pop, 'Return');
    if (!(await inPop("!document.querySelector('[data-agents-panel]')", 5_000))) return 'failed: Toggle agents did not close the Agents panel in the pop-out';
    // Go to is the main window's: picking it brings the main window's Go to up and leaves none here.
    if (!(await openPalette(pop, 'K', ['meta'], 'commands'))) return 'failed: the pop-out palette did not open a third time';
    await setFieldValue(pop, '[data-palette-input]', 'go to session');
    await inPop("document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand === 'go-to-session'", 3_000);
    pressKey(pop, 'Return');
    if (!(await waitInPage(win, `${PALETTE_MODE} === 'goto'`, 5_000))) return 'failed: Go to session… in the pop-out did not open Go to in the main window';
    if (!(await inPop("!document.querySelector('[data-command-palette]')", 3_000))) return "failed: the pop-out's palette stayed open after Go to session…";
    if (!(await closePalette(win))) return "failed: Esc did not close the main window's Go to";
    // The shortcuts sheet opens in the pop-out too.
    pressKey(pop, '/', ['meta']);
    if (!(await inPop("document.querySelector('[data-shortcuts-sheet]')", 5_000))) return "failed: the shortcuts key did not open the shortcuts sheet in the pop-out";
    pressKey(pop, 'Escape');
    if (!(await inPop("!document.querySelector('[data-shortcuts-sheet]')", 3_000))) return 'failed: Esc did not close the shortcuts sheet in the pop-out';
    // The smallest window with a panel open: the panel takes the whole view and nothing sticks out.
    pop.setSize(POPOUT_MIN.width, 700);
    if (!(await inPop(`window.innerWidth <= ${POPOUT_MIN.width + 20}`, 3_000))) return 'failed: the pop-out did not shrink';
    await popJs("document.querySelector('[data-toggle-ask]').click()");
    if (!(await inPop("document.querySelector('[data-ask-panel]')"))) return 'failed: Ask did not open in the narrow pop-out';
    await shot(pop, 'popout-narrow.png');
    const fits = (await popJs(
      `(() => { const w = window.innerWidth; const edge = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return !r || (r.left >= 0 && r.right <= w + 1); }; return { page: document.documentElement.scrollWidth <= w, ask: edge('[data-ask-panel]') && document.querySelector('[data-ask-panel]').getBoundingClientRect().width >= w - 2, back: edge('[data-move-to-main-window]'), close: edge('[data-close-window]'), toggles: edge('[data-panel-toggles]'), w }; })()`,
    )) as { page: boolean; ask: boolean; back: boolean; close: boolean; toggles: boolean; w: number };
    if (!Object.values(fits).every(Boolean)) return `failed: something sticks out of a ${fits.w}px pop-out (${JSON.stringify(fits)})`;
    await popJs("document.querySelector('[data-toggle-ask]').click()");
    // The conversation comes back when the panel goes.
    if (!(await inPop("!document.querySelector('[data-ask-panel]') && document.querySelector('[data-current-session] textarea')?.getBoundingClientRect().width > 100"))) return 'failed: the conversation did not come back when the panel closed in the narrow pop-out';
    // The terminal, with Ask closed: Move back brings the session to the main window with exactly that.
    await popJs("document.querySelector('[data-toggle-terminal]').click()");
    if (!(await inPop("document.querySelector('[data-terminal-panel]')", 8_000))) return 'failed: the terminal button did not open the terminal in the pop-out';
    await popJs("document.querySelector('[data-move-to-main-window]').click()");
    if (!(await waitInPage(win, mainHas('[data-terminal-panel]'), 8_000))) return 'failed: Move back to main window did not show the session, with the terminal the pop-out left open, in the main window';
    if (await js(`!!${mainHas('[data-ask-panel]')}`)) return 'failed: Ask is open in the main window after it was closed in the pop-out (the panels from before it popped out came back)';
    if (!(await until(() => !popouts.has(id), 3_000))) return 'failed: the pop-out is still registered after moving back';
    // And the other way, with the window's button: it opens with the terminal, Ask opens there, and closing it leaves both open in the main window.
    await js(`${mainView}.querySelector('[data-open-in-new-window]').click()`);
    if (!(await until(() => popouts.has(id), 5_000))) return 'failed: the pop-out did not open the second time';
    pop = popouts.get(id)!;
    if (!(await inPop("document.querySelector('[data-terminal-panel]')", 20_000))) return 'failed: the terminal, open in the main window, is not open in the second pop-out';
    await popJs("document.querySelector('[data-toggle-ask]').click()");
    if (!(await inPop("document.querySelector('[data-ask-panel]')"))) return 'failed: Ask did not open in the second pop-out';
    await popJs("document.querySelector('[data-close-window]').click()");
    if (!(await until(() => !popouts.has(id), 5_000))) return 'failed: the pop-out did not close with its button';
    openSession(id);
    if (!(await waitInPage(win, `${mainHas('[data-terminal-panel]')} && ${mainHas('[data-ask-panel]')}`, 8_000))) return 'failed: the main window did not show the panels the closed pop-out left open (terminal and Ask)';
    // Put the main window's panels back as they were.
    await js(`${mainView}.querySelector('[data-toggle-ask]').click()`);
    pressKey(win, 'J', ['meta']);
    if (!(await waitInPage(win, `!(${mainHas('[data-ask-panel]')}) && !(${mainHas('[data-terminal-panel]')})`, 5_000))) return 'failed: the panels did not close again in the main window';
    return `ok: panel buttons, Ask beside the conversation and the terminal key work in a ${wide}px pop-out; the palette and the shortcuts sheet open there, Toggle agents opens its panel and Go to session… goes to the main window; a panel fills a ${fits.w}px pop-out and nothing sticks out; Ask open in the main window opens in the pop-out, and the panels the pop-out leaves open come back with the session (Move back, and the window's button)`;
  } finally {
    // A failed step must not leave the session in a window of its own for the steps after it.
    if (popouts.has(id)) {
      const open = popouts.get(id)!;
      popouts.delete(id);
      popoutViews.delete(id);
      broadcastPopouts();
      if (!open.isDestroyed()) open.close();
      openSession(id);
    }
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
  const prompt = "[...document.querySelectorAll('[role=alertdialog]')].find((el) => el.innerText.includes('Quit Seshboard'))";
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

  // Turning off "sessions from other apps" leaves only Seshboard's own in the sidebar.
  await section('sidebar');
  await click('[data-session-scope]');
  const scoped = await withSettingsClosed("document.querySelector('[data-session-list]') && !document.querySelector('[data-session-id][data-in-app=\"false\"]')");
  await section('sidebar');

  await section('projects');
  await click('[data-project-order="yours"]');
  await section('general');
  // Open at login goes to the faked login item (scripted runs never touch the real one), and back off.
  const loginSwitch = "document.querySelector('[data-open-at-login]')";
  const loginReady = await waitInPage(win, `${loginSwitch} && !${loginSwitch}.disabled && ${loginSwitch}.getAttribute('aria-checked') === 'false'`, 3_000);
  await click('[data-open-at-login]');
  const loginOn = loginReady && (await until(() => scriptedOpenAtLogin === 'on', 2_000)) && (await waitInPage(win, `${loginSwitch}.getAttribute('aria-checked') === 'true'`, 2_000));
  await click('[data-open-at-login]');
  const loginOff = await until(() => scriptedOpenAtLogin === 'off', 2_000);
  // Keep awake holds sleep off for real (caffeinate on macOS, the sleep blocker elsewhere) and lets go when turned off.
  const awakeStatus = "document.querySelector('[data-keep-awake-status]')";
  await click('[data-keep-awake]');
  const awakeOn = (await until(() => preferences.get().keepAwake && keepAwake.active, 2_000)) && (await waitInPage(win, awakeStatus, 2_000));
  await click('[data-keep-awake]');
  const awakeOff = (await until(() => !preferences.get().keepAwake && !keepAwake.active, 2_000)) && (await waitInPage(win, `!${awakeStatus}`, 2_000));
  await click('[data-startup-view="new"]');
  await click('[data-confirm-quit]');
  await until(() => !preferences.get().confirmQuit);
  Menu.getApplicationMenu()?.getMenuItemById('quit')?.click();
  const quitWithoutAsking = quitRecorded && !quitGuard.asking;
  quitRecorded = false;
  const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8')) as Record<string, unknown>;
  const menuChecked = Menu.getApplicationMenu()?.getMenuItemById('scheme-dark')?.checked === true;

  await click('[data-confirm-quit]');
  await click('[data-startup-view="home"]');
  await section('projects');
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
  if (!loginOn) return 'Open at login did not turn on';
  if (!loginOff) return 'Open at login did not turn off again';
  if (!awakeOn) return `Keep awake did not turn on, or showed no status (saved ${preferences.get().keepAwake}, active ${keepAwake.active})`;
  if (!awakeOff) return `Keep awake did not let go (saved ${preferences.get().keepAwake}, active ${keepAwake.active})`;
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
 * Settings' menu groups its pages under App, Claude, Your work and Connect, with Backup, Diagnostics and About under
 * a line at the bottom. ↓ skips the headers, Pipelines opens its page, search keeps the groups with its results in the
 * menu's order, and a short window scrolls the menu without the bottom block overlapping Connect. Read-only.
 */
async function runSettingsGroupsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const key = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const nav = '[data-settings] [data-settings-nav]';
  await js("document.querySelector('[data-settings]') || document.querySelector('[data-open-settings]').click()");
  if (!(await waitInPage(win, `document.querySelector('${nav} [data-settings-group="bottom"]')`, 3_000))) return 'no grouped menu in Settings';

  const layout = (await js(`(() => {
    const groups = [...document.querySelectorAll('${nav} [data-settings-group]')];
    return groups.map((g) => ({
      group: g.dataset.settingsGroup,
      role: g.getAttribute('role'),
      label: g.getAttribute('aria-labelledby') ? document.getElementById(g.getAttribute('aria-labelledby'))?.textContent.trim() : g.getAttribute('aria-label'),
      pages: [...g.querySelectorAll('[data-settings-section]')].map((b) => b.dataset.settingsSection),
      border: getComputedStyle(g).borderTopWidth,
    }));
  })()`)) as Array<{ group: string; role: string | null; label: string | undefined; pages: string[]; border: string }>;
  const order = layout.map((g) => `${g.group}:${g.label}`).join(', ');
  if (order !== 'app:App, claude:Claude, work:Your work, connect:Connect, bottom:More') return `the groups were ${order}`;
  if (layout.some((g) => g.role !== 'group')) return 'a group is not a role="group"';
  const bottom = layout.at(-1)!;
  if (bottom.pages.join(',') !== 'backup,diagnostics,about') return `the bottom block holds ${bottom.pages.join(', ')}`;
  if (bottom.border !== '1px') return `the bottom block's top border is ${bottom.border}`;
  const pageCount = layout.reduce((n, g) => n + g.pages.length, 0);
  if (pageCount !== 19) return `the menu lists ${pageCount} pages, not 19`;

  // ↓ from the last page of App lands on Conversation: the Claude header is skipped.
  await js(`document.querySelector('${nav} [data-settings-section="focus"]').focus()`);
  key('Down');
  if (!(await waitInPage(win, "document.activeElement?.dataset.settingsSection === 'conversation'", 2_000))) return '↓ from Focus did not move to Conversation';
  key('Up');
  if (!(await waitInPage(win, "document.activeElement?.dataset.settingsSection === 'focus'", 2_000))) return '↑ from Conversation did not move back to Focus';

  await js(`document.querySelector('${nav} [data-settings-section="pipelines"]').click()`);
  if (!(await waitInPage(win, `document.querySelector('[data-settings-page="pipelines"]') && document.querySelector('${nav} [aria-current="page"]')?.dataset.settingsSection === 'pipelines'`, 3_000))) return 'Pipelines did not open its page';
  await shot(win, 'settings-groups.png');

  // Search: the headers stay, and the results follow the menu's order.
  await setFieldValue(win, '[data-settings-search]', 'archive');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-settings-results-page]').length > 1", 2_000))) return '"archive" found results on fewer than 2 pages';
  const searching = (await js(`(() => {
    const menu = [...document.querySelectorAll('${nav} [data-settings-section]')].map((b) => b.dataset.settingsSection);
    const results = [...document.querySelectorAll('[data-settings-results-page]')].map((r) => r.dataset.settingsResultsPage);
    return { groups: document.querySelectorAll('${nav} [data-settings-group]').length, results, places: results.map((p) => menu.indexOf(p)) };
  })()`)) as { groups: number; results: string[]; places: number[] };
  await shot(win, 'settings-groups-search.png');
  if (searching.groups !== 5) return `while searching the menu showed ${searching.groups} groups`;
  if (searching.places.some((place, i) => place < 0 || (i > 0 && place < searching.places[i - 1]!))) return `the results for "archive" were not in the menu's order: ${searching.results.join(', ')}`;
  await setFieldValue(win, '[data-settings-search]', '');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page]')", 2_000))) return 'emptying the search did not bring the page back';

  // A short window: the menu scrolls as one list, and the bottom block comes after Connect without overlapping it.
  const [width, height] = win.getSize();
  win.setSize(width!, 560);
  try {
    const short = `(() => {
      const nav = document.querySelector('${nav}');
      const connect = nav.querySelector('[data-settings-group="connect"]').getBoundingClientRect();
      const bottom = nav.querySelector('[data-settings-group="bottom"]').getBoundingClientRect();
      return nav.scrollHeight > nav.clientHeight && bottom.top >= connect.bottom;
    })()`;
    if (!(await waitInPage(win, short, 3_000))) return 'in a short window the menu did not scroll, or the bottom block overlapped Connect';
  } finally {
    win.setSize(width!, height!);
  }
  await js("document.querySelector('[data-close-settings]')?.click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-settings]')", 2_000))) return 'Settings did not close';
  return `ok: ${order}; ${pageCount} pages, ↓ skips headers, Pipelines opens, "archive" keeps the groups with results in menu order (${searching.results.join(', ')}), a short window scrolls`;
}

/**
 * Settings › General › Global permission mode: Ask before edits (the default) doesn't keep a mode picked in New
 * session, Remember last brings it back, and a fixed mode is what New session's mode chip starts on, where the
 * project and its profile set none (else theirs wins). Runs before any step types in New session, since an unsent
 * prompt there keeps the choices it was written with. Starts no session; only the throwaway profile's preference
 * changes, and it is put back, with the session that was open.
 */
async function runNewSessionModeStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const view = '[data-new-session-view]';
  const chip = `document.querySelector('${view} [data-mode-select]')`;
  const open = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  /** New session opened afresh (from Home, so it mounts again): the mode its chip starts on, once it has settled. */
  const freshMode = async () => {
    await js("document.querySelector('[data-go-home]')?.click()");
    await waitInPage(win, `!${chip}`, 2_000);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
    if (!(await waitInPage(win, `${chip}?.dataset.value`, 5_000))) return null;
    await settle(win);
    return (await js(`${chip}.dataset.value`)) as string;
  };
  const setMode = async (mode: string) => {
    await js("document.querySelector('[data-open-settings]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"general\"]')", 3_000))) return false;
    await js("document.querySelector('[data-settings-section=\"general\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-new-session-mode]')", 2_000))) return false;
    const picked = await chooseOption(win, '[data-new-session-mode]', mode);
    if (mode === 'remember') await shot(win, 'settings-new-session-mode.png');
    await js("document.querySelector('[data-close-settings]').click()");
    return picked && (await until(() => preferences.get().newSessionMode === mode));
  };

  if (preferences.get().newSessionMode !== 'default') return `the preference started as ${preferences.get().newSessionMode}, not Ask before edits`;
  const base = await freshMode();
  if (!base) return 'New session has no mode chip';
  // A mode the project or its profile sets wins over the global one.
  const inherited = base !== 'default';
  const expect = (global: string) => (inherited ? base : global);
  // Picked in New session: for this prompt only while the global mode is a fixed one.
  const picked = base === 'plan' ? 'acceptEdits' : 'plan';
  if (!(await chooseChoice(win, 'mode', picked, view))) return `could not pick ${picked} in New session's mode chip`;
  const afterPick = await freshMode();
  if (afterPick !== base) return `with Ask before edits, New session kept ${afterPick} instead of starting on ${base}`;
  if (!(await setMode('remember'))) return 'could not set the global permission mode to Remember last in Settings › General';
  const remembered = await freshMode();
  if (remembered !== expect(picked)) return `with Remember last, New session's mode chip starts on ${remembered}, not ${expect(picked)}`;
  const fixed = picked === 'plan' ? 'acceptEdits' : 'plan';
  if (!(await setMode(fixed))) return `could not set the global permission mode to ${fixed} in Settings › General`;
  const withFixed = await freshMode();
  if (withFixed !== expect(fixed)) return `with ${fixed} set, New session's mode chip starts on ${withFixed}, not ${expect(fixed)}`;
  if (!(await setMode('default'))) return 'could not set the global permission mode back to Ask before edits';
  const again = await freshMode();
  if (again !== base) return `back on Ask before edits, the chip starts on ${again}, not ${base}`;
  if (open) {
    openSession(open);
    if (!(await waitInPage(win, `document.querySelector('[data-current-session="${open}"]') && document.querySelector('[data-transcript-item]')`, 5_000))) return 'could not go back to the session that was open';
  }
  return `ok: ${picked} picked was not kept on Ask before edits (${base}${inherited ? ', from the project' : ''}), came back with Remember last; ${fixed} from Settings`;
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

  // Mark as read after: the seconds and the switch apply at once and are saved.
  const reading = preferences.get().markReadAfter;
  if (!(await js("!!document.querySelector('[data-mark-read-after]') && !!document.querySelector('[data-mark-read-seconds-more]')"))) return 'the Sessions page did not show Mark as read after';
  await click(reading.seconds < 60 ? '[data-mark-read-seconds-more]' : '[data-mark-read-seconds-less]');
  if (!(await until(() => preferences.get().markReadAfter.seconds !== reading.seconds))) return 'the seconds of Mark as read after did not change';
  await click('[data-mark-read-after]');
  if (!(await until(() => preferences.get().markReadAfter.enabled !== reading.enabled))) return 'the Mark as read after switch did not apply';
  updatePreferences({ markReadAfter: reading });
  if (!(await waitInPage(win, `document.querySelector('[data-mark-read-after]')?.getAttribute('aria-checked') === '${reading.enabled}'`, 2_000))) return 'Mark as read after did not go back';

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

/** Opens Projects unless it is on screen (its sidebar button leaves the view when it is). */
async function openProjectsView(win: BrowserWindow): Promise<boolean> {
  await win.webContents.executeJavaScript("document.querySelector('[data-projects-view]') || document.querySelector('[data-open-projects]')?.click()");
  return waitInPage(win, "document.querySelector('[data-projects-view]')", 3_000);
}

/** A right-click on a project's row in Projects, which opens the row menu (Rename…, Remove…). False without the row. */
function openProjectRowMenu(win: BrowserWindow, root: string): Promise<boolean> {
  return win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector(${JSON.stringify(`[data-project-row=${JSON.stringify(root)}]`)});
    if (!row) return false;
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 }));
    return true;
  })()`) as Promise<boolean>;
}

/**
 * Takes a project off the throwaway profile's list again, the way someone would: Projects, a right-click on its row,
 * Remove from Seshboard…, Remove. Nothing on disk changes. Returns what went wrong, or null.
 */
async function removeProjectInProjects(win: BrowserWindow, root: string): Promise<string | null> {
  if (!(await openProjectsView(win))) return 'Projects did not open';
  // A narrow view folds the list away: the header's ‹ shows it.
  await win.webContents.executeJavaScript("document.querySelector('[data-project-list]') || document.querySelector('[data-project-show-list]')?.click()");
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(`[data-project-row=${JSON.stringify(root)}]`)})`, 3_000))) return 'the project is not in Projects';
  await openProjectRowMenu(win, root);
  if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-remove-project]')", 2_000))) return "no Remove in the project's row menu";
  await win.webContents.executeJavaScript("document.querySelector('[role=menu] [data-remove-project]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 3_000))) return 'no confirmation before removing';
  await win.webContents.executeJavaScript("document.querySelector('[data-confirm]').click()");
  if (!(await waitInPage(win, `!document.querySelector(${JSON.stringify(`[data-project-row=${JSON.stringify(root)}]`)})`, 3_000))) return 'the project was not removed';
  return null;
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
  if (!(await waitInPage(win, "document.querySelector('[data-projects-view] [data-no-projects]')", 3_000))) return 'the Projects view did not open empty';
  const viewWidth = (await js("Math.round(document.querySelector('[data-projects-view]').getBoundingClientRect().width)")) as number;
  await click('[data-empty-add-project]');
  if (!(await waitInPage(win, "document.querySelector('[data-add-project-dialog] [data-known-project]')", 5_000))) return 'no folders with sessions offered';
  const known = (await js("document.querySelectorAll('[data-known-project]').length")) as number;
  // Seshboard's own repository when Claude Code has sessions there (a git repository, so the Worktrees tab has
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
  // The permission mode follows the profile's (and through it the global one), or skips it for the global one; each
  // says where it is set, and Change opens it there.
  if (!(await waitInPage(win, `${page('[data-default-mode]')}?.dataset.value === '' && ${page('[data-default-mode-hint="profile"]')}`, 2_000))) return 'the permission mode did not start on Profile default with its hint';
  await shot(win, 'project-permission-mode.png');
  if (!(await chooseOption(win, `${pageSelector} [data-default-mode]`, 'global'))) return 'could not pick Global default for the permission mode';
  if (!(await waitInPage(win, page('[data-default-mode-hint="global"]'), 2_000))) return 'Global default says nothing about where it is set';
  await js(`${page('[data-default-mode-open="global"]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"general\"] [data-new-session-mode]')", 3_000))) return "Global default's Change did not open Settings › General";
  await click('[data-close-settings]');
  if (!(await waitInPage(win, page('[data-default-mode]'), 3_000))) return 'closing Settings did not go back to the project';
  if (!(await chooseOption(win, `${pageSelector} [data-default-mode]`, ''))) return 'could not put the permission mode back on Profile default';

  // The page's other tabs, read-only: Overview, Sessions, and the worktrees of a real repository.
  const pageResult = await smokeRun.step('project page and worktrees', () => runProjectPageStep(win, root), { cleanup: false });
  await smokeRun.step('project branches', () => runProjectBranchesStep(win, root), { cleanup: false });
  await smokeRun.step('project memory and share dialog', () => runProjectMemoryStep(win, root), { cleanup: false });
  await smokeRun.step('settings › memory', () => runMemorySettingsStep(win, root), { cleanup: false });
  await smokeRun.step('projects view: a row opens its Overview, the gear its Settings, ⌥↓ the next project on Settings, the switcher, ⌥⇧↑ and drag to reorder', () => runProjectsViewStep(win, root), { cleanup: false });

  // The Overview says how sessions start here, with the saved default.
  await js(`${page('[data-project-tab="overview"]')}.click()`);
  if (!(await waitInPage(win, `${page('[data-overview-defaults]')}?.innerText.includes('high effort')`, 3_000))) return 'the effort default was not saved';
  await shot(win, 'projects.png');

  // Renaming only changes the name Seshboard shows, in place on the Settings tab; it reaches the list and the sidebar filter too.
  const renameDialog = "document.querySelector('[data-rename-project-dialog]')";
  const folder = basename(root);
  await js(`${page('[data-project-tab="settings"]')}.click()`);
  if (!(await waitInPage(win, `${page('[data-project-name-input]')}?.value === ${JSON.stringify(folder)}`, 3_000))) return "no Name field with the folder's name on the Settings tab";
  await js(`${page('[data-project-name-input]')}.focus()`);
  await setFieldValue(win, `${pageSelector} [data-project-name-input]`, 'Smoke project');
  pressKey(win, 'Return');
  // The list is folded away in a narrow window.
  if (!(await waitInPage(win, `${page('[data-project-name]')}.innerText.includes('Smoke project') && (!${row()} || ${row()}.innerText.includes('Smoke project'))`, 3_000))) return 'the new name did not reach the project page and the list';

  // A project's ⋯ menu in the sidebar filter: one real click outside closes the filter and the menu.
  const more = `[data-project-filter-menu] [data-project-more=${JSON.stringify(root)}]`;
  await click('[data-project-filter]');
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(more)})`, 2_000))) return 'the project is not in the sidebar filter';
  if ((await js(`document.querySelector(${JSON.stringify(more)}).getAttribute('aria-label')`)) !== 'Options for Smoke project') return 'the sidebar filter does not show the new name';
  if (!(await js(`!!document.querySelector(${JSON.stringify(`[data-project-filter-menu] [data-project-open-page=${JSON.stringify(root)}]`)}) && !!document.querySelector('[data-project-filter-menu] [data-manage-projects]')`))) return 'the sidebar filter has no › on the project or no Manage projects…';
  await click(more);
  if (!(await waitInPage(win, "document.querySelectorAll('[role=menu]').length === 2", 2_000))) return 'the project options menu did not open from the filter';
  const outside = (await js("(() => { const r = document.querySelector('[data-project-page]').getBoundingClientRect(); return { x: Math.round(r.right - 24), y: Math.round(r.bottom - 24) }; })()")) as { x: number; y: number };
  win.webContents.sendInputEvent({ type: 'mouseDown', x: outside.x, y: outside.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: outside.x, y: outside.y, button: 'left', clickCount: 1 });
  if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'a click outside left the project options menu open';
  // The header's ⋯ (like the row's right-click menu) keeps Rename…, with Use folder name.
  await js(`${page('[data-project-more]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-rename-project]')", 2_000))) return "no Rename… in the project's ⋯ menu";
  await click('[role=menu] [data-rename-project]');
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
  await smokeRun.step('link a session with @', () => runLinkSessionStep(win), { cleanup: false });
  // Here New session has a folder (the project just added), so starting while Auto chooses can be checked too.
  await smokeRun.step('auto model: menu, chip, Stop while choosing, Auto off, settings', () => runAutoModelStep(win), { cleanup: false });
  await smokeRun.step('worktree name', () => runWorktreeNameStep(win), { cleanup: false });

  // Projects opens on the project last open; its Settings show the default saved from New session.
  await click('[data-open-projects]');
  if (!(await waitInPage(win, page('[data-project-tab="settings"]'), 3_000))) return 'Projects did not open on the project last open';
  await js(`${page('[data-project-tab="settings"]')}.click()`);
  if (!(await waitInPage(win, `${page('[data-default-effort]')}?.dataset.value === 'low'`, 3_000))) return 'the saved default did not reach the Projects view';
  // Removing is on the Settings tab too (it only takes the project off Seshboard's list).
  await js(`${page('[data-project-remove]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 3_000))) return 'no confirmation before removing';
  await click('[data-confirm]');
  if (!(await waitInPage(win, "document.querySelector('[data-projects-view] [data-no-projects]')", 3_000))) return 'the project was not removed';
  await click('[data-open-projects]');
  return `ok: ${known} folders offered (view ${viewWidth}px wide); added one and its page opened (${pageResult.startsWith('ok') ? 'tabs checked' : 'page step failed'}), dropdown keyboard and Escape, renamed it in place and back from its row menu, an outside click closed its filter menus, its defaults reached New session (git button: ${catchUp}), saved a change back, removed it from Settings`;
}

/**
 * The Projects view with three projects (the one under test and two more folders offered, removed again): a click on a
 * row opens its Overview, the gear on a hovered row its Settings, ⌥↓ the next project on the same tab, the name's
 * switcher another one, ⌥⇧↑ moves the open project with an announcement, and dragging the third project to the top
 * changes the order the sidebar's project menu shows. Only the throwaway profile's project list changes.
 */
async function runProjectsViewStep(win: BrowserWindow, root: string): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const listed = () => js("[...document.querySelectorAll('[data-project-list] [data-project-row]')].map((e) => e.dataset.projectRow)") as Promise<string[]>;
  const pageOf = (r: string) => `document.querySelector(${JSON.stringify(`[data-project-page=${JSON.stringify(r)}]`)})`;
  const onTab = (r: string, tab: string) => `${pageOf(r)}?.querySelector('[data-project-tab="${tab}"]')?.getAttribute('aria-selected') === 'true'`;
  const rowOf = (r: string) => `document.querySelector(${JSON.stringify(`[data-project-list] [data-project-row=${JSON.stringify(r)}]`)})`;
  /** Clicks the element `expression` finds; false when there is none. */
  const press = (expression: string) => js(`(() => { const el = ${expression}; el?.click(); return !!el; })()`) as Promise<boolean>;

  // Two more projects, from the folders Claude Code has sessions for.
  if (!(await openProjectsView(win))) return 'Projects did not open';
  // A narrow view folds the list away (the header's ‹ shows it): with the sidebar open, make room by closing it.
  const width = (await js("Math.round(document.querySelector('[data-projects-view]').getBoundingClientRect().width)")) as number;
  const madeRoom = (await js("!!document.querySelector('[data-projects-view][data-narrow]') && !!document.querySelector('[data-sidebar-open]')")) as boolean;
  if (madeRoom) {
    if (!(await press("document.querySelector('[data-projects-view] [data-sidebar-toggle]')"))) return 'no sidebar toggle in the narrow Projects view';
    if (!(await waitInPage(win, "!document.querySelector('[data-projects-view][data-narrow]') && document.querySelector('[data-project-list]')", 3_000))) return `the list did not show with the sidebar closed (view ${width}px wide)`;
  }
  if (!(await press("document.querySelector('[data-manager-add]')"))) return `no + in the list (view ${width}px wide, narrow: ${String(await js("!!document.querySelector('[data-projects-view][data-narrow]')"))})`;
  if (!(await waitInPage(win, "document.querySelector('[data-add-project-dialog] [data-known-project]')", 5_000))) return 'no folders offered';
  const extra = (await js("[...document.querySelectorAll('[data-known-project][data-added=\"false\"]')].slice(0, 2).map((e) => e.dataset.knownProject)")) as string[];
  for (const folder of extra) {
    await js(`document.querySelector(${JSON.stringify(`[data-known-project=${JSON.stringify(folder)}]`)}).click()`);
    await waitInPage(win, `document.querySelector(${JSON.stringify(`[data-known-project=${JSON.stringify(folder)}]`)})?.dataset.added === 'true'`, 3_000);
  }
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-add-project-dialog]')", 3_000))) return 'the Add project dialog did not close';
  try {
    if (extra.length < 2) return `ok: skipped, only ${extra.length + 1} folders to make projects of`;
    if (!(await waitInPage(win, "document.querySelectorAll('[data-project-list] [role=listbox] [data-project-row]').length === 3", 3_000))) return 'the list does not show the three projects';
    let order = await listed();

    // 1. A click on a project not opened yet: its Overview.
    // Closing the dialog opened the last folder added (on Settings); the other new one has no tab of its own yet.
    const open = (await js("document.querySelector('[data-project-list] [data-project-row][aria-selected=true]')?.dataset.projectRow ?? null")) as string | null;
    const unopened = extra.find((r) => r !== open) ?? extra[0]!;
    if (!(await press(rowOf(unopened)))) return 'the project not opened yet is not in the list';
    if (!(await waitInPage(win, `${onTab(unopened, 'overview')} && ${pageOf(unopened)}.querySelector('[data-project-overview]') && ${rowOf(unopened)}.getAttribute('aria-selected') === 'true'`, 3_000))) return 'a click on a row did not open its Overview';

    // 2. The gear on a hovered row (the first): that project's Settings.
    const first = order[0]!;
    const box = (await js(`(() => { const r = ${rowOf(first)}.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
    win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
    const gear = `${rowOf(first)}.querySelector('[data-project-row-settings]')`;
    if (!(await waitInPage(win, `${gear}?.offsetParent !== null`, 2_000))) return 'no gear on the hovered row';
    const at = (await js(`(() => { const r = ${gear}.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    if (!(await waitInPage(win, onTab(first, 'settings'), 3_000))) return "the gear did not open the project's Settings";

    // 3. ⌥↓: the next project in the list, still on Settings.
    pressKey(win, 'Down', ['alt']);
    if (!(await waitInPage(win, onTab(order[1]!, 'settings'), 3_000))) return '⌥↓ did not open the next project on Settings';
    if (!(await js(`document.querySelector('[data-project-panel-heading]')?.innerText.includes('Settings')`))) return "the tab panel's heading does not say where it is";

    // 4. The name's switcher: part of a name, ↩, and that project opens on the same tab.
    const target = order[2]!;
    const name = (await js(`${rowOf(target)}.querySelector('[data-project-open] span').innerText`)) as string;
    if (!(await press(`${pageOf(order[1]!)}?.querySelector('[data-project-switcher-button]')`))) return "no switcher on the project's name";
    if (!(await waitInPage(win, "document.activeElement?.matches('[data-project-switcher] [role=combobox]')", 2_000))) return 'the switcher did not open with its search field';
    await setFieldValue(win, '[data-project-switcher-search]', name.slice(0, Math.max(3, name.length - 2)));
    const picked = (await js("document.querySelector('[data-project-switcher] [role=option][aria-selected=true]')?.dataset.projectSwitcherOption ?? null")) as string | null;
    if (!picked) return `the switcher found nothing for "${name}"`;
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `!document.querySelector('[data-project-switcher]') && ${onTab(picked, 'settings')}`, 3_000))) return '↩ in the switcher did not open the project on the same tab';

    // 5. ⌥⇧↑ moves the open project up one place and says so.
    const position = order.indexOf(picked);
    if (position > 0) {
      pressKey(win, 'Up', ['alt', 'shift']);
      if (!(await waitInPage(win, `(document.querySelector('[data-project-announcement]')?.innerText ?? '').includes('moved to position ${position} of 3')`, 3_000))) return '⌥⇧↑ did not announce the move';
      if (!(await waitInPage(win, `[...document.querySelectorAll('[data-project-list] [data-project-row]')].map((e) => e.dataset.projectRow).indexOf(${JSON.stringify(picked)}) === ${position - 1}`, 3_000))) return '⌥⇧↑ did not move the project';
    }

    // 6. Drag the third project to the top: the sidebar's project menu follows.
    order = await listed();
    const dragged = order[2]!;
    await js(`(() => {
      const source = ${rowOf(dragged)};
      const target = ${rowOf(order[0]!)};
      const data = new DataTransfer();
      const r = target.getBoundingClientRect();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + 20, clientY: r.top + 4 }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + 20, clientY: r.top + 4 }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    })()`);
    if (!(await waitInPage(win, `document.querySelector('[data-project-list] [data-project-row]')?.dataset.projectRow === ${JSON.stringify(dragged)}`, 3_000))) return 'dragging the third project to the top did not move it';
    await shot(win, 'projects-view.png');
    if (madeRoom) {
      await press("document.querySelector('[data-sidebar-toggle]')");
      if (!(await waitInPage(win, "document.querySelector('[data-sidebar-open]')", 3_000))) return 'the sidebar did not open again';
    }
    if (!(await press("document.querySelector('[data-project-filter]')"))) return 'no project menu in the sidebar';
    const menuOrder = `[...document.querySelectorAll('[data-project-filter-menu] [data-project-root]')].map((e) => e.dataset.projectRoot)`;
    const expected = [dragged, ...order.filter((r) => r !== dragged)];
    const followed = await waitInPage(win, `JSON.stringify(${menuOrder}) === ${JSON.stringify(JSON.stringify(expected))}`, 3_000);
    pressKey(win, 'Escape');
    await waitInPage(win, "!document.querySelector('[data-project-filter-menu]')", 2_000);
    if (!followed) return `the sidebar's project menu did not follow the drag (${String(await js(`JSON.stringify(${menuOrder})`))})`;
    return `ok (view ${width}px${madeRoom ? ', sidebar closed for the list' : ''}): a click opened the Overview, the hovered gear Settings, ⌥↓ the next project on Settings, the switcher another on the same tab, ⌥⇧↑ moved it and said so, a drag to the top reached the sidebar menu`;
  } finally {
    for (const folder of extra) await removeProjectInProjects(win, folder);
    // Back on the project under test, with the sidebar as it was, as the steps after this one expect. With the sidebar
    // open again the view may be narrow, the list folded away: the header's ‹ shows it.
    await js("document.querySelector('[data-project-list]') || document.querySelector('[data-project-show-list]')?.click()");
    await waitInPage(win, rowOf(root), 3_000);
    await js(`${rowOf(root)}?.click()`);
    await waitInPage(win, pageOf(root), 3_000);
    if (madeRoom && !(await js("!!document.querySelector('[data-sidebar-open]')"))) {
      await js("document.querySelector('[data-sidebar-toggle]')?.click()");
      await waitInPage(win, "document.querySelector('[data-sidebar-open]')", 3_000);
    }
  }
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

  // The header's ⋯ opens the icon choices, the name and Remove (only opened and closed: picking an image needs the system dialog).
  await js(`${q('[data-project-more]')}.click()`);
  if (!(await waitInPage(win, "[...document.querySelectorAll('[role=menu] [role=menuitem]')].some((e) => e.innerText.includes('Choose image')) && !!document.querySelector('[role=menu] [data-remove-project]')", 2_000))) return "the project's ⋯ did not open its menu";
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return 'Escape did not close the ⋯ menu';

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
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [MOD_MODIFIER, 'shift'] });
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
  // Sign in now off, so no Claude Code starts in the terminal.
  await click('[data-new-profile-sign-in]');
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
  // Sign in now is on by default; off here, so no Claude Code starts in the terminal.
  if ((await js("document.querySelector('[data-new-profile-sign-in]')?.getAttribute('aria-checked')")) !== 'true') return 'Sign in now was not on by default';
  await click('[data-new-profile-sign-in]');
  if (!(await waitInPage(win, "document.querySelector('[data-new-profile-sign-in]').getAttribute('aria-checked') === 'false'", 2_000))) return 'Sign in now did not turn off';
  await click('[data-add-profile-submit]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-profiles] [data-profile]').length === 2", 5_000))) {
    return `the profile was not added (${String(await js("document.querySelector('[data-add-profile-form]')?.innerText ?? ''"))})`;
  }
  const id = (await js("document.querySelectorAll('[data-profiles] [data-profile]')[1].dataset.profile")) as string;
  const card = `[data-profile=${JSON.stringify(id)}]`;
  if (!(await js(`document.querySelector(${JSON.stringify(card)}).innerText.includes(${JSON.stringify(folder)})`))) return 'the sign-in command does not name the folder';
  // The sandbox folder has no login, so the profile offers Sign in (not pressed: it would start Claude Code).
  if (!(await js(`!!document.querySelector(${JSON.stringify(`[data-profile-sign-in=${JSON.stringify(id)}]`)})`))) return 'the new profile did not offer Sign in';
  if (await js("!!document.querySelector('[data-terminal-panel]')")) return 'a terminal opened with Sign in now off';
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
    `['[data-check-updates]', '[data-auto-update]', '[data-update-channel="stable"][aria-checked=true]', '[data-update-channel="beta"]', '[data-changelog-link]'].filter((s) => !document.querySelector(s))`,
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
 * never clicked, and the engine refuses it in smoke runs anyway (SESHBOARD_NO_CLAUDE_UPDATE).
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
 * Settings › Remote: with Remote off and nothing paired, the three setup steps; then My own address and Turn on
 * Remote, and the status card (Running, or the port in use when another Seshboard has it, fixed with Use port …);
 * Change… and Advanced open; a made-up device (written straight into the throwaway profile's cache, so no phone is
 * needed) is renamed in place, and its Revoke asks first and Escape cancels. Remote is turned off again.
 */
async function runRemoteSettingsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const key = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  if (!(await waitInPage(win, `document.querySelector('[data-settings-section="remote"]')`, 3_000))) return 'Settings has no Remote section';
  await click('[data-settings-section="remote"]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-remote-setup] [data-remote-step]').length === 3", 5_000))) return 'Remote off with nothing paired did not show the three steps';
  await shot(win, 'remote-setup.png');

  // A paired device, made up: only its row is needed, never a connection.
  const db = new DatabaseSync(join(app.getPath('userData'), 'cache.sqlite'));
  try {
    db.prepare('INSERT OR REPLACE INTO remote_devices (id, name, kind, public_key, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)').run('smoke-device', 'Smoke phone', 'phone', `smoke-${Date.now()}`, Date.now() - 3 * 86_400_000, Date.now() - 6 * 3_600_000);
  } finally {
    db.close();
  }

  await click('[data-remote-tunnel-option="custom"]');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-custom-url] input')", 3_000))) return 'My own address showed no Address field';
  await setFieldValue(win, '[data-remote-custom-url] input', 'https://smoke.example.com');
  await click('[data-remote-turn-on]');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-status][role=status]')", 10_000))) return 'Turn on Remote showed no status card';
  let title = (await js("document.querySelector('[data-remote-status]').dataset.remoteStatusTitle")) as string;
  // Another Seshboard on this computer may have the port: the card's own fix moves to a free one.
  if (title.startsWith('Port ')) {
    await click('[data-remote-action="use-port"]');
    if (!(await waitInPage(win, "!document.querySelector('[data-remote-status]')?.dataset.remoteStatusTitle.startsWith('Port ')", 10_000))) return `Use port didn't help: ${title}`;
    title = `${title}, then ${(await js("document.querySelector('[data-remote-status]').dataset.remoteStatusTitle")) as string}`;
  }
  if (!(await waitInPage(win, `document.querySelector('[data-remote-device="smoke-device"]')`, 5_000))) return 'the made-up device is not in Paired devices';
  await shot(win, 'remote-running.png');

  await click('[data-remote-change-connection]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-remote-connection] [role=radio]').length === 4", 3_000))) return 'Change… did not open the four choices';
  if (await js("document.querySelector('[data-remote-advanced-toggle]').getAttribute('aria-expanded') === 'false'")) await click('[data-remote-advanced-toggle]');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-port-input]') && document.querySelector('[data-remote-security]') && document.querySelector('[data-remote-log] [data-remote-show-log]')", 3_000))) return 'Advanced did not show the port, the security note and Show log';
  await shot(win, 'remote-open.png');

  await click('[data-remote-device="smoke-device"] [data-remote-rename]');
  if (!(await waitInPage(win, "document.activeElement?.matches('[data-rename-field]')", 3_000))) return 'Rename did not focus the name';
  await win.webContents.insertText('Smoke tablet');
  key('Return');
  if (!(await waitInPage(win, `document.querySelector('[data-remote-device="smoke-device"]')?.innerText.includes('Smoke tablet')`, 5_000))) return 'the new name did not come back from the engine';

  await click('[data-remote-device="smoke-device"] [data-remote-revoke]');
  if (!(await waitInPage(win, "document.activeElement?.closest('[data-confirm-strip]')", 3_000))) return 'Revoke did not ask first with Cancel focused';
  key('Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-confirm-strip]') && document.activeElement?.matches('[data-remote-revoke]')", 3_000))) return "Escape did not cancel Revoke and give focus back to the row's Revoke";
  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) return 'Escape in the confirm closed Settings';

  await click('[data-remote-enabled]');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-off-card]')", 5_000))) return 'turned off with a paired device, the page did not say Remote is off';
  return `ok: three steps, status card "${title}", Change… and Advanced (with Show log) opened, device renamed, Revoke asked and Escape cancelled, turned off`;
}

/**
 * The sidebar's Connected to this Mac: with Remote on (My own address, from the step before), a test phone paired in
 * the throwaway profile's cache connects for real (the engine's `testPhone.ts`, with the smoke run's throwaway key).
 * Its row shows with the toast, the details popover opens and Escape closes it, and Revoke asks first and then
 * disconnects it: the row goes, the socket closes and the quiet "nobody connected" line is left. Remote is turned off
 * again, and the section goes with it.
 */
async function runConnectedDevicesStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const { generateKeyPair, keyPairFromSecret, toBase64Url, REMOTE_APP_URL } = await import('@seshboard/protocol');
  const phone = await import('../../../../packages/engine/src/remote/testPhone.ts');

  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  if (!(await waitInPage(win, `document.querySelector('[data-settings-section="remote"]')`, 3_000))) return 'Settings has no Remote section';
  await click('[data-settings-section="remote"]');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-enabled]')", 5_000))) return 'Settings › Remote has no switch';
  if ((await js("document.querySelector('[data-remote-enabled]').getAttribute('aria-checked')")) !== 'true') await click('[data-remote-enabled]');
  const title = () => js("document.querySelector('[data-remote-status]')?.dataset.remoteStatusTitle ?? ''") as Promise<string>;
  await waitInPage(win, "document.querySelector('[data-remote-status]')?.dataset.remoteStatusTitle", 10_000);
  // My own address, so no tunnel tool is needed; and the card's own fix when another Seshboard has the port.
  if ((await title()) === 'Add your address' || (await js("document.querySelector('[data-remote-connection]')?.innerText.includes('My own address')")) === false) {
    await click('[data-remote-change-connection]');
    await waitInPage(win, "document.querySelector('[data-remote-tunnel-option=\"custom\"]')", 3_000);
    await click('[data-remote-connection] [data-remote-tunnel-option="custom"]');
    await waitInPage(win, "document.querySelector('[data-remote-custom-url] input')", 3_000);
    await setFieldValue(win, '[data-remote-custom-url] input', 'https://smoke.example.com');
    await click('[data-remote-save-connection]');
  }
  if (await waitInPage(win, "document.querySelector('[data-remote-status]')?.dataset.remoteStatusTitle.startsWith('Port ')", 2_000)) await click('[data-remote-action="use-port"]');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-status]')?.dataset.remoteStatus === 'ok'", 10_000))) {
    return `Remote did not run: ${await js("document.querySelector('[data-remote-status]')?.dataset.remoteStatusTitle ?? 'no status card'")}`;
  }
  if (!(await js("document.querySelector('[data-remote-idle-line]')?.getAttribute('aria-checked') === 'true'"))) return '"Show in the sidebar when nobody is connected" is not on by default';
  pressKey(win, 'Escape');
  // The Settings button closes Settings too.
  if (!(await waitInPage(win, "!document.querySelector('[data-settings]')", 3_000))) await click('[data-open-settings]');
  if (!(await js("Boolean(document.querySelector('[data-sidebar-open]'))"))) {
    await click('[data-sidebar-toggle]');
    if (!(await waitInPage(win, "document.querySelector('[data-sidebar-open]')", 3_000))) return 'the sidebar did not open';
  }
  if (!(await waitInPage(win, "document.querySelector('[data-connected-devices=\"idle\"]')?.innerText.includes('nobody connected')", 5_000))) return 'Remote on with nobody connected showed no quiet line';

  // A test phone, paired three days ago in the throwaway profile's cache, connects with the engine's throwaway key.
  const keys = generateKeyPair();
  const db = new DatabaseSync(join(app.getPath('userData'), 'cache.sqlite'));
  let port: number;
  try {
    db.prepare('INSERT OR REPLACE INTO remote_devices (id, name, kind, public_key, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)').run('smoke-phone', 'Smoke iPhone', 'phone', toBase64Url(keys.publicKey), Date.now() - 3 * 86_400_000, Date.now() - 86_400_000);
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'remote.settings'").get() as { value: string } | undefined;
    port = (JSON.parse(row?.value ?? '{}') as { port?: number }).port ?? 0;
  } finally {
    db.close();
  }
  if (!port) return 'Remote has no port in the cache';
  const engineKey = keyPairFromSecret(new Uint8Array(Buffer.from(throwawayRemoteKey('identity'), 'base64'))).publicKey;
  const origin = new URL(process.env.SESHBOARD_REMOTE_APP_URL ?? REMOTE_APP_URL).origin;
  const socket = await phone.handshake(port, 'connect', keys, engineKey, undefined, origin);
  if (!socket.session) return `the test phone was refused (close code ${socket.code})`;
  const remote = phone.client<RemoteContract>(socket.frames, socket.session);
  try {
    await remote.call('hello', { client: { version: 'smoke' } });
    // The phone looks like this computer: it gets the theme in use, and the next one when another is picked.
    const themeBefore = preferences.get().themeId;
    const { theme } = await remote.call('theme.get', {});
    if (!theme) return 'theme.get gave the phone no theme';
    const changed = new Promise<string>((resolve) => remote.on('theme.changed', (next) => resolve(next.name)));
    updatePreferences({ themeId: themeBefore === 'aluminium' ? 'nord' : 'aluminium' });
    const name = await Promise.race([changed, new Promise<string>((resolve) => setTimeout(() => resolve(''), 5_000))]);
    updatePreferences({ themeId: themeBefore });
    if (name !== (themeBefore === 'aluminium' ? 'Nord' : 'Aluminium')) return `the phone did not get the theme picked here (got "${name}", had "${theme.name}")`;
    const row = '[data-connected-devices="devices"] [data-connected-device="smoke-phone"]';
    if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(row)})?.innerText.includes('Smoke iPhone')`, 5_000))) return 'the connected test phone has no row in the sidebar';
    if (!(await js(`/since /.test(document.querySelector(${JSON.stringify(row)}).innerText)`))) return 'the row does not say since when';
    const header = (await js("document.querySelector('[data-connected-devices-toggle]')?.getAttribute('aria-label')")) as string;
    if (!/1 device connected/.test(header)) return `the header's name has no count: "${header}"`;
    if (!(await waitInPage(win, "document.querySelector('[data-device-toast=\"smoke-phone\"]')", 3_000))) return 'no "connected" toast for a device paired days ago';
    await shot(win, 'connected-devices.png');

    // The details popover: a dialog named after the device, with no actions yet; Escape closes it.
    await click(`${row} [data-device-row]`);
    if (!(await waitInPage(win, "document.querySelector('[data-device-details][role=dialog]')?.getAttribute('aria-label') === 'Smoke iPhone'", 3_000))) return 'the row did not open its details';
    const details = (await js("document.querySelector('[data-device-details]').innerText")) as string;
    if (!details.includes('No actions yet') || !details.includes('Connected since') || !details.includes('3 days ago')) return `the details miss a line: ${details.replace(/\s+/g, ' ')}`;
    await shot(win, 'connected-devices-details.png');
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, "!document.querySelector('[data-device-details]') && document.activeElement?.matches('[data-device-row]')", 3_000))) return 'Escape did not close the details and give focus back to the row';

    // Revoke asks first, Escape cancels, then Revoke for real disconnects it.
    await click(`${row} [data-device-revoke]`);
    if (!(await waitInPage(win, `document.activeElement?.closest('${row} [data-confirm-strip]')`, 3_000))) return 'Revoke did not ask first with Cancel focused';
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, "!document.querySelector('[data-confirm-strip]') && document.activeElement?.matches('[data-device-revoke]')", 3_000))) return "Escape did not cancel and give focus back to the row's Revoke";
    await click(`${row} [data-device-revoke]`);
    await waitInPage(win, "document.querySelector('[data-confirm-strip] [data-confirm]')", 3_000);
    await click('[data-confirm-strip] [data-confirm]');
    const closed = await Promise.race([socket.closed.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000))]);
    if (!closed) return 'Revoke did not close the test phone\'s connection';
    if (!(await waitInPage(win, `!document.querySelector(${JSON.stringify(row)}) && document.querySelector('[data-connected-devices="idle"]')`, 5_000))) return 'the revoked device stayed in the sidebar';
  } finally {
    remote.dispose();
    socket.ws.close();
  }

  await click('[data-open-settings]');
  await waitInPage(win, `document.querySelector('[data-settings-section="remote"]')`, 3_000);
  await click('[data-settings-section="remote"]');
  await waitInPage(win, "document.querySelector('[data-remote-enabled]')", 3_000);
  await click('[data-remote-enabled]');
  const off = await waitInPage(win, "document.querySelector('[data-remote-off-card]') && !document.querySelector('[data-connected-devices]')", 5_000);
  pressKey(win, 'Escape');
  if (!off) return 'turned off, the sidebar still shows Remote';
  return 'ok: test phone connected, row and toast shown, details opened and closed, Revoke asked, cancelled, then disconnected it; idle line, then nothing once off';
}

/**
 * Other computers in the same app: pairs with the second computer the smoke script starts (scripts/remote-demo.ts, the
 * real Remote hub over made-up sessions, in a throwaway folder), through the link field in Settings › Remote. Then its
 * sessions are in the sidebar with the computer's chip and the Computers strip; one opens in the session view with the
 * violet line and "on Smoke Mac", its terminal button disabled with the reason; a background task there stops from
 * its pill; and New session with Run on set to it starts a session there, which opens here. Run on goes back to this
 * computer and the computer is removed again.
 */
async function runOtherComputerStep(win: BrowserWindow): Promise<string> {
  const linkFile = process.env.SESHBOARD_SMOKE_COMPUTER_LINK;
  if (!linkFile) return 'ok: skipped, no second computer (run through npm run smoke)';
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  if (!(await until(() => existsSync(linkFile), 20_000))) return 'the second computer wrote no pairing link';

  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  if (!(await waitInPage(win, `document.querySelector('[data-settings-section="remote"]')`, 3_000))) return 'Settings has no Remote section';
  await click('[data-settings-section="remote"]');
  if (!(await waitInPage(win, "document.querySelector('[data-computers-link]')", 5_000))) return 'Settings › Remote has no field for another computer’s link';
  await setFieldValue(win, '[data-computers-link]', readFileSync(linkFile, 'utf8').trim());
  await click('[data-computers-add]');
  if (!(await waitInPage(win, "document.querySelector('[data-computer][data-computer-state=\"connected\"]')", 20_000))) {
    return `the second computer did not connect: ${await js("document.querySelector('[data-computers-settings]')?.innerText.replace(/\\s+/g, ' ').slice(0, 200)")}`;
  }
  const computerId = (await js("document.querySelector('[data-computer]').dataset.computer")) as string;
  // A saved prompt for every project, plain text, to use in New session on that computer (4).
  const savedText = `Smoke saved prompt ${Date.now()}`;
  const savedRow = '[data-saved-prompt-row="smoke-remote-prompt"]';
  await click('[data-settings-section="prompts"]');
  if (!(await waitInPage(win, "document.querySelector('[data-saved-prompts-new]')", 3_000))) return 'Settings › Prompts has no New prompt';
  await click('[data-saved-prompts-new]');
  if (!(await waitInPage(win, `document.querySelector('[data-prompt-editor-dialog] [data-prompt-use-in="global"]')`, 3_000))) return 'New prompt did not open';
  await setFieldValue(win, '[data-prompt-editor-name]', 'Smoke remote prompt');
  await click('[data-prompt-use-in="global"]');
  await js("document.querySelector('[data-prompt-editor] [data-prompt-run]').focus()");
  await win.webContents.insertText(savedText);
  await click('[data-prompt-editor-save]');
  if (!(await waitInPage(win, `!document.querySelector('[data-prompt-editor-dialog]') && document.querySelector(${JSON.stringify(savedRow)})`, 3_000))) return 'the saved prompt was not listed in Settings › Prompts';
  // Close Settings: the sidebar stays, the main area comes back.
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-settings]')", 3_000))) await js("document.querySelector('[data-settings-close]')?.click()");

  // 1. Its sessions are in the sidebar, each with the computer's chip; the strip shows the computer.
  const row = `[data-session-list] [data-remote-row=${JSON.stringify(computerId)}]`;
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(row)})`, 10_000))) return 'no session of the other computer in the sidebar';
  const rows = (await js(`document.querySelectorAll(${JSON.stringify(row)}).length`)) as number;
  if (!(await js(`[...document.querySelectorAll(${JSON.stringify(row)})].every((r) => r.querySelector('[data-computer-chip="Smoke Mac"]'))`))) return 'a remote row has no chip with the computer’s name';
  if (!(await js(`Boolean(document.querySelector('[data-computers-strip] [data-computer-filter=${JSON.stringify(computerId)}]'))`))) return 'the Computers strip has no chip for the other computer';
  await shot(win, 'computers-sidebar.png');

  // 2. One opens in the session view, with the violet line and "on Smoke Mac".
  await js(`document.querySelector(${JSON.stringify(row)}).click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-remote-header]')", 5_000))) return 'a remote row did not open in the session view';
  const line = (await js("getComputedStyle(document.querySelector('[data-remote-header]')).boxShadow")) as string;
  if (!/inset/.test(line)) return `the remote header has no line along its top (box-shadow: ${line})`;
  const chip = (await js("document.querySelector('[data-remote-chip]')?.innerText.trim()")) as string | undefined;
  if (chip !== 'on Smoke Mac') return `the header chip says "${chip}", not "on Smoke Mac"`;
  if (!(await js(`[...document.querySelectorAll(${JSON.stringify(row)})].some((r) => r.getAttribute('aria-current') === 'true')`))) return 'the opened remote session is not selected in the sidebar';
  if (!(await waitInPage(win, "document.querySelector('[data-transcript] [data-prompt-bubble], [data-transcript] [data-remote-tools]')", 10_000))) return 'the remote conversation did not load';
  // Its cost, as that computer counts it, under the message box (while the estimate is on).
  if (preferences.get().showCost && !(await waitInPage(win, "document.querySelector('[data-remote-session-footer] [data-session-cost]')?.innerText.includes('≈')", 5_000))) return 'the remote session shows no cost under its message box';

  // 3. The terminal is on that computer: its button stays, disabled, with the reason.
  if (!(await js("document.querySelector('[data-remote-terminal]')?.disabled === true"))) return 'the terminal button of a remote session is not disabled';
  const why = (await js("document.querySelector('[data-remote-terminal]').parentElement.dataset.tooltip")) as string;
  if (why !== 'Terminal is on Smoke Mac. Not available from here.') return `the disabled terminal says "${why}"`;
  await shot(win, 'computers-session.png');

  // 3b. What a remote session runs in the background: its pill opens the list, and Stop stops the task there.
  const busy = `[...document.querySelectorAll(${JSON.stringify(row)})].find((r) => r.innerText.includes('Move the login form'))`;
  if (!(await js(`Boolean(${busy})`))) return 'the working session of the other computer is not in the sidebar';
  await js(`${busy}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-remote-session] [data-status-background]')", 5_000))) return 'the remote session shows no pill for its background task';
  await click('[data-remote-session] [data-status-background]');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-session] [data-background-tasks] [data-stop-task]')", 3_000))) return 'the background pill did not open the list of tasks';
  await click('[data-remote-session] [data-background-tasks] [data-stop-task]');
  if (!(await waitInPage(win, "!document.querySelector('[data-remote-session] [data-status-background]')", 5_000))) return 'Stop did not stop the background task on the other computer';

  // 4. New session with Run on set to it starts a session there, which opens here.
  await click('[data-new-session]');
  if (!(await waitInPage(win, `document.querySelector('[data-run-on-option=${JSON.stringify(computerId)}]')`, 5_000))) return 'New session has no Run on switch with the other computer';
  await click(`[data-run-on-option=${JSON.stringify(computerId)}]`);
  if (!(await waitInPage(win, "document.querySelector('[data-remote-new-session] [data-remote-project]')", 10_000))) return 'Run on the other computer showed none of its projects';
  // Nothing typed for it: the sidebar's + starts on this computer again.
  await click('[data-new-session]');
  if (!(await waitInPage(win, `!document.querySelector('[data-remote-new-session]') && document.querySelector('[data-run-on]')?.dataset.runOn === 'local'`, 3_000))) return 'the sidebar’s + opened New session on the other computer with nothing typed for it';
  await click(`[data-run-on-option=${JSON.stringify(computerId)}]`);
  if (!(await waitInPage(win, "document.querySelector('[data-remote-new-session] [data-remote-project]')", 10_000))) return 'Run on the other computer did not come back';
  // tideline by name, not the first tile: tiles follow that computer's activity, and harbor-api's profile (Work) starts
  // in a new worktree, which shows no branch.
  const tideline = `[data-remote-new-session] [data-remote-project][data-tooltip="tideline"]`;
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(tideline)})`, 3_000))) return `New session on the other computer has no tideline tile (${await js("[...document.querySelectorAll('[data-remote-new-session] [data-remote-project]')].map((t) => t.dataset.tooltip).join(', ')")})`;
  // The same rows as here: two letters for an icon (harbor-api is HA), and no monitor badge, as the Run on switch says where.
  const harbor = `[data-remote-new-session] [data-project-row][data-tooltip="harbor-api"] [data-project-initials]`;
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(harbor)})?.dataset.projectInitials === 'HA'`, 3_000))) return `harbor-api on the other computer has no two letters (${await js(`document.querySelector(${JSON.stringify(harbor)})?.dataset.projectInitials`)})`;
  if (await js("Boolean(document.querySelector('[data-remote-new-session] [data-project-list] [data-remote-badge]'))")) return 'the projects on the other computer still have the monitor badge';
  await click(tideline);
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(tideline)})?.getAttribute('aria-selected') === 'true'`, 3_000))) return 'New session on the other computer did not pick tideline';
  // On the current checkout, the branch checked out there shows, and another one can be picked to check out first.
  const routeBranch = "document.querySelector('[data-remote-new-session] [data-route-branch]')?.innerText";
  if (!(await waitInPage(win, `${routeBranch} === 'main'`, 5_000))) return `the route shows no branch on the other computer (${await js(routeBranch)})`;
  await click('[data-remote-branch-select]');
  if (!(await waitInPage(win, `document.querySelector('[data-menu="remote-branch"] [data-choice="feat/onboarding"]')`, 3_000))) return 'the branch menu does not list the other computer’s branches';
  await click('[data-menu="remote-branch"] [data-choice="feat/onboarding"]');
  if (!(await waitInPage(win, `${routeBranch} === 'feat/onboarding'`, 3_000))) return `picking a branch did not show in the route (${await js(routeBranch)})`;
  // The saved prompt, picked with / in the message box.
  const prompt = savedText;
  await js("document.querySelector('[data-remote-new-session] textarea').focus()");
  await win.webContents.insertText('/smoke');
  if (!(await waitInPage(win, "document.querySelector('[data-remote-new-session] [data-saved-prompt-option=\"smoke-remote-prompt\"]')", 3_000))) return 'typing / in New session on the other computer did not list the saved prompt';
  await js(`document.querySelector('[data-remote-new-session] [data-saved-prompt-option="smoke-remote-prompt"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  if (!(await waitInPage(win, "document.querySelector('[data-remote-new-session] [data-saved-prompt-header]') && document.querySelector('[data-remote-new-session] textarea').value === ''", 3_000))) return `picking the saved prompt did not put it over the message box, without the / (the box has "${await js("document.querySelector('[data-remote-new-session] textarea')?.value")}")`;
  // A prompt typed for it: the sidebar's + carries the pen, and stays on the other computer, with the prompt.
  const pen = `document.querySelector('[data-remote-new-session-draft]')?.dataset.remoteNewSessionDraft === ${JSON.stringify(computerId)} && document.querySelector('[data-new-session]').getAttribute('aria-label') === 'New session · unsent prompt on Smoke Mac'`;
  if (!(await waitInPage(win, pen, 3_000))) return `the sidebar’s + has no pen for the prompt typed for the other computer (${await js("document.querySelector('[data-new-session]').getAttribute('aria-label')")})`;
  await click('[data-new-session]');
  await settle(win);
  if (!(await js("Boolean(document.querySelector('[data-remote-new-session] [data-saved-prompt-header]'))"))) return 'the sidebar’s + left the other computer while a prompt was typed for it';
  if (!(await waitInPage(win, "document.querySelector('[data-remote-start]') && !document.querySelector('[data-remote-start]').disabled", 3_000))) return 'Start on Smoke Mac stayed disabled with a project and a prompt';
  const label = (await js("document.querySelector('[data-remote-start]').innerText")) as string;
  await shot(win, 'computers-new-session.png');
  await click('[data-remote-start]');
  if (!(await waitInPage(win, `document.querySelector('[data-remote-header] h1')?.innerText === ${JSON.stringify(prompt)}`, 10_000))) return `the session started on the other computer did not open here (${await js("document.querySelector('[data-computer-empty]')?.innerText ?? document.querySelector('[data-remote-header] h1')?.innerText")})`;
  if (!(await waitInPage(win, "!document.querySelector('[data-remote-new-session-draft]')", 3_000))) return 'the pen stayed on the sidebar’s + after the session started on the other computer';

  // Clean up: Run on back on this computer, the saved prompt deleted and the computer removed.
  await click('[data-new-session]');
  await waitInPage(win, `document.querySelector('[data-run-on-option="local"]')`, 3_000);
  await click('[data-run-on-option="local"]');
  await click('[data-open-settings]');
  await waitInPage(win, `document.querySelector('[data-settings-section="prompts"]')`, 3_000);
  await click('[data-settings-section="prompts"]');
  if (await waitInPage(win, `document.querySelector(${JSON.stringify(`${savedRow} [data-saved-prompt-menu]`)})`, 3_000)) {
    await click(`${savedRow} [data-saved-prompt-menu]`);
    await waitInPage(win, "document.querySelector('[role=menu] [data-prompt-delete]')", 2_000);
    await click('[role=menu] [data-prompt-delete]');
  }
  await waitInPage(win, `document.querySelector('[data-settings-section="remote"]')`, 3_000);
  await click('[data-settings-section="remote"]');
  if (await waitInPage(win, "document.querySelector('[data-computer-forget]')", 3_000)) {
    await click('[data-computer-forget]');
    await waitInPage(win, "document.querySelector('[data-confirm-strip] [data-confirm]')", 2_000);
    await click('[data-confirm-strip] [data-confirm]');
  }
  const removed = await waitInPage(win, "!document.querySelector('[data-computer]') && !document.querySelector('[data-remote-row]')", 5_000);
  pressKey(win, 'Escape');
  if (!removed) return 'the other computer and its rows did not go after Remove';
  return `ok: paired, ${rows} remote rows with their chip, one opened with the line and "on Smoke Mac", terminal disabled, + on this computer with nothing typed and on Smoke Mac with a saved prompt picked with /, "${label}" started it there, removed again`;
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
  // doesn't have (Nord is dark only) shows Demo Time's.
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

/**
 * Settings › Theme › App icon: pick Signal yellow (checked, saved, applied in main), the keys, both modes, the saved
 * file as the next launch reads it, then Reset to Graphite.
 */
/**
 * Settings › Theme › App icon › Show when Claude is working: on by default on macOS, where it animates the Dock's icon
 * (held here, as nothing works in the demo) and stops when turned off; no switch elsewhere. Leaves it on.
 */
async function runDockActivityStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code) as Promise<unknown>;
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const switchIs = (on: boolean) => waitInPage(win, `document.querySelector('[data-dock-activity][role="switch"]')?.getAttribute('aria-checked') === '${on}'`, 2_000);

  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  await click('[data-settings-section="theme"]');
  if (!(await waitInPage(win, "document.querySelector('[data-app-icon-picker]')", 3_000))) return 'failed: Settings › Theme has no App icon';
  if (process.platform !== 'darwin') {
    const shown = await js("Boolean(document.querySelector('[data-dock-activity]'))");
    await click('[data-close-settings]');
    return shown ? 'failed: the switch shows without a Dock' : 'ok (no Dock here, no switch)';
  }
  if (!(await switchIs(true)) || !preferences.get().dockActivity) return 'failed: Show when Claude is working is not on by default';

  // Reduce motion shows one still frame instead of the animation.
  const still = systemPreferences.getAnimationSettings().prefersReducedMotion;
  const before = dockActivity.shown;
  dockActivity.hold(true);
  try {
    if (!(await until(() => dockActivity.showing && dockActivity.shown >= before + (still ? 1 : 4), 3_000))) return `failed: the Dock showed ${dockActivity.shown - before} frames`;
    await click('[data-dock-activity]');
    if (!(await switchIs(false)) || !(await until(() => !preferences.get().dockActivity && !dockActivity.showing, 2_000))) return 'failed: turning it off did not stop the animation';
    await click('[data-dock-activity]');
    if (!(await switchIs(true)) || !(await until(() => preferences.get().dockActivity && dockActivity.showing, 2_000))) return 'failed: turning it on again did not start it';
  } finally {
    dockActivity.hold(false);
  }
  if (dockActivity.showing) return 'failed: still animating with nothing working';
  await click('[data-close-settings]');
  return `ok (${still ? 'a still frame, Reduce motion is on' : 'animated'}, off and on again, the icon put back)`;
}

async function runAppIconStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code) as Promise<unknown>;
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const checked = (key: string) => waitInPage(win, `document.querySelector('[data-app-icon="${key}"][aria-checked="true"][data-app-icon-selected]') && document.querySelectorAll('[data-app-icon-picker] [aria-checked="true"]').length === 1`, 2_000);
  const key = (name: string) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true }))`);
  const saved = () => sanitizePreferences(JSON.parse(readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8'))).appIcon ?? 'graphite';

  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  await click('[data-settings-section="theme"]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-app-icon-picker] [data-app-icon]').length === 9", 3_000))) return 'failed: the picker has no nine tiles';
  if (!(await js("document.querySelector('[data-app-icon-picker]').closest('[role=radiogroup]')?.getAttribute('aria-label') === 'App icon'"))) return 'failed: the tiles are not a radio group named App icon';
  if (!(await checked('graphite')) || (await js("Boolean(document.querySelector('[data-app-icon-reset]'))"))) return 'failed: Graphite is not the one checked, or Reset shows for it';
  const broken = (await js("[...document.querySelectorAll('[data-app-icon] img')].filter((img) => !img.complete || img.naturalWidth === 0).length")) as number;
  if (broken) return `failed: ${broken} tiles have no image`;

  await click('[data-app-icon="signal"]');
  if (!(await checked('signal'))) return 'failed: Signal yellow is not checked after a click';
  if (!(await until(() => preferences.get().appIcon === 'signal' && appIcon.key === 'signal' && saved() === 'signal', 2_000))) return `failed: not saved and applied (preferences ${preferences.get().appIcon}, main ${appIcon.key}, file ${saved()})`;
  if (process.platform !== 'darwin' && !appIcon.windowIcon()?.includes('signal')) return `failed: new windows would get ${appIcon.windowIcon()}`;
  if (!(await waitInPage(win, "document.querySelector('[data-app-icon-reset]')", 2_000))) return 'failed: no Reset to Graphite';

  // Arrow keys move and pick, as in any radio group.
  await js("document.querySelector('[data-app-icon=\"signal\"]').focus()");
  await key('ArrowRight');
  if (!(await checked('forest')) || !(await until(() => preferences.get().appIcon === 'forest', 2_000))) return 'failed: → did not pick Forest';
  await key('ArrowLeft');
  if (!(await checked('signal'))) return 'failed: ← did not go back to Signal yellow';

  for (const mode of ['light', 'dark'] as const) {
    await click(`[data-color-scheme="${mode}"]`);
    if (!(await waitInPage(win, `matchMedia('(prefers-color-scheme: ${mode})').matches`, 2_000))) return `failed: ${mode} did not apply`;
    const frame = (await js("getComputedStyle(document.querySelector('[data-app-icon=\"signal\"]')).borderTopColor")) as string;
    if (!frame || frame === 'rgba(0, 0, 0, 0)') return `failed: the chosen tile has no frame in ${mode} mode`;
    await shot(win, `app-icon-${mode}.png`);
  }
  await click('[data-color-scheme="system"]');

  // A restart: launch reads the saved file before the first window.
  const atLaunch = saved();
  await click('[data-app-icon-reset]');
  if (!(await checked('graphite')) || !(await until(() => preferences.get().appIcon === 'graphite' && appIcon.key === 'graphite' && saved() === 'graphite', 2_000))) return 'failed: Reset to Graphite did not apply';
  if (!(await waitInPage(win, "!document.querySelector('[data-app-icon-reset]')", 2_000))) return 'failed: Reset still shows for Graphite';
  await click('[data-close-settings]');
  return atLaunch === 'signal' ? 'ok (Signal yellow saved for the next launch, keys, light and dark, reset)' : `failed: the next launch would read ${atLaunch}`;
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
 * and on macOS gh is the smoke test's fake (SESHBOARD_GH), so nothing reaches GitHub either way.
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
    if (!/^(Pushes \d+ commits? to |Publishes |Makes sure )/.test(pushLine)) return `no push line in the footer ("${pushLine}")`;
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
 * Read-only: file paths in Claude's replies that exist became links, and the chips beside file tools do the same. What a
 * click does is the setting Clicking a file link (Open in Seshboard by default: Markdown, HTML and code files preview there,
 * the rest show in the file manager): the label and tooltip say it and what Shift-click does instead, and the right-click and
 * Shift+F10 menus list every way and Copy path above the message's Quote and Remember this…. Switching the setting in
 * Settings › Conversation flips them. Nothing is ever clicked: that would open Explorer, Finder, the preview or the user's
 * editor. The menus are only opened and closed with Escape, and the setting is put back at the end.
 */
async function runFileLinksStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const fileManager = process.platform === 'win32' ? 'File Explorer' : process.platform === 'darwin' ? 'Finder' : 'Files';
  const original = preferences.get().fileLinkClick;
  if (original !== 'switchboard') return `the setting started as ${original}, not Open in Seshboard`;
  const session = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  const LINK = "[data-transcript] [data-file-link]";
  const shiftClick = /(Shift\+click|⇧-click) (opens|shows) it in /;
  const previewable = (path: string) => previewKind(path) !== null;
  type Mode = 'switchboard' | 'file-manager' | 'editor';

  /** The links and chips on screen, as they read, once a path has been looked up. */
  const read = async () => {
    // Paths are looked up a moment after they render.
    await waitInPage(win, `document.querySelector('${LINK}')`, 2_000);
    const links = (await js(
      `[...document.querySelectorAll('${LINK}')].map((a) => ({ target: a.dataset.fileLink, href: a.getAttribute('href'), tooltip: a.dataset.tooltip, described: a.getAttribute('aria-description'), action: a.dataset.fileLinkAction }))`,
    )) as Array<{ target: string; href: string; tooltip: string; described: string | null; action: string }>;
    const chips = (await js(
      "[...document.querySelectorAll('[data-transcript] [data-file-chip]')].map((b) => ({ path: b.dataset.fileChip, tooltip: b.dataset.tooltip, label: b.getAttribute('aria-label'), text: b.textContent, action: b.dataset.fileLinkAction }))",
    )) as Array<{ path: string; tooltip: string; label: string | null; text: string; action: string }>;
    return { links, chips };
  };

  /** What a click does on the file at `path` in `mode`. */
  const actionFor = (mode: Mode, path: string) => (mode === 'switchboard' ? (previewable(path) ? 'preview' : 'show') : mode === 'file-manager' ? 'show' : 'editor');

  /** What each link and chip must say when the setting is `mode`. Null when all is right. */
  const check = (shown: Awaited<ReturnType<typeof read>>, mode: Mode): string | null => {
    for (const link of shown.links) {
      const path = link.target.replace(/:\d+$/, '');
      const expectedAction = actionFor(mode, path);
      // The preview and the editor go to the line; the file manager can't.
      const start = expectedAction === 'preview' ? `Preview ${link.target} in Seshboard. ` : expectedAction === 'show' ? `Show ${path} in ${fileManager}. ` : `Open ${link.target} in `;
      if (!link.href.startsWith('file:///') || !isAbsolutePath(path)) return `a file link is wrong: ${JSON.stringify(link)}`;
      if (!link.tooltip.startsWith(start) || !shiftClick.test(link.tooltip) || link.action !== expectedAction) return `with ${mode} set, a link to ${path} says "${link.tooltip}" (${link.action})`;
      if (expectedAction === 'editor' && !link.tooltip.includes(`shows it in ${fileManager}`)) return `with ${mode} set, a link says "${link.tooltip}"`;
      if (link.described !== link.tooltip) return `a link's description for screen readers is not its tooltip: ${JSON.stringify(link)}`;
    }
    for (const chip of shown.chips) {
      const expectedAction = actionFor(mode, chip.path);
      // A chip for a Read from a line names the line after the path.
      const start = expectedAction === 'preview' ? `Preview ${chip.path}` : expectedAction === 'show' ? `Show ${chip.path} in ${fileManager}. ` : 'Open ';
      const text = expectedAction === 'preview' ? 'Preview ↗' : expectedAction === 'show' ? 'Show ↗' : 'Open ↗';
      if (!chip.tooltip.startsWith(start) || !shiftClick.test(chip.tooltip) || chip.label !== chip.tooltip || chip.text !== text || chip.action !== expectedAction) {
        return `with ${mode} set, a file chip for ${chip.path} says "${chip.text}" / "${chip.tooltip}" (${chip.action})`;
      }
    }
    return null;
  };

  /** Opens the first link's context menu (a right-click, or Shift+F10 on the focused link) and returns its items; closes it with Escape. */
  const menuOf = async (how: 'right-click' | 'keyboard') => {
    if (how === 'right-click') {
      await js(`(() => { const a = document.querySelector('${LINK}'); const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 2, clientY: r.top + 2 })); })()`);
    } else {
      await js(`document.querySelector('${LINK}').focus()`);
      pressKey(win, 'F10', ['shift']);
    }
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-file-link-menu-item]')", 2_000))) return `the ${how} menu did not open`;
    const target = (await js(`document.querySelector('${LINK}').dataset.fileLink`)) as string;
    const items = (await js("[...document.querySelectorAll('[role=menu] [data-file-link-menu-item]')].map((b) => ({ id: b.dataset.fileLinkMenuItem, label: b.textContent.trim() }))")) as Array<{ id: string; label: string }>;
    const inside = (await js("!!document.activeElement?.closest('[role=menu]')")) as boolean;
    const message = (await js("!!document.querySelector('[role=menu] [data-quote-menu]') && !!document.querySelector('[role=menu] [data-remember-menu]')")) as boolean;
    if (how === 'right-click') await shot(win, 'file-link-menu.png');
    // Only close it when it is open: Escape on its own would stop a working session.
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000))) return `Escape did not close the ${how} menu`;
    const ids = items.map((item) => item.id).join(',');
    const expected = previewable(target.replace(/:\d+$/, '')) ? 'preview,show,editor,copy' : 'show,editor,copy';
    if (ids !== expected) return `the ${how} menu on ${target} lists ${ids}, not ${expected}`;
    const labels = expected.startsWith('preview') ? ['Open in Seshboard', `Show in ${fileManager}`] : [`Show in ${fileManager}`];
    const rest = items.slice(labels.length);
    if (items.slice(0, labels.length).some((item, i) => item.label !== labels[i]) || !rest[0]!.label.startsWith('Open in ') || rest[1]!.label !== 'Copy path') return `the ${how} menu reads ${JSON.stringify(items.map((item) => item.label))}`;
    if (!inside) return `focus did not move into the ${how} menu`;
    if (!message) return `the ${how} menu on a link in a reply has no Quote or Remember this…`;
    return items;
  };

  const setInSettings = async (value: Mode) => {
    await js("document.querySelector('[data-open-settings]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"conversation\"]')", 3_000))) return 'Settings did not open';
    await js("document.querySelector('[data-settings-section=\"conversation\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-file-link-click]')", 2_000))) return 'Settings › Conversation has no Clicking a file link';
    const shownValue = (await js("document.querySelector('[data-file-link-click]').dataset.value")) as string;
    const text = (await js("document.querySelector('[data-file-link-click]').innerText")) as string;
    const expectedText = shownValue === 'switchboard' ? 'Open in Seshboard' : shownValue === 'file-manager' ? `Show in ${fileManager}` : 'Open in editor';
    if (!text.includes(expectedText)) return `the setting reads "${text}", not "${expectedText}"`;
    await shot(win, 'settings-file-link-click.png');
    if (!(await chooseOption(win, '[data-file-link-click]', value))) return `could not choose ${value}`;
    await js("document.querySelector('[data-close-settings]').click()");
    if (!(await until(() => preferences.get().fileLinkClick === value))) return `${value} was not saved`;
    if (session) {
      openSession(session);
      if (!(await waitInPage(win, `document.querySelector('[data-current-session="${session}"]') && document.querySelector('[data-transcript-item]')`, 5_000))) return 'could not go back to the session after Settings';
    }
    return null;
  };

  try {
    const first = await read();
    const wrong = check(first, 'switchboard');
    if (wrong) return wrong;
    let menus = 'no file link on screen to open a menu on';
    if (first.links.length > 0) {
      for (const how of ['right-click', 'keyboard'] as const) {
        const items = await menuOf(how);
        if (typeof items === 'string') return items;
      }
      menus = 'right-click and Shift+F10 list every way and Copy path, then Quote and Remember this…';
    }

    for (const mode of ['file-manager', 'editor'] as const) {
      const failed = await setInSettings(mode);
      if (failed) return failed;
      const wrongToo = check(await read(), mode);
      if (wrongToo) return wrongToo;
    }
    return `ok: ${first.links.length} links and ${first.chips.length} chips preview Markdown and HTML in Seshboard and show the rest in ${fileManager} (Shift-click for the editor), then show in ${fileManager} and open in the editor as set; ${menus}; e.g. "${first.links[0]?.tooltip ?? first.chips[0]?.tooltip ?? 'none on screen'}"`;
  } finally {
    // Put the setting back for the steps after this one (and close Settings if a failure left it open).
    if (await js("!!document.querySelector('[data-close-settings]')")) await js("document.querySelector('[data-close-settings]').click()");
    if (await js("!!document.querySelector('[role=menu]')")) pressKey(win, 'Escape');
    if (preferences.get().fileLinkClick !== original) updatePreferences({ fileLinkClick: original });
  }
}

/** A 1x1 PNG, for the pictures next to the throwaway files the preview step opens. */
const SMOKE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * File preview (#181), on throwaway files in a folder of their own: a Markdown file opens in the dialog with its heading,
 * a GitHub alert and a details block rendered, a script and the picture beside it handled (the script is dropped, the
 * picture loads through the engine), Source shows the raw text, and Reload picks up a change. An HTML file opens in a
 * sandboxed frame whose page has the CSP and the picture inlined. A code file has numbered lines. Opened from the session, a
 * file goes to its side panel with the linked lines marked, moves to the dialog and back. A file over 2 MB says so. Escape
 * closes the dialog and the session stays. The preview is opened through a window event the dialog listens for, as no conversation has to link to
 * these files. The folder is removed at the end.
 */
async function runFilePreviewStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-smoke-preview-')));
  const md = join(dir, 'notes.md');
  const html = join(dir, 'page.html');
  const big = join(dir, 'big.md');
  const code = join(dir, 'main.ts');
  const open = (path: string) => js(`window.dispatchEvent(new CustomEvent('seshboard:preview-file', { detail: ${JSON.stringify(path)} }))`);
  const DIALOG = "document.querySelector('[data-file-preview][role=dialog]')";
  const session = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
  const title = (await js('document.title')) as string;
  try {
    writeFileSync(join(dir, 'logo.png'), SMOKE_PNG);
    writeFileSync(md, '# Smoke heading\n\n> [!NOTE]\n> Smoke alert text.\n\n<details><summary>More</summary>\n\nHidden body\n\n</details>\n\n<script>document.title = "pwned"</script>\n\n![the logo](logo.png)\n\n[next](other.md)\n');
    writeFileSync(html, '<!doctype html><html><head><title>Page</title></head><body><h1>Smoke page</h1><img src="logo.png"><script>document.title = "pwned"</script></body></html>');
    writeFileSync(code, `const smoke = '${'long '.repeat(80)}';\n${Array.from({ length: 79 }, (_, i) => `const line${i + 2} = ${i + 2};`).join('\n')}\n`);
    writeFileSync(big, `# Big\n\n${'x'.repeat(3 * 1024 * 1024)}\n`);

    await open(md);
    if (!(await waitInPage(win, `${DIALOG}?.dataset.filePreviewKind === 'markdown' && document.querySelector('[data-file-preview-markdown] h1')`, 5_000))) return 'the Markdown file did not open in the preview';
    const rendered = (await js(
      `({ heading: document.querySelector('[data-file-preview-markdown] h1').innerText, alert: document.querySelector('[data-file-preview-markdown] [data-alert="note"]')?.innerText ?? null, details: !!document.querySelector('[data-file-preview-markdown] details summary'), scripts: document.querySelectorAll('[data-file-preview-markdown] script').length, title: document.title, name: ${DIALOG}.getAttribute('aria-labelledby') && document.getElementById(${DIALOG}.getAttribute('aria-labelledby')).innerText, link: document.querySelector('[data-file-preview-markdown] [data-file-link]')?.dataset.fileLinkAction ?? null })`,
    )) as { heading: string; alert: string | null; details: boolean; scripts: number; title: string; name: string; link: string | null };
    if (rendered.heading !== 'Smoke heading') return `the heading reads "${rendered.heading}"`;
    if (!rendered.alert?.includes('Note') || !rendered.alert.includes('Smoke alert text.') || rendered.alert.includes('[!NOTE]')) return `the alert reads ${JSON.stringify(rendered.alert)}`;
    if (!rendered.details) return 'the details block did not render';
    if (rendered.scripts !== 0 || rendered.title !== title) return `a script in the Markdown survived (${rendered.scripts} script elements, title "${rendered.title}")`;
    if (rendered.name !== 'notes.md') return `the dialog is named "${rendered.name}"`;
    if (rendered.link !== 'preview') return `a relative Markdown link does ${rendered.link}, not preview`;
    if (!(await waitInPage(win, "document.querySelector('[data-file-preview-markdown] img[data-file-preview-image=\"loaded\"]')?.src.startsWith('data:image/png')", 5_000))) return 'the picture next to the Markdown file did not load';
    await shot(win, 'file-preview-markdown.png');

    await js("document.querySelector('[data-file-preview-view=\"source\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-file-preview-source]')?.innerText.includes('# Smoke heading') && document.querySelector('[data-file-preview-source]').innerText.includes('<script>')", 5_000))) return 'Source did not show the raw text';
    await js("document.querySelector('[data-file-preview-view=\"preview\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-file-preview-markdown] h1')", 3_000))) return 'Preview did not come back from Source';

    writeFileSync(md, '# Second heading\n');
    await js("document.querySelector('[data-file-preview-reload]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-file-preview-markdown] h1')?.innerText === 'Second heading'", 5_000))) return 'Reload did not show the changed file';

    // Opening another file replaces this one.
    await open(html);
    // HTML opens on its source, which always shows; the page itself is one click away.
    if (!(await waitInPage(win, `${DIALOG}?.dataset.filePreviewKind === 'html' && document.querySelector('[data-file-preview-source]')?.innerText.includes('<title>') && !document.querySelector('iframe[data-file-preview-frame]')`, 5_000))) return 'the HTML file did not open on its source';
    await js("document.querySelector('[data-file-preview-view=\"preview\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('iframe[data-file-preview-frame]')", 3_000))) return 'the HTML page did not render from Preview';
    const frame = (await js(
      "(() => { const f = document.querySelector('iframe[data-file-preview-frame]'); return { sandbox: f.getAttribute('sandbox'), srcdoc: f.getAttribute('srcdoc') }; })()",
    )) as { sandbox: string | null; srcdoc: string };
    if (frame.sandbox !== '') return `the frame's sandbox is ${JSON.stringify(frame.sandbox)}, not empty`;
    if (!frame.srcdoc.includes('http-equiv="Content-Security-Policy"') || frame.srcdoc.indexOf('Content-Security-Policy') > frame.srcdoc.indexOf('<title>')) return 'the page has no Content-Security-Policy before its content';
    if (!frame.srcdoc.includes('src="data:image/png;base64,')) return 'the picture next to the HTML file was not inlined';
    // The page is in a frame of its own, which nothing in this page can tell has painted: give it a moment before the picture.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await shot(win, 'file-preview-html.png');

    // A code file is its source only, with a number on each line and its long lines wrapped until the toggle says otherwise.
    await open(code);
    if (!(await waitInPage(win, `${DIALOG}?.dataset.filePreviewKind === 'code' && document.querySelector('[data-file-preview-source]')?.innerText.includes('const smoke') && !document.querySelector('[data-file-preview-view]')`, 5_000))) return 'the code file did not open as its source';
    const numbers = (await js("[...document.querySelectorAll('[data-file-preview-source] [data-line]')].slice(0, 3).map((row) => row.firstElementChild.innerText).join(',')")) as string;
    if (numbers !== '1,2,3') return `the lines are numbered "${numbers}"`;
    const wrapped = `getComputedStyle(document.querySelector('[data-file-preview-source] [data-line="1"]').lastElementChild).whiteSpace`;
    if (!(await waitInPage(win, `${wrapped}.startsWith('pre-wrap') && document.querySelector('[data-file-preview-wrap]').getAttribute('aria-pressed') === 'true'`, 3_000))) return 'long lines did not wrap by default, or the wrap button does not show it is on';
    await js("document.querySelector('[data-file-preview-wrap]').click()");
    if (!(await waitInPage(win, `!${wrapped}.startsWith('pre-wrap') && document.querySelector('[data-file-preview-wrap]').getAttribute('aria-pressed') === 'false'`, 3_000))) return 'the wrap toggle did not turn wrapping off';
    await js("document.querySelector('[data-file-preview-wrap]').click()");

    // From a session, a file opens in its side panel, at the lines the link named (20 to 24), marked and scrolled to.
    let panel = 'no session open, so the side panel was not tried';
    if (session) {
      pressKey(win, 'Escape');
      if (!(await waitInPage(win, `!${DIALOG}`, 3_000))) return 'Escape did not close the preview';
      const PANEL = `document.querySelector('[data-current-session="${session}"] [data-file-preview-place="panel"]')`;
      await js(`window.dispatchEvent(new CustomEvent('seshboard:preview-file', { detail: { path: ${JSON.stringify(code)}, sessionId: ${JSON.stringify(session)}, line: 20, endLine: 24 } }))`);
      // Detached in an earlier run of this window, it would open in the dialog: dock it first.
      if (await waitInPage(win, `${DIALOG}?.querySelector('[data-file-preview-dock]')`, 1_000)) await js(`${DIALOG}.querySelector('[data-file-preview-dock]').click()`);
      if (!(await waitInPage(win, `${PANEL}?.querySelectorAll('[data-line-marked]').length === 5`, 5_000))) return 'the file did not open in the side panel with lines 20 to 24 marked';
      const shown = (await js(
        `(() => { const box = ${PANEL}.querySelector('[data-file-preview-source]').getBoundingClientRect(); const row = ${PANEL}.querySelector('[data-line="20"]').getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom; })()`,
      )) as boolean;
      if (!shown) return 'line 20 is not scrolled into view in the side panel';
      await shot(win, 'file-preview-panel.png');
      await js(`${PANEL}.querySelector('[data-file-preview-detach]').click()`);
      if (!(await waitInPage(win, `${DIALOG}?.querySelectorAll('[data-line-marked]').length === 5 && !${PANEL}`, 3_000))) return 'Open in a dialog did not move the preview to the dialog';
      await js(`${DIALOG}.querySelector('[data-file-preview-dock]').click()`);
      if (!(await waitInPage(win, `!${DIALOG} && ${PANEL}?.querySelectorAll('[data-line-marked]').length === 5`, 3_000))) return 'Dock to the side did not move the preview back to the panel';
      await js(`${PANEL}.querySelector('[data-file-preview-close]').click()`);
      if (!(await waitInPage(win, `!${PANEL}`, 3_000))) return 'the side panel did not close';
      panel = 'from a session it opens in the side panel at the lines a link names, marked and in view, moves to a dialog and back';
    }

    await open(big);
    if (!(await waitInPage(win, "document.querySelector('[data-file-preview-too-large]')?.innerText.includes('Seshboard previews files up to 2 MB')", 5_000))) return 'a file over 2 MB did not say so';

    pressKey(win, 'Escape');
    if (!(await waitInPage(win, `!${DIALOG}`, 3_000))) return 'Escape did not close the preview';
    if (session && !(await waitInPage(win, `document.querySelector('[data-current-session="${session}"]')`, 2_000))) return 'the session went away when the preview closed';
    return `ok: Markdown renders its heading, alert, details and picture without its script, Source shows the text, Reload picks up a change, HTML opens on its source and renders in an empty sandbox with the CSP and its picture inlined, a code file shows its numbered source with wrapping you can toggle, ${panel}, a 3 MB file says it is over the limit, and Escape closes it`;
  } finally {
    if (await js(`!!${DIALOG}`)) pressKey(win, 'Escape');
    await js("document.querySelector('[data-file-preview-close]')?.click()");
    rmSync(dir, { recursive: true, force: true });
  }
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
 * The prompt outline, read-only: a session with at least 4 prompts has a mark for each beside the conversation, a
 * click on a mark brings its prompt to the top of the view, and Next prompt (⌘⇧↓) moves the current mark on. Uses
 * the open session when it has 4 prompts, else the first of the newest sessions that aren't running that has, and
 * goes back to the open session afterwards.
 */
async function runPromptOutlineStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const view = '[data-current-session]';
  const markCount = `document.querySelectorAll('${view} [data-prompt-outline] [data-prompt-mark]').length`;
  const back = smokeSessionId;
  let borrowed: string | null = null;
  try {
    if (!(await waitInPage(win, `${markCount} >= 4`, 1_500))) {
      const running = await runningSessions();
      if (!running) return 'failed: could not ask the engine which sessions are running, so none is safe to open';
      const rows = (await js("[...document.querySelectorAll('[data-session-id]')].map((row) => row.dataset.sessionId)")) as string[];
      for (const id of [...new Set(rows)].filter((id) => id !== back && !running.ids.has(id)).slice(0, 10)) {
        await js(`document.querySelector('[data-session-id="${id}"]')?.click()`);
        if (!(await waitInPage(win, `document.querySelector('${view}')?.dataset.currentSession === ${JSON.stringify(id)} && document.querySelector('${view} [data-transcript-item]')`, 5_000))) continue;
        if (await waitInPage(win, `${markCount} >= 4`, 1_000)) {
          borrowed = id;
          break;
        }
      }
      if (!borrowed) return 'ok: no session with 4 prompts among the newest (the demo home has one: npm run smoke:demo)';
    }
    const count = (await js(markCount)) as number;
    const label = (await js(`document.querySelector('${view} [data-prompt-outline]').getAttribute('aria-label')`)) as string;
    if (label !== 'Your prompts') return `the rail is labelled ${JSON.stringify(label)}`;

    // A click on the second mark: its prompt lands 24px below the top of the view (or as far as the end lets it).
    const row = (await js(`document.querySelector('${view} [data-prompt-mark="1"]').dataset.promptRow`)) as string;
    await js(`document.querySelector('${view} [data-prompt-mark="1"]').click()`);
    const offset = `(() => { const el = document.querySelector('${view} [data-transcript]'); const row = el.querySelector('[data-transcript-item][data-index="${row}"]'); return row ? Math.round(row.getBoundingClientRect().top - el.getBoundingClientRect().top) : null; })()`;
    const atEnd = `(() => { const el = document.querySelector('${view} [data-transcript]'); return el.scrollHeight - el.scrollTop - el.clientHeight < 2; })()`;
    if (!(await waitInPage(win, `(() => { const top = ${offset}; return top !== null && (Math.abs(top - 24) <= 3 || (${atEnd} && top >= 0)); })()`, 3_000))) {
      return `the second prompt is not at the top after a click on its mark (${await js(offset)}px from the top)`;
    }
    if (!(await waitInPage(win, `!!document.querySelector('${view} [data-prompt-mark="1"][data-current][aria-current="true"]')`, 2_000))) return 'the clicked mark is not the current one';

    // Next prompt (⌘⇧↓), with focus outside any text field: the third mark is the current one.
    await js('document.activeElement?.blur?.()');
    pressKey(win, 'Down', ['meta', 'shift']);
    if (!(await waitInPage(win, `!!document.querySelector('${view} [data-prompt-mark="2"][data-current]')`, 3_000))) {
      return `Next prompt did not move the current mark to the third prompt (current: ${await js(`document.querySelector('${view} [data-prompt-mark][data-current]')?.dataset.promptMark ?? 'none'`)})`;
    }
    return `ok: ${count} marks${borrowed ? ' (in another session with more prompts)' : ''}, a click brought the second prompt to the top, Next prompt moved the current mark to the third`;
  } finally {
    if (borrowed && back) {
      await js(`document.querySelector('[data-session-id="${back}"]')?.click()`);
      await waitInPage(win, `document.querySelector('[data-current-session="${back}"] [data-transcript-item]')`, 5_000);
    } else await js(`document.querySelector('${view} [data-jump-to-latest]')?.click()`);
  }
}

/**
 * Every message has a Copy button (Markdown for Claude's replies, which also have Copy as rich text), and the text
 * of prompts, commands and replies can be selected. Read-only: it doesn't click Copy, which would replace the clipboard.
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
  const withoutRich = (await js(`[...document.querySelectorAll('[data-item-kind="text"]')].filter((row) => row.querySelector('.markdown') && !row.querySelector('[data-message-actions] button[aria-label="Copy as rich text"]')).length`)) as number;
  if (withoutRich > 0) return `${withoutRich} of Claude's replies have no Copy as rich text`;
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
    // Selecting with the mouse takes the focus off whatever had it (the session's row in the sidebar).
    document.activeElement?.blur();
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
  // With the mouse, held as a person holds it, not .click(): a press outside the selectable text used to clear the
  // selection, and the toolbar went with it before the click landed.
  const quote = (await js(`(() => { const r = ${toolbar}.querySelector('[data-quote-selection]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
  win.webContents.sendInputEvent({ type: 'mouseMove', x: quote.x, y: quote.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: quote.x, y: quote.y, button: 'left', clickCount: 1 });
  await settle(win);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: quote.x, y: quote.y, button: 'left', clickCount: 1 });
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
 * Under each reply: a finished turn's line ("14:32 · 2m 14s · 18.4k tokens") after the reply's actions, hidden with
 * them until the reply is hovered or the row has focus and then shown in the same space, its tokens' tooltip on hover,
 * the prompt's "Sent …" tooltip, and Nothing in Settings › Conversation hiding the line. Shows all three parts for the
 * step and puts the setting back. Read-only: it only scrolls, hovers and focuses.
 */
async function runTurnMetaStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const view = '[data-current-session]';
  const lines = `[...document.querySelectorAll('${view} [data-turn-meta]')]`;
  const before = preferences.get().turnDetails;
  const back = smokeSessionId;
  let borrowed: string | null = null;
  updatePreferences({ turnDetails: 'tokens' });
  // Scrolls up from the end until the lines of two finished turns have been on screen (the list is virtualised).
  const twoTurns = async (): Promise<boolean> => {
    await js(`(() => { const el = document.querySelector('${view} [data-transcript]'); if (el) el.scrollTop = el.scrollHeight; })()`);
    const seen = new Set<string>();
    for (let page = 0; page < 20 && seen.size < 2; page++) {
      await waitInPage(win, `${lines}.length > 0`, page === 0 ? 1_500 : 300);
      for (const key of (await js(`${lines}.map((line) => line.closest('[data-message-key]')?.dataset.messageKey ?? '')`)) as string[]) if (key) seen.add(key);
      const top = (await js(`(() => { const el = document.querySelector('${view} [data-transcript]'); if (!el || el.scrollTop === 0) return true; el.scrollTop -= el.clientHeight * 0.8; return false; })()`)) as boolean;
      if (top) break;
    }
    return seen.size >= 2;
  };
  try {
    if (!(await twoTurns())) {
      const running = await runningSessions();
      if (!running) return 'failed: could not ask the engine which sessions are running, so none is safe to open';
      const rows = (await js("[...document.querySelectorAll('[data-session-id]')].map((row) => row.dataset.sessionId)")) as string[];
      for (const id of [...new Set(rows)].filter((id) => id !== back && !running.ids.has(id)).slice(0, 10)) {
        await js(`document.querySelector('[data-session-id="${id}"]')?.click()`);
        if (!(await waitInPage(win, `document.querySelector('${view}')?.dataset.currentSession === ${JSON.stringify(id)} && document.querySelector('${view} [data-transcript-item]')`, 5_000))) continue;
        if (await twoTurns()) {
          borrowed = id;
          break;
        }
      }
      if (!borrowed) return 'ok: no session with two finished turns among the newest (the demo home has them: npm run smoke:demo)';
    }

    // The line: the time, then parts joined by a · in the border colour, on one row with the actions.
    // The one with tokens if any (sessions without usage have none), in the middle of the view.
    await js(`(() => { const line = ${lines}.find((l) => l.querySelector('[data-turn-tokens]')) ?? ${lines}.at(-1); line.dataset.smokeTurnLine = '1'; line.scrollIntoView({ block: 'center' }); })()`);
    // A scroll from a script doesn't leave the end, so the view would still follow it as rows are measured and take the
    // line off screen before the pointer gets there. A wheel up, as you would, stops following.
    await js(`document.querySelector('${view} [data-transcript]')?.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))`);
    // Scrolls the conversation until the reply's row is in it and in the window, and stays put between two looks: rows
    // around it are still being measured and move it. Run again right before the pointer goes there.
    const inView = `(() => {
      const el = document.querySelector('${view} [data-transcript]');
      const row = document.querySelector('[data-smoke-turn-line]')?.parentElement;
      if (!el || !row) return false;
      const box = el.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const top = Math.max(box.top, 0);
      const bottom = Math.min(box.bottom, innerHeight);
      if (r.top >= top + 8 && r.bottom <= bottom - 8) {
        const still = window.__smokeRowTop === Math.round(r.top);
        window.__smokeRowTop = Math.round(r.top);
        return still;
      }
      window.__smokeRowTop = null;
      el.scrollTop += r.top + r.height / 2 - (top + bottom) / 2;
      return false;
    })()`;
    const intoView = async (): Promise<string | null> => {
      await settle(win);
      if (await waitInPage(win, inView, 3_000)) return null;
      const where = await js(`(() => { const el = document.querySelector('${view} [data-transcript]'); const r = document.querySelector('[data-smoke-turn-line]').parentElement.getBoundingClientRect(); const box = el.getBoundingClientRect(); return 'row ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ', conversation ' + Math.round(box.top) + '-' + Math.round(box.bottom) + ' scrolled ' + Math.round(el.scrollTop) + ' of ' + (el.scrollHeight - el.clientHeight) + ', window ' + innerHeight; })()`);
      return `could not keep the reply's row in view (${where})`;
    };
    const away = await intoView();
    if (away) return away;
    const line = (await js(`(() => {
      const line = document.querySelector('[data-smoke-turn-line]');
      const actions = line.parentElement.querySelector('[data-message-actions]');
      const seps = [...line.children].filter((c) => c.textContent === '·');
      return {
        time: line.querySelector('[data-turn-time]')?.textContent ?? '',
        seps: seps.length,
        sameRow: actions ? Math.abs(actions.getBoundingClientRect().top - line.getBoundingClientRect().top) < 6 : false,
        oneLine: line.getBoundingClientRect().height < 20,
        label: line.querySelector('.sr-only')?.textContent ?? '',
      };
    })()`)) as { time: string; seps: number; sameRow: boolean; oneLine: boolean; label: string };
    if (!line.time) return 'a turn line has no time';
    if (line.seps < 1) return `the line "${line.label}" has no · between its parts`;
    if (!line.sameRow) return "the line isn't on the row of the reply's actions";
    if (!line.oneLine) return 'the line wraps';
    if (!line.label.startsWith('Ended at ')) return `the line's label reads "${line.label}"`;

    // Hidden with the actions until the reply is hovered or the row has focus, then shown with them, in the same space.
    // What the pointer is on, for a failure: tells a covered point from a pointer that never reached the page.
    const pointerAt = (x: number, y: number) =>
      js(
        `(() => { const name = (el) => el ? el.tagName.toLowerCase() + Object.keys(el.dataset ?? {}).map((k) => '[data-' + k + ']').join('') : 'nothing'; const at = document.elementFromPoint(${x}, ${y}); const reply = document.querySelector('[data-smoke-turn-line]').closest('[data-message-key]'); return '${x},${y} in ' + innerWidth + 'x' + innerHeight + ' at ' + name(at) + (at && reply.contains(at) ? ' in the reply' : ' outside the reply') + ', hovered ' + name([...document.querySelectorAll(':hover')].at(-1)) + ', window focused ' + document.hasFocus(); })()`,
      ) as Promise<string>;
    const shown = `(() => { const line = document.querySelector('[data-smoke-turn-line]'); const actions = line.parentElement.querySelector('[data-message-actions]'); return [getComputedStyle(line).opacity, actions ? getComputedStyle(actions).opacity : '']; })()`;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 });
    await js(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    if (!(await waitInPage(win, `${shown}[0] === '0'`, 2_000))) return `the line shows (opacity ${(await js(shown))[0]}) without hover or focus`;
    await js(`document.querySelector('[data-smoke-turn-line]').parentElement.querySelector('[data-message-actions] button[aria-label^="Copy"]')?.focus()`);
    if (!(await waitInPage(win, `${shown}.join() === '1,1'`, 2_000))) return `tabbing to Copy did not show the line with the actions (${(await js(shown)).join(', ')})`;
    await js(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    if (!(await waitInPage(win, `${shown}[0] === '0'`, 2_000))) return 'the line stayed after Copy lost focus';
    // The pointer goes to the empty end of the reply's row, past the line: on the reply, on neither the actions nor the line.
    const moved = await intoView();
    if (moved) return moved;
    const hidden = (await js(`(() => { const line = document.querySelector('[data-smoke-turn-line]'); const r = line.parentElement.getBoundingClientRect(); return { height: line.closest('[data-message-key]').getBoundingClientRect().height, x: Math.round(r.right - 12), y: Math.round(r.top + r.height / 2) }; })()`)) as { height: number; x: number; y: number };
    win.webContents.sendInputEvent({ type: 'mouseMove', x: hidden.x, y: hidden.y });
    if (!(await waitInPage(win, `${shown}.join() === '1,1'`, 2_000))) {
      return `hovering the reply did not show the line with the actions (${(await js(shown)).join(', ')}; ${await pointerAt(hidden.x, hidden.y)})`;
    }
    const height = (await js(`document.querySelector('[data-smoke-turn-line]').closest('[data-message-key]').getBoundingClientRect().height`)) as number;
    if (Math.abs(height - hidden.height) > 0.5) return `showing the line changed the reply's height from ${hidden.height}px to ${height}px`;

    // The tokens' tooltip, on hover: the turn's total, a bar, a row per part.
    const tokens = (await js(`(() => {
      const el = document.querySelector('[data-smoke-turn-line] [data-turn-tokens]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`)) as { x: number; y: number } | null;
    let hovered = 'no tokens on screen (sessions without usage)';
    if (tokens) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: tokens.x, y: tokens.y });
      if (!(await waitInPage(win, "document.querySelector('[data-turn-tokens-tooltip]')", 3_000))) return `hovering the tokens showed no tooltip (${await pointerAt(tokens.x, tokens.y)})`;
      const tip = (await js(`(() => { const t = document.querySelector('[data-turn-tokens-tooltip]'); return { heading: t.querySelector('p')?.textContent ?? '', rows: t.querySelectorAll('dd').length }; })()`)) as { heading: string; rows: number };
      if (!/tokens · this turn · \d+ repl(y|ies)$/.test(tip.heading)) return `the tooltip is headed "${tip.heading}"`;
      if (tip.rows !== 4) return `the tooltip has ${tip.rows} rows, not one per part`;
      await shot(win, 'turn-tokens.png');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 });
      if (!(await waitInPage(win, "!document.querySelector('[data-turn-tokens-tooltip]')", 2_000))) return 'the tooltip stayed after the pointer left';
      hovered = `tooltip "${tip.heading}"`;
    }
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 });
    if (!(await waitInPage(win, `${shown}[0] === '0'`, 2_000))) return 'the line stayed after the pointer left the reply';
    const sent = (await js(`document.querySelector('${view} [data-prompt-bubble][data-tooltip]')?.dataset.tooltip ?? ''`)) as string;
    if (sent && !sent.startsWith('Sent ')) return `a prompt's tooltip reads "${sent}"`;

    // Nothing: no line.
    updatePreferences({ turnDetails: 'none' });
    if (!(await waitInPage(win, `${lines}.length === 0`, 2_000))) return 'Nothing in Under each reply left the lines';
    return `ok: "${line.label}", hidden until hover or focus with the actions, no jump, ${hovered}, gone with Nothing`;
  } finally {
    updatePreferences({ turnDetails: before });
    await js(`(document.querySelector('[data-smoke-turn-line]')?.removeAttribute('data-smoke-turn-line'), delete window.__smokeRowTop)`);
    // Back to the end, which follows the conversation again, and let it settle before the next step selects text.
    await js(`(() => { const el = document.querySelector('${view} [data-transcript]'); if (el) el.scrollTop = el.scrollHeight; })()`);
    await settle(win);
    if (borrowed && back) await js(`document.querySelector('[data-session-id="${back}"]')?.click()`);
  }
}

/**
 * Reading mode, from the Read button to leaving it. A session with two replies that have a Read button (the demo home
 * has one: npm run smoke:demo) opens a reply full window, checks the outline, the position and the buttons, then
 * closes with Esc and with the back button: at the same reply the conversation is exactly where it was and the reply's
 * Read button has the focus; at another reply the conversation scrolls to that one and focus goes to its button.
 * Read-only: it only clicks, scrolls and presses Esc, never types or sends, and a session found among the others is
 * never one that is running in Claude Code.
 */
async function runReadModeStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const view = '[data-current-session]';
  const transcript = `document.querySelector('${view} [data-transcript]')`;
  const buttons = `[...document.querySelectorAll('${view} [data-read-button]')]`;
  const back = smokeSessionId;
  let borrowed: string | null = null;
  let keysTried = '';
  // Scrolls up from the end until two Read buttons (of two replies) have been on screen (the list is virtualised).
  const twoReads = async (): Promise<boolean> => {
    await js(`(() => { const el = ${transcript}; if (el) el.scrollTop = el.scrollHeight; })()`);
    const seen = new Set<string>();
    for (let page = 0; page < 25 && seen.size < 2; page++) {
      await waitInPage(win, `${buttons}.length > 0`, page === 0 ? 1_500 : 300);
      for (const key of (await js(`${buttons}.map((b) => b.dataset.turnKey ?? '')`)) as string[]) if (key) seen.add(key);
      if (seen.size >= 2) break;
      const top = (await js(`(() => { const el = ${transcript}; if (!el || el.scrollTop === 0) return true; el.scrollTop -= el.clientHeight * 0.8; return false; })()`)) as boolean;
      if (top) break;
    }
    return seen.size >= 2;
  };
  const state = `(() => ({
    open: Boolean(document.querySelector('[data-read-mode]')),
    position: document.querySelector('[data-read-position]')?.textContent?.trim() ?? '',
    focus: document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-read-button]') ? document.activeElement.dataset.turnKey : null,
    scroll: ${transcript}?.scrollTop ?? -1,
  }))()`;
  type ReadState = { open: boolean; position: string; focus: string | null; scroll: number };
  try {
    // The demo home has a session with two long replies and headings: that is the one to read.
    const demoRow = process.env.SESHBOARD_SMOKE_DEMO
      ? ((await js(`[...document.querySelectorAll('[data-session-id]')].find((row) => row.textContent.includes('Speed up the checkout page'))?.dataset.sessionId ?? null`)) as string | null)
      : null;
    if (demoRow) {
      await js(`document.querySelector('[data-session-id="${demoRow}"]')?.click()`);
      await waitInPage(win, `document.querySelector('${view}')?.dataset.currentSession === ${JSON.stringify(demoRow)} && document.querySelector('${view} [data-transcript-item]')`, 5_000);
      borrowed = demoRow;
      if (!(await twoReads())) return 'failed: the demo session with two long replies shows fewer than two Read buttons';
    } else if (!(await twoReads())) {
      const running = await runningSessions();
      if (!running) return 'failed: could not ask the engine which sessions are running, so none is safe to open';
      const rows = (await js("[...document.querySelectorAll('[data-session-id]')].map((row) => row.dataset.sessionId)")) as string[];
      for (const id of [...new Set(rows)].filter((id) => id !== back && !running.ids.has(id)).slice(0, 12)) {
        await js(`document.querySelector('[data-session-id="${id}"]')?.click()`);
        if (!(await waitInPage(win, `document.querySelector('${view}')?.dataset.currentSession === ${JSON.stringify(id)} && document.querySelector('${view} [data-transcript-item]')`, 5_000))) continue;
        if (await twoReads()) {
          borrowed = id;
          break;
        }
      }
      if (!borrowed) return 'ok: no session with two replies to read among the newest (the demo home has one: npm run smoke:demo)';
    }
    // A wheel up, as you would: the view stops following the end, so rows being measured don't move it between looks.
    await js(`${transcript}?.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))`);
    await settle(win);

    // Hidden until hover or focus, except for a long reply: the button of a reply of 450 words or more always shows.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 });
    await js('document.activeElement instanceof HTMLElement && document.activeElement.blur()');
    const visibility = (await js(`${buttons}.map((b) => ({ words: (b.closest('[data-message-key]')?.innerText ?? '').split(/\\s+/).filter(Boolean).length, opacity: getComputedStyle(b).opacity }))`)) as Array<{ words: number; opacity: string }>;
    const shown = visibility.find((v) => v.opacity !== '0');
    if (shown) return `the Read button of a reply of ${shown.words} words shows (opacity ${shown.opacity}) without hover or focus`;
    const longOnes = visibility.filter((v) => v.words >= 450).length;
    if (demoRow && longOnes === 0) return 'failed: the demo session has no reply of 450 words or more with a Read button';

    // Opens the first reply in view; the conversation's scroll is noted first.
    const open = async (): Promise<{ key: string; scroll: number } | string> => {
      const target = (await js(`(() => { const b = ${buttons}[0]; if (!b) return null; const el = ${transcript}; const r = { key: b.dataset.turnKey, scroll: el.scrollTop }; b.click(); return r; })()`)) as { key: string; scroll: number } | null;
      if (!target) return 'the Read button went out of view before it was clicked';
      if (!(await waitInPage(win, "document.querySelector('[data-read-mode]') && document.querySelector('[data-read-text]')", 4_000))) return 'clicking Read did not open reading mode';
      return target;
    };
    const first = await open();
    if (typeof first === 'string') return first;
    const label = (await js("document.querySelector('[data-read-mode]').getAttribute('aria-label')")) as string;
    if (!/^Reading: .+, reply \d+ of \d+$/.test(label)) return `reading mode is labelled "${label}"`;
    const opened = (await js(state)) as ReadState;
    if (!/^Reply \d+ of \d+$/.test(opened.position)) return `the position reads "${opened.position}"`;
    const outline = (await js(`(() => { const nav = document.querySelector('[data-read-outline]'); return nav ? nav.querySelectorAll('a, button').length : 0; })()`)) as number;
    const headings = (await js("document.querySelectorAll('[data-read-text] > .markdown > :is(h1, h2, h3)').length")) as number;
    if (demoRow && headings === 0) return 'failed: the demo session\'s reply has no headings to outline';
    if (headings > 0 && outline === 0) return `the reply has ${headings} headings and no outline`;
    if (headings > 0 && !(await waitInPage(win, "document.querySelector('[data-read-outline]')", 1_000))) return 'the outline is missing';
    await shot(win, 'reading-mode.png');

    // Aa: the settings popover changes the size at once; Esc closes the popover first.
    const sizeNow = () => js("getComputedStyle(document.querySelector('[data-read-column]')).fontSize") as Promise<string>;
    const sizeBefore = await sizeNow();
    await js("document.querySelector('[data-read-settings-button]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-read-settings]')", 2_000))) return 'the Aa button did not open the settings';
    const sizes = (await js("[...document.querySelectorAll('[data-read-settings] [data-read-size] button')].length")) as number;
    if (sizes !== 4) return `the settings show ${sizes} sizes, not 4`;
    await js(`document.querySelectorAll('[data-read-settings] [data-read-size] button')[${sizeBefore === '21.5px' ? 0 : 3}].click()`);
    if (!(await waitInPage(win, `getComputedStyle(document.querySelector('[data-read-column]')).fontSize !== ${JSON.stringify(sizeBefore)}`, 2_000))) return 'picking a size in the settings did not change the text';
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, "!document.querySelector('[data-read-settings]')", 2_000))) return 'Esc did not close the settings';
    if (!(await js("Boolean(document.querySelector('[data-read-mode]'))"))) return 'Esc with the settings open also closed reading mode';
    // The keys: = makes the text bigger, - smaller.
    pressKey(win, '-');
    pressKey(win, '-');
    pressKey(win, '-');
    if (!(await waitInPage(win, `getComputedStyle(document.querySelector('[data-read-column]')).fontSize === '15.5px'`, 2_000))) return `the - key did not make the text smallest (${await sizeNow()})`;
    pressKey(win, '=');
    if (!(await waitInPage(win, `getComputedStyle(document.querySelector('[data-read-column]')).fontSize === '17.5px'`, 2_000))) return `the = key did not make the text bigger (${await sizeNow()})`;
    // The session list over the page (the sidebar key), outside the inert parts; Esc hides it before reading mode.
    pressKey(win, 'B', ['meta']);
    if (!(await waitInPage(win, "document.querySelector('[data-read-sidebar] [data-session-list]')", 2_000))) return 'the sidebar key did not show the session list over reading mode';
    const reachable = (await js("(() => { const panel = document.querySelector('[data-read-sidebar]'); return !panel.closest('[inert]') && Boolean(document.querySelector('[data-read-scrim]')); })()")) as boolean;
    if (!reachable) return 'the session list over reading mode is inert or has no scrim';
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, "!document.querySelector('[data-read-sidebar]')", 2_000))) return 'Esc did not hide the session list';
    if (!(await js("Boolean(document.querySelector('[data-read-mode]'))"))) return 'Esc closed reading mode with the session list open';
    await js("document.querySelector('[data-read-scroll]').focus()");

    // Esc at the same reply: the conversation is where it was, and the reply's Read button has the focus.
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, "!document.querySelector('[data-read-mode]')", 3_000))) return 'Esc did not close reading mode';
    if (!(await waitInPage(win, `(${state}).focus === ${JSON.stringify(first.key)}`, 3_000))) return `after Esc the focus is not on the Read button of the reply (${JSON.stringify(await js(state))})`;
    const same = (await js(state)) as ReadState;
    if (Math.abs(same.scroll - first.scroll) > 2) return `Esc at the same reply moved the conversation from ${Math.round(first.scroll)} to ${Math.round(same.scroll)}`;

    // Another reply, then the back button: the conversation scrolls to that reply and its button has the focus.
    const second = await open();
    if (typeof second === 'string') return second;
    // The arrow keys go to the next reply (or the previous, at the last one), as the buttons do.
    const before = (await js("document.querySelector('[data-read-position]').textContent")) as string;
    const canNext = (await js("!document.querySelector('[data-read-next]').disabled")) as boolean;
    if (!canNext && (await js("document.querySelector('[data-read-previous]').disabled"))) return 'reading mode has no other reply to go to';
    pressKey(win, canNext ? 'Right' : 'Left');
    if (!(await waitInPage(win, `document.querySelector('[data-read-position]')?.textContent !== ${JSON.stringify(before)}`, 3_000))) return `the ${canNext ? '→' : '←'} key did not move to another reply`;
    // The buttons do the same: one step back from there.
    const moved = (await js("document.querySelector('[data-read-position]').textContent")) as string;
    await js(`document.querySelector('[data-read-${canNext ? 'previous' : 'next'}]').click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-read-position]')?.textContent === ${JSON.stringify(before)}`, 3_000))) return 'the arrow buttons did not move back to the first reply';
    pressKey(win, canNext ? 'Right' : 'Left');
    if (!(await waitInPage(win, `document.querySelector('[data-read-position]')?.textContent === ${JSON.stringify(moved)}`, 3_000))) return 'the arrow key did not return to the other reply';
    await js("document.querySelector('[data-read-back]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-read-mode]')", 3_000))) return 'the back button did not close reading mode';
    const landed = await waitInPage(win, `(() => { const s = ${state}; return s.focus !== null && s.focus !== ${JSON.stringify(second.key)}; })()`, 4_000);
    if (!landed) return `after leaving at another reply the focus is not on that reply's Read button (${JSON.stringify(await js(state))})`;
    const where = `(() => { const b = document.activeElement; const box = ${transcript}.getBoundingClientRect(); const r = b.getBoundingClientRect(); return b.matches('[data-read-button]') && r.bottom > box.top && r.top < box.bottom; })()`;
    if (!(await waitInPage(win, where, 4_000))) {
      return `after leaving at another reply its Read button is not in the conversation's view (${JSON.stringify(await js(`(() => { const b = document.activeElement; const r = b.getBoundingClientRect(); const box = ${transcript}.getBoundingClientRect(); return { tag: b.tagName, button: b.matches('[data-read-button]'), top: Math.round(r.top), bottom: Math.round(r.bottom), view: [Math.round(box.top), Math.round(box.bottom)], scroll: Math.round(${transcript}.scrollTop) }; })()`))})`;
    }

    // Reply with quote: select text in the column, the popover offers it, and it closes reading mode with the quote in
    // the message box. The box is put back exactly as it was; nothing is sent.
    const box = `${view} [data-composer]`;
    const draft = (await js(`document.querySelector('${box}')?.value ?? null`)) as string | null;
    if (draft === null) return 'failed: the session has no message box to quote into';
    try {
      const third = await open();
      if (typeof third === 'string') return third;
      // Selected by dragging the mouse over its first line, as a reader would: a press in reading mode must not start
      // anything else (a sidebar row's drag into the panes once cleared the selection on the first move).
      const line = (await js(`(() => {
        const p = [...document.querySelectorAll('[data-read-text] p')].find((el) => el.textContent.trim().length > 20 && el.getClientRects().length > 0);
        if (!p) return null;
        p.scrollIntoView({ block: 'center' });
        window.getSelection().removeAllRanges();
        const r = p.getClientRects()[0];
        return { left: Math.round(r.left + 2), right: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) };
      })()`)) as { left: number; right: number; y: number } | null;
      if (!line) return 'failed: reading mode shows no paragraph to select';
      win.webContents.sendInputEvent({ type: 'mouseDown', x: line.left, y: line.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 8; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(line.left + ((line.right - line.left) * i) / 8), y: line.y, button: 'left' });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: line.right, y: line.y, button: 'left', clickCount: 1 });
      if (!(await waitInPage(win, "window.getSelection().toString().trim().length > 10", 2_000))) return 'dragging over a paragraph in reading mode selected nothing';
      const picked = ((await js('window.getSelection().toString()')) as string).trim();
      const toolbar = "document.querySelector('[data-read-selection][data-side]')";
      if (!(await waitInPage(win, toolbar, 3_000))) return 'no popover over the selection in reading mode';
      const labels = (await js(`[...${toolbar}.querySelectorAll('button')].map((b) => b.textContent.trim())`)) as string[];
      if (labels.join(',') !== 'Reply with quote,CopyCopied,Ask about this') return `the reading popover holds ${JSON.stringify(labels)}`;
      if (!(await js(`!!${toolbar}.querySelector('[data-read-quote]') && !!${toolbar}.querySelector('[data-read-ask]')`))) return 'the reading popover lacks its data-read-quote or data-read-ask hook';
      await js(`${toolbar}.querySelector('[data-read-quote]').click()`);
      if (!(await waitInPage(win, "!document.querySelector('[data-read-mode]')", 3_000))) return 'Reply with quote did not close reading mode';
      if (!(await waitInPage(win, `document.querySelector('${box}').value.includes('> ')`, 3_000))) return `Reply with quote left the message box without a quote (${JSON.stringify(await js(`document.querySelector('${box}').value.slice(0, 60)`))})`;
      const value = (await js(`document.querySelector('${box}').value`)) as string;
      const firstLine = picked.split('\n')[0]!.trim();
      if (!value.includes(`> ${firstLine}`)) return `the message box does not hold the selection as a quote ("${value.slice(0, 40)}")`;
      keysTried = 'Reply with quote put the selection in the message box';
    } finally {
      await js('window.getSelection().removeAllRanges()');
      if ((await js("Boolean(document.querySelector('[data-read-mode]'))")) as boolean) pressKey(win, 'Escape');
      await setFieldValue(win, box, draft).catch(() => {});
    }
    const restored = (await js(`document.querySelector('${box}')?.value ?? null`)) as string | null;
    if (restored !== draft) return `the message box was not put back as it was (${JSON.stringify(restored?.slice(0, 40))})`;
    return `ok: Read opens "${opened.position}"${headings ? ` with an outline of ${outline}` : ''}, Esc at the same reply leaves the scroll and focuses its button, leaving at another reply scrolls to it, ← → move between replies, ${keysTried} (and the box is put back)${longOnes ? `, ${longOnes} long reply buttons hide until hover` : ''}`;
  } finally {
    if ((await js("Boolean(document.querySelector('[data-read-mode]'))")) as boolean) pressKey(win, 'Escape');
    await js('document.activeElement instanceof HTMLElement && document.activeElement.blur()');
    await js(`(() => { const el = ${transcript}; if (el) el.scrollTop = el.scrollHeight; })()`);
    await settle(win);
    if (borrowed && back) await js(`document.querySelector('[data-session-id="${back}"]')?.click()`);
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
 * Session linking, read-only: in New session, `@` lists sessions above files; picking one keeps `@<title>` in the text
 * and adds its chip. Nothing is sent; the chip and the text are taken out again.
 */
async function runLinkSessionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const prompt = "document.querySelector('[data-new-session-view] [data-composer]')";
  const chip = "document.querySelector('[data-new-session-view] [data-context-chip=\"session\"]')";
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: [MOD_MODIFIER] });
  if (!(await waitInPage(win, `!!document.querySelector('[data-folder-select]')?.dataset.value && ${prompt} && !${prompt}.disabled`, 5_000))) return 'New session has no folder to link from';
  await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
  await js(`${prompt}.focus()`);
  await win.webContents.insertText('@');
  // The throwaway profile's project may have no other session: then there is nothing to link.
  if (!(await waitInPage(win, "document.querySelector('[data-palette] [data-link-option]')", 4_000))) {
    await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
    return 'ok: no session in this project to link';
  }
  const heading = (await js("document.querySelector('[data-palette] [data-palette-heading]')?.innerText ?? ''")) as string;
  if (!/sessions/i.test(heading)) return `the @ list starts with ${JSON.stringify(heading)}, not Sessions`;
  const title = (await js("document.querySelector('[data-palette] [data-link-option] .font-semibold')?.innerText ?? ''")) as string;
  await shot(win, 'link-session-list.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  if (!(await waitInPage(win, `${chip} && /^@[^@]+$/.test(${prompt}.value.trim())`, 3_000))) return `picking a session did not add its chip and put its name in place of the @ (${JSON.stringify(await js(`${prompt}.value`))})`;
  await shot(win, 'link-session-chip.png');
  const text = (await js(`${prompt}.value`)) as string;
  await js(`${chip}.querySelector('[data-context-chip-remove]').click()`);
  await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
  if (!(await waitInPage(win, `!${chip} && ${prompt}.value === ''`, 3_000))) return 'the linked session chip did not go';
  return `ok: @ listed Sessions first; picked ${JSON.stringify(title)}, the box read ${JSON.stringify(text.trim())} with its chip; removed again`;
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

/** Opens New session's filter field as a person does: a tile has focus and a letter is typed (it starts the filter). */
function openFolderFilter(win: BrowserWindow): Promise<unknown> {
  return win.webContents.executeJavaScript(`(() => {
    const tile = document.querySelector('[data-new-session-view] [data-folder-select] button');
    tile?.focus();
    tile?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
  })()`);
}

/**
 * New session's project list follows the picker's width (Round 50): at its widest (56rem, less padding), three columns and
 * nine rows, a name too long for its row cut in the middle; with the sidebar open and the window narrower, two columns and eight, and a long name cut in the middle;
 * narrower still, one column and six. The window's minimum width is lowered for these sizes, as a side panel would
 * narrow the view instead. ⌘F opens Find, ⌘2 picks the second row, and ⌘7
 * does nothing with six. Ten empty folders in a new temporary folder are added as projects through Find… (a typed path
 * and ↩) so there are more than nine; they are removed again, and the window gets its size back.
 */
async function runProjectListStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const one = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const field = '[data-folder-list] input';
  const list = '[data-new-session-view] [data-folder-select][data-project-list]';
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-smoke-list-')));
  const names = ['intranet', 'vscode-demo-time', 'pf-app-customizer', 'doctor', 'playwright-msteams-reporter', 'vscode-front-matter', 'pointfire-document-summarization', 'tideline-web', 'engage-time', 'voice-snippets'];
  const dirs = names.map((name) => join(parent, name));
  for (const dir of dirs) mkdirSync(dir);
  const [width, height] = win.getContentSize() as [number, number];
  const [minWidth, minHeight] = win.getMinimumSize() as [number, number];
  const added: string[] = [];
  let before = '';
  /** The list as it shows: its columns, its rows' folders and their names (whole or cut), and how many rows sit on the first line. */
  const shape = async () =>
    (await js(`(() => {
      const list = ${one(list)};
      if (!list) return null;
      const rows = [...list.querySelectorAll('[data-project-row]')];
      const top = rows[0]?.getBoundingClientRect().top;
      return {
        columns: Number(list.dataset.projectColumns),
        rows: rows.length,
        firstLine: rows.filter((r) => Math.abs(r.getBoundingClientRect().top - top) < 2).length,
        cut: rows.filter((r) => r.querySelector('[data-project-name]').textContent !== r.getAttribute('aria-label').replace(/, [^,]*$/, '')).map((r) => r.querySelector('[data-project-name]').textContent),
        folders: rows.map((r) => r.dataset.folderOption),
      };
    })()`)) as { columns: number; rows: number; firstLine: number; cut: string[]; folders: string[] } | null;
  /**
   * Sizes the window so the picker is `pickerWidth` wide. A small window narrows the sidebar or folds it into the rail
   * (over 150ms), which widens the view again: measure, adjust by the difference, and repeat until it holds.
   */
  const pickerWidth = () => js(`Math.round(${one('[data-project-header]')}?.getBoundingClientRect().width ?? 0)`) as Promise<number>;
  const sizeFor = async (target: number) => {
    for (let i = 0; i < 6; i++) {
      const now = await pickerWidth();
      if (Math.abs(now - target) <= 1) return;
      const [current] = win.getContentSize() as [number, number];
      win.setContentSize(current + target - now, height);
      await waitInPage(win, `window.innerWidth === ${current + target - now}`, 1_000);
      await settle(win);
    }
  };
  try {
    pressKey(win, 'N', [MOD_MODIFIER]);
    if (!(await waitInPage(win, `${one('[data-new-session-view] [data-find-project]')} && ${one(list)}`, 3_000))) return 'New session has no Find… or no project list';
    // The remembered folder arrives a moment after the view opens.
    await new Promise((resolve) => setTimeout(resolve, 300));
    before = (await js(`${one(list)}.dataset.value`)) as string;
    // ⌘F opens the full list with the cursor in its field; the first folder is added that way, the rest through Find….
    for (const [index, dir] of dirs.entries()) {
      if (index === 0) pressKey(win, 'F', [MOD_MODIFIER]);
      else await js(`${one('[data-new-session-view] [data-find-project]')}.click()`);
      if (!(await waitInPage(win, `document.activeElement === ${one(field)}`, 3_000))) return index === 0 ? '⌘F did not open the filter field' : 'Find… did not open the filter field';
      await setFieldValue(win, field, dir);
      const suggestion = one(`[data-path-suggestion=${JSON.stringify(dir)}]`);
      if (!(await waitInPage(win, `${suggestion}?.dataset.active === 'true'`, 3_000))) return `typing ${dir} did not offer the folder`;
      pressKey(win, 'Return');
      if (!(await waitInPage(win, `${one(list)}?.dataset.value === ${JSON.stringify(dir)}`, 5_000))) return `↩ did not add and pick ${dir}`;
      added.push(dir);
    }

    // Wide (the column's 56rem less its padding): three columns, nine rows, three on the first line, any cut name cut in the middle.
    if (!(await js("Boolean(document.querySelector('[data-sidebar-open]'))"))) {
      pressKey(win, 'B', [MOD_MODIFIER]);
      if (!(await waitInPage(win, one('[data-sidebar-open]'), 3_000))) return 'the sidebar did not open';
    }
    // The window's minimum width would clamp the narrow sizes below (how far depends on the sidebar's width).
    win.setMinimumSize(400, minHeight);
    await sizeFor(848);
    if (!(await waitInPage(win, `${one(list)}?.dataset.projectColumns === '3' && ${one(list)}.querySelectorAll('[data-project-row]').length === 9`, 3_000))) return `a wide window did not show three columns and nine rows (${JSON.stringify(await shape())})`;
    let now = (await shape())!;
    if (now.firstLine !== 3) return `three columns put ${now.firstLine} rows on the first line`;
    for (const cut of now.cut) if (!/^.+….+$/.test(cut)) return `a name was cut at its end in a wide window: ${cut}`;
    if (!(await js(`${one('[data-new-session-view] [data-all-projects]')}?.innerText.startsWith('All ')`))) return 'no All N projects… under the list';
    // ⌘2 picks the second row: left to right, so the middle of the first line.
    const second = now.folders[1]!;
    pressKey(win, '2', [MOD_MODIFIER]);
    if (!(await waitInPage(win, `${one(list)}?.dataset.value === ${JSON.stringify(second)}`, 3_000))) return `⌘2 did not pick the second row (${String(await js(`${one(list)}?.dataset.value`))})`;
    await shot(win, 'new-session-project-list.png');

    // Two columns, eight rows.
    await sizeFor(650);
    if (!(await waitInPage(win, `${one(list)}?.dataset.projectColumns === '2' && ${one(list)}.querySelectorAll('[data-project-row]').length === 8`, 3_000))) return `a narrower window did not show two columns and eight rows (${JSON.stringify(await shape())})`;
    now = (await shape())!;
    if (now.firstLine !== 2) return `two columns put ${now.firstLine} rows on the first line`;
    // Narrow columns: the long name is cut in the middle, and its tooltip and label have it whole.
    await sizeFor(530);
    const long = dirs.find((dir) => basename(dir) === 'pointfire-document-summarization')!;
    const longRow = one(`[data-new-session-view] [data-folder-option=${JSON.stringify(long)}]`);
    if (!(await waitInPage(win, `${longRow}?.querySelector('[data-project-name]').textContent.includes('…')`, 3_000))) return `a long name in a narrow column was not cut (${String(await js(`${longRow}?.querySelector('[data-project-name]').textContent`))})`;
    const cutName = (await js(`${longRow}.querySelector('[data-project-name]').textContent`)) as string;
    // A wider font (Linux) may cut right after the dash.
    if (!/^pointfire-.*….*ation$/.test(cutName)) return `a long name was not cut in the middle: ${cutName}`;
    if (!(await js(`${longRow}.dataset.tooltip.startsWith('pointfire-document-summarization\\n') && ${longRow}.getAttribute('aria-label').startsWith('pointfire-document-summarization, ')`))) return 'the cut name has no whole name in its tooltip or label';

    // One column, six rows: as a side panel would make it.
    await sizeFor(440);
    if (!(await waitInPage(win, `${one(list)}?.dataset.projectColumns === '1' && ${one(list)}.querySelectorAll('[data-project-row]').length === 6`, 3_000))) return `a narrow view did not show one column and six rows (${JSON.stringify(await shape())})`;
    now = (await shape())!;
    // A name cut in the middle keeps its start and its end; the tooltip has it whole, with its folder.
    for (const cut of now.cut) if (!/^.+….+$/.test(cut)) return `a name was cut at its end, not in the middle: ${cut}`;
    // ⌘7 picks nothing with six rows.
    const picked = (await js(`${one(list)}.dataset.value`)) as string;
    pressKey(win, '7', [MOD_MODIFIER]);
    await settle(win);
    if ((await js(`${one(list)}.dataset.value`)) !== picked) return '⌘7 picked a project that is not on screen';
    // Add project… keeps only its icon, with its label as the tooltip.
    const addButton = `[...document.querySelectorAll('[data-new-session-view] [data-add-folder]')].map((b) => (b.getAttribute('aria-label') ?? '-') + ':' + b.innerText.trim())`;
    if (!(await waitInPage(win, `${addButton}.join() === 'Add project…:'`, 2_000))) return `Add project… kept its label in one column (${String(await js(`${addButton}.join(' | ')`))}, ${String(await js(`${one(list)}?.dataset.projectColumns`))} columns)`;
    return `ok: three columns and nine rows wide (⌘2 picked ${basename(second)}), two and eight (${cutName} in narrow ones), one and six, ⌘7 did nothing`;
  } finally {
    win.setMinimumSize(minWidth, minHeight);
    win.setContentSize(width, height);
    // Wide again before Projects opens, where a narrow view folds its list into an overlay.
    await waitInPage(win, `window.innerWidth === ${width}`, 3_000);
    // Off the throwaway profile's projects again.
    // Projects may not open on the first try while the window settles at its size again; a project left behind would
    // point at a deleted folder, which the backup step's import then skips.
    for (const dir of added) {
      const removed = (await removeProjectInProjects(win, dir)) && (await settle(win), await removeProjectInProjects(win, dir));
      if (removed) console.log(`[smoke] could not remove the project ${dir}: ${removed}`);
    }
    // New session back on its folder (the ones added are about to go), or on none.
    if (before) openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(before)}`);
    else pressKey(win, 'N', [MOD_MODIFIER]);
    await waitInPage(win, one('[data-new-session-view]'), 3_000);
    try {
      rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      console.log(`[smoke] could not remove ${parent}: ${(error as Error).message}`);
    }
  }
}

/**
 * Adding a project in New session is one step. Add project… in the header opens the Add project dialog over New
 * session, and closing it without adding changes nothing. In a new temporary folder (with one folder inside): a typed path lists folders, the faint rest of the name and Tab complete it, Tab again goes inside, a
 * missing folder says so, and ↩ adds the folder as a project and picks it. A dragged file is refused. Only the
 * throwaway profile's project list changes: the project is removed again and New session goes back to its folder.
 */
async function runAddFolderStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const one = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const field = '[data-folder-list] input';
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-smoke-add-')));
  mkdirSync(join(dir, 'inner'));
  const suggestion = (path: string) => one(`[data-path-suggestion=${JSON.stringify(path)}]`);
  pressKey(win, 'N', ['meta']);
  if (!(await waitInPage(win, `${one('[data-new-session-view] [data-add-folder]')} && ${one('[data-folder-select]')}`, 3_000))) return 'New session has no Add project… in the Project header';
  // The remembered folder arrives a moment after the view opens.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const before = (await js(`${one('[data-folder-select]')}.dataset.value`)) as string;

  // Add project…: onboarding's dialog, over New session; Done without adding leaves the folder as it was.
  await js(`${one('[data-new-session-view] [data-add-folder]')}.click()`);
  if (!(await waitInPage(win, `${one('[data-add-project-dialog]')} && ${one('[data-new-session-view]')}`, 3_000))) return 'Add project… did not open the Add project dialog';
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, `!${one('[data-add-project-dialog]')} && ${one('[data-new-session-view]')} && ${one('[data-folder-select]')}?.dataset.value === ${JSON.stringify(before)}`, 3_000))) return 'closing the Add project dialog left New session or changed its folder';

  // A file dragged over the projects: the overlay refuses it, and goes when the drag ends.
  await js(`(() => {
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    document.querySelector('[data-project-header]').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
  })()`);
  if (!(await waitInPage(win, `${one('[data-folder-drop]')}?.dataset.folderDrop === 'refused' && ${one('[data-folder-drop]')}.innerText.includes('Drop one folder')`, 2_000))) return 'a dragged file did not show "Drop one folder"';
  await js("window.dispatchEvent(new DragEvent('dragend'))");
  if (!(await waitInPage(win, `!${one('[data-folder-drop]')}`, 2_000))) return 'the drop overlay stayed after the drag ended';

  await js(`${one('[data-new-session-view] [data-find-project]')}.click()`);
  if (!(await waitInPage(win, `${one(field)} && document.activeElement === ${one(field)}`, 3_000))) return 'Find… did not open the filter field';
  // The start of the folder's name: the rest shows faint, Tab takes it, Tab again goes inside.
  const partial = dir.slice(0, -3);
  await setFieldValue(win, field, partial);
  if (!(await waitInPage(win, `${suggestion(dir)} && ${one('[data-path-ghost]')}?.innerText.endsWith(${JSON.stringify(dir.slice(-3))})`, 3_000))) return `typing ${partial} did not offer the folder with its rest`;
  pressKey(win, 'Tab');
  if (!(await waitInPage(win, `${one(field)}.value === ${JSON.stringify(dir)}`, 2_000))) return `Tab did not complete the folder (${String(await js(`${one(field)}.value`))})`;
  pressKey(win, 'Tab');
  // The separator the path uses goes after it: a backslash on Windows.
  if (!(await waitInPage(win, `${one(field)}.value === ${JSON.stringify(`${dir}${sep}`)} && ${suggestion(join(dir, 'inner'))} && ${suggestion(dir)}`, 3_000))) return `Tab on a whole folder did not list what is inside (${String(await js(`${one(field)}.value`))})`;
  await setFieldValue(win, field, `${dir}/no-such-folder`);
  if (!(await waitInPage(win, one('[data-path-missing]'), 3_000))) return 'a missing folder did not say so';

  // ↩ on the folder: added as a project and picked (no "Add to your projects" box under the message box).
  await setFieldValue(win, field, dir);
  if (!(await waitInPage(win, `${suggestion(dir)}?.dataset.active === 'true' && ${suggestion(dir)}.innerText.includes('Add and start here')`, 3_000))) return 'the folder row did not offer Add and start here';
  pressKey(win, 'Return');
  const added = `${one('[data-folder-select]')}?.dataset.value === ${JSON.stringify(dir)} && ${one(`[data-folder-option=${JSON.stringify(dir)}]`)} && !${one('[data-add-as-project]')}`;
  if (!(await waitInPage(win, added, 5_000))) return `↩ did not add and pick the folder (${String(await js(`${one('[data-folder-select]')}?.dataset.value`))})`;

  // Clean up: off the throwaway profile's projects again, and New session back on its folder.
  const removed = await removeProjectInProjects(win, dir);
  if (removed) return removed === 'the project is not in Projects' ? 'the added folder is not in Projects' : removed;
  if (before) {
    openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(before)}`);
    if (!(await waitInPage(win, `${one('[data-folder-select]')}?.dataset.value === ${JSON.stringify(before)}`, 5_000))) return 'New session did not go back to its folder';
  }
  // On Windows the folder can't be removed while a process still runs in it (New session warms Claude Code up for the
  // folder it picked): try for a while, then leave it in the temp folder rather than fail the step.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.log(`[smoke] could not remove ${dir}: ${(error as Error).message}`);
  }
  return 'ok: Add project… opened the Add project dialog and Esc left New session as it was, a refused file drop, Find… opened the field, ghost text and Tab, Tab into a folder, a missing folder, ↩ added and picked it; removed again';
}

/**
 * Clone from GitHub, never from the network and never starting a session: Settings › Projects turns it on with a
 * throwaway Clone into folder (the folder dialog answered here), a GitHub URL in New session's folder field offers
 * Clone owner/name, and ↩ clones a local bare repository (the engine clones from SESHBOARD_CLONE_SOURCE in a smoke
 * run), which is added as a project and picked, without a worktree. Start then asks about the hook the repository
 * brings; Cancel keeps the prompt and starts nothing. Ends as it started: the project removed, the setting off, the
 * folders gone.
 */
async function runCloneStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const one = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const source = process.env.SESHBOARD_CLONE_SOURCE;
  if (!source) return 'no SESHBOARD_CLONE_SOURCE: the engine would clone from GitHub';
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-smoke-clone-')));
  const bare = join(source, 'acme', 'smoke-clone.git');
  const folder = join(sandbox, 'Developer');
  const target = join(folder, 'smoke-clone');
  const cleanUp = () => {
    // On Windows a folder can't be removed while a process still runs in it: try for a while, then leave it in temp.
    for (const path of [sandbox, bare]) {
      try {
        rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (error) {
        console.log(`[smoke] could not remove ${path}: ${(error as Error).message}`);
      }
    }
  };
  // "GitHub": acme/smoke-clone, a bare repository whose project settings bring a hook.
  const work = join(sandbox, 'work');
  mkdirSync(join(work, '.claude'), { recursive: true });
  const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(work, ['init', '-q']);
  writeFileSync(join(work, 'README.md'), '# Smoke clone\n');
  writeFileSync(join(work, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo smoke' }] }] } }));
  git(work, ['add', '.']);
  git(work, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', 'commit', '-q', '-m', 'first']);
  mkdirSync(join(source, 'acme'), { recursive: true });
  git(sandbox, ['clone', '-q', '--bare', work, bare]);
  mkdirSync(folder);

  // Settings › Projects: turning it on asks for the folder first.
  await js(`${one('[data-open-settings]')}.click()`);
  if (!(await waitInPage(win, one('[data-settings-section="projects"]'), 3_000))) return (cleanUp(), 'Settings has no Projects page');
  await js(`${one('[data-settings-section="projects"]')}.click()`);
  if (!(await waitInPage(win, `${one('[data-settings-page="projects"]')} && ${one('[data-clone-enabled]')} && ${one('[data-project-order]')}`, 3_000))) return (cleanUp(), 'Settings › Projects has no Clone from GitHub or Project order');
  process.env.SESHBOARD_PICK_FOLDER = folder;
  await js(`${one('[data-clone-enabled]')}.click()`);
  if (!(await waitInPage(win, `${one('[data-clone-enabled]')}.getAttribute('aria-checked') === 'true' && ${one(`[data-clone-folder-path=${JSON.stringify(folder)}]`)}`, 3_000))) {
    delete process.env.SESHBOARD_PICK_FOLDER;
    return (cleanUp(), 'turning on Clone from GitHub did not ask for its folder and turn on');
  }
  await js(`${one('[data-close-settings]')}.click()`);

  const turnOff = async () => {
    await js(`${one('[data-open-settings]')}.click()`);
    await waitInPage(win, one('[data-settings-page="projects"] [data-clone-enabled]'), 3_000);
    if ((await js(`${one('[data-clone-enabled]')}?.getAttribute('aria-checked')`)) === 'true') await js(`${one('[data-clone-enabled]')}.click()`);
    const off = await waitInPage(win, `${one('[data-clone-enabled]')}?.getAttribute('aria-checked') === 'false'`, 3_000);
    await js(`${one('[data-close-settings]')}?.click()`);
    return off;
  };
  const fail = async (why: string) => {
    await js(`${one('[data-clone-close]')}?.click()`);
    await turnOff();
    cleanUp();
    return why;
  };

  // New session: Clone from GitHub… next to Add project…, and a URL pasted in the folder field offers the clone.
  pressKey(win, 'N', ['meta']);
  if (!(await waitInPage(win, `${one('[data-new-session-view] [data-clone-from-github]')} && ${one('[data-new-session-view] [data-find-project]')}`, 3_000))) return fail('New session has no Clone from GitHub…');
  await js(`${one('[data-new-session-view] [data-find-project]')}.click()`);
  if (!(await waitInPage(win, one('[data-folder-list] input'), 3_000))) return fail('Filter did not open the folder field');
  await setFieldValue(win, '[data-folder-list] input', 'https://github.com/acme/smoke-clone');
  if (!(await waitInPage(win, `${one('[data-clone-option="acme/smoke-clone"]')}?.dataset.active === 'true'`, 3_000))) return fail('a GitHub URL in the folder field did not offer Clone acme/smoke-clone');
  pressKey(win, 'Return');
  if (!(await waitInPage(win, `${one('[data-clone-repo]')}?.dataset.cloneState === 'done' && ${one('[data-clone-progress="done"]')}`, 20_000))) {
    return fail(`the clone did not finish: ${String(await js(`${one('[data-clone-repo]')}?.innerText ?? 'no clone form'`))}`);
  }
  if (!existsSync(join(target, 'README.md'))) return fail('the clone is not in the Clone into folder');
  const picked = `${one('[data-route-project]')}?.dataset.tooltip === ${JSON.stringify(target)}`;
  if (!(await waitInPage(win, `${picked} && ${one('[data-worktree-switch]')}?.disabled === true`, 5_000))) return fail('the clone was not picked as the project, or a fresh clone still offers a worktree');
  await shot(win, 'clone-from-github.png');

  // Start asks about the hook it brings; Cancel starts nothing and keeps the prompt.
  const box = '[data-new-session-view] [data-composer]';
  await setFieldValue(win, box, 'Smoke: never sent');
  await js(`${one('[data-new-session-view] [data-composer-submit]')}.click()`);
  if (!(await waitInPage(win, `${one('[data-clone-trust]')}?.innerText.includes('echo smoke') && document.activeElement === ${one('[data-clone-trust-cancel]')}`, 5_000))) return fail('Start did not ask about the hook the repository brings, with Cancel focused');
  await js(`${one('[data-clone-trust-cancel]')}.click()`);
  if (!(await waitInPage(win, `!${one('[data-clone-trust]')} && ${one('[data-new-session-view]')} && ${one(box)}?.value === 'Smoke: never sent'`, 3_000))) return fail('Cancel left New session or lost the prompt');
  await setFieldValue(win, box, '');

  // Clean up: the form closed, the project removed, the setting off, the folders gone.
  await js(`${one('[data-clone-close]')}.click()`);
  if (!(await waitInPage(win, `!${one('[data-clone-repo]')} && ${one(`[data-folder-option=${JSON.stringify(target)}]`)}`, 3_000))) return fail('Done did not show the clone as a project tile');
  const removed = await removeProjectInProjects(win, target);
  if (removed) return fail(removed === 'the project is not in Projects' ? 'the clone is not in Projects' : removed);
  if (!(await turnOff())) return (cleanUp(), 'Clone from GitHub did not turn off again');
  cleanUp();
  return 'ok: Settings › Projects asked for the folder and turned it on, a URL in the folder field offered the clone, ↩ cloned the local repository and picked it without a worktree, Start asked about its hook and Cancel kept the prompt; removed and turned off again';
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
    if (session) openDeepLink(`seshboard://session/${session}`);
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
    // A tile when it is a project; otherwise a link picks it, since a typed path would add it to the projects (and the
    // throwaway profile must have none until the projects step).
    if (await js(`!!${optionFor(before)}`)) await js(`${optionFor(before)}.click()`);
    else openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(before)}`);
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
 * `seshboard://` links, fed to the handler directly (no `open`, so the system's link handlers are
 * untouched). A new-session link fills in the folder and prompt and says where the prompt came from,
 * but sends nothing; a bad link shows why and changes nothing; a repo with no checkout leaves the folder
 * empty; a session link opens the session under test again.
 */
/** The made-up repository the smoke's fake gh answers for (tests/fixtures/fake-gh.cjs). */
const SMOKE_GITHUB_REPO = 'smoke-owner/smoke-repo';
let smokeGithubFolder: string | null = null;
/**
 * A throwaway git repository whose remote is on GitHub (the made-up smoke-owner/smoke-repo), for the # list steps: one
 * commit on main, nothing pushed or fetched. Made once per run, in the temporary folder.
 */
function smokeGithubCheckout(): string {
  if (smokeGithubFolder) return smokeGithubFolder;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-smoke-gh-')));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), '# Smoke repo\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Initial commit');
  git('remote', 'add', 'origin', `https://github.com/${SMOKE_GITHUB_REPO}.git`);
  smokeGithubFolder = dir;
  return dir;
}

/** Opens New session on the smoke's GitHub checkout with an empty box; false when it didn't get there. */
async function newSessionOnSmokeGithub(win: BrowserWindow): Promise<string | null> {
  const root = smokeGithubCheckout();
  openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(root)}`);
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  if (!(await waitInPage(win, `document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(root)} && ${composer} && !${composer}.disabled`, 8_000))) return null;
  await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
  return root;
}

/**
 * The # list, read-only, with the smoke's fake gh (never GitHub) on a throwaway repository whose remote is on GitHub:
 * `#` lists Issues, then Pull requests, with the repository in the header; typing narrows it; ↩ adds the chip and
 * takes `#…` out of the text; Esc keeps what was typed as text; `C#` opens nothing. Then, where the demo world has
 * one, a message that attached an issue shows its Attached row, and What Claude got shows the block as Claude read
 * it, marked as context. Nothing is sent.
 */
async function runGithubListStep(win: BrowserWindow): Promise<string> {
  if (process.platform === 'win32') return 'ok: skipped on Windows, where the smoke test has no fake gh';
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const box = '[data-new-session-view] [data-composer]';
  const composer = `document.querySelector(${JSON.stringify(box)})`;
  const list = "document.querySelector('[data-new-session-view] [data-github-list]')";
  const chip = "document.querySelector('[data-new-session-view] [data-github-chip=\"issue:32\"]')";
  const root = await newSessionOnSmokeGithub(win);
  if (!root) return 'New session did not open on the throwaway GitHub checkout';
  const clear = async () => {
    if (await js(`!!${list}`)) pressKey(win, 'Escape');
    if (await js(`!!${chip}`)) await js(`${chip}.querySelector('[data-context-chip-remove]').click()`);
    await setFieldValue(win, box, '');
  };
  await js(`${composer}.focus()`);
  await win.webContents.insertText('can you look at #');
  if (!(await waitInPage(win, `${list}?.querySelector('[data-github-option]')`, 8_000))) return (await clear(), `# opened no list (${String(await js(`${list}?.innerText ?? 'no list'`))})`);
  const headings = (await js(`[...${list}.querySelectorAll('[role=group]')].map((g) => document.getElementById(g.getAttribute('aria-labelledby'))?.innerText.trim().toLowerCase())`)) as string[];
  if (headings.join(',') !== 'issues,pull requests') return (await clear(), `the groups are ${JSON.stringify(headings)}`);
  const repo = (await js(`${list}.querySelector('[data-github-list-repo]')?.innerText ?? ''`)) as string;
  if (!repo.includes(SMOKE_GITHUB_REPO)) return (await clear(), `the header says ${JSON.stringify(repo)}`);
  if (!(await js(`!!${list}.querySelector('[data-github-option="pr:149"] [data-github-fork]')`))) return (await clear(), 'the fork pull request has no fork flag');
  await shot(win, 'github-list.png');
  await win.webContents.insertText('start');
  if (!(await waitInPage(win, `${list}?.querySelector('[role=option][aria-selected=true]')?.dataset.githubOption === 'issue:32' && !${list}.querySelector('[data-github-option="issue:118"]')`, 5_000))) {
    return (await clear(), 'typing did not narrow the list to #32 first');
  }
  const label = (await js(`${list}.querySelector('[role=option][aria-selected=true]').getAttribute('aria-label')`)) as string;
  if (!label.startsWith('Issue 32, Start a session from a GitHub issue or pull request, open, enhancement')) return (await clear(), `the row reads ${JSON.stringify(label)}`);
  pressKey(win, 'Return');
  if (!(await waitInPage(win, `${chip} && ${composer}.value === 'can you look at ' && !${list}`, 3_000))) return (await clear(), `↩ did not add the chip and take #start out (${JSON.stringify(await js(`${composer}.value`))})`);
  const chipLabel = (await js(`${chip}.querySelector('button').getAttribute('aria-label')`)) as string;
  if (chipLabel !== 'Issue 32 attached, open on GitHub') return (await clear(), `the chip is labelled ${JSON.stringify(chipLabel)}`);
  // The chip's detail comes from gh: its label and comments.
  if (!(await waitInPage(win, `${chip}.innerText.includes('enhancement · 4 comments')`, 5_000))) return (await clear(), `the chip shows ${JSON.stringify(await js(`${chip}.innerText`))}`);
  await shot(win, 'github-chip.png');
  // Esc keeps typing: the list stays closed for that word.
  await win.webContents.insertText('#');
  if (!(await waitInPage(win, list, 5_000))) return (await clear(), 'a second # opened no list');
  pressKey(win, 'Escape');
  await win.webContents.insertText('11');
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (await js(`!!${list}`)) return (await clear(), 'the list came back after Esc while typing the same word');
  if (!(await js(`${composer}.value === 'can you look at #11' && !!${chip}`))) return (await clear(), 'Esc changed the text or the chip');
  // # in the middle of a word is text.
  await setFieldValue(win, box, 'written in C');
  await js(`${composer}.focus(); ${composer}.setSelectionRange(12, 12)`);
  await win.webContents.insertText('#');
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (await js(`!!${list}`)) return (await clear(), 'C# opened the list');
  await clear();
  if (!(await waitInPage(win, `!${chip} && ${composer}.value === ''`, 3_000))) return 'could not take the chip and the text out again';
  const attached = await attachedRowInDemo(win);
  if (attached.startsWith('failed')) return attached;
  return `ok: # listed Issues then Pull requests for ${SMOKE_GITHUB_REPO} (fork flagged), typing narrowed it, ↩ added #32 as a chip with its labels and comments, Esc kept typing, C# stayed text; ${attached}`;
}

/** Takes New session's box back to empty after a GitHub step: the chips out, no text. */
async function emptyNewSessionBox(win: BrowserWindow): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (await js("!!document.querySelector('[role=menu], [data-menu]')")) pressKey(win, 'Escape');
  await js("[...document.querySelectorAll('[data-new-session-view] [data-context-chip] [data-context-chip-remove]')].forEach((b) => b.click())");
  await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
}

/**
 * New session from an issue and from a pull request, read-only (fake gh, the throwaway GitHub checkout): ⌥↩ on #32 in
 * the # list fills in a New worktree named issue-32-<slug>, the chip and "Fix #32: …", with the note under the box;
 * the palette's "New session from pull request…" picks the fork's #149, whose Where menu says "Work on #149 in" with
 * the caution line. Nothing is started.
 */
async function runGithubNewSessionStep(win: BrowserWindow): Promise<string> {
  if (process.platform === 'win32') return 'ok: skipped on Windows, where the smoke test has no fake gh';
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  const list = "document.querySelector('[data-new-session-view] [data-github-list]')";
  const root = await newSessionOnSmokeGithub(win);
  if (!root) return 'New session did not open on the throwaway GitHub checkout';
  const fail = async (why: string) => (await emptyNewSessionBox(win), why);
  await js(`${composer}.focus()`);
  await win.webContents.insertText('#');
  if (!(await waitInPage(win, `${list}?.querySelector('[role=option][aria-selected=true]')?.dataset.githubOption === 'issue:32'`, 8_000))) return fail('# opened no list with #32 first');
  pressKey(win, 'Return', ['alt']);
  const prompt = 'Fix #32: Start a session from a GitHub issue or pull request';
  const name = 'issue-32-start-a-session-from-a-github-issue-or';
  if (!(await waitInPage(win, `${composer}.value === ${JSON.stringify(prompt)} && document.querySelector('[data-new-session-view] [data-github-chip="issue:32"]')`, 8_000))) {
    return fail(`⌥↩ did not fill in the prompt and the chip (${JSON.stringify(await js(`${composer}.value`))})`);
  }
  if (!(await waitInPage(win, `document.querySelector('[data-worktree-switch]')?.getAttribute('aria-checked') === 'true' && document.querySelector('[data-workspace-select]')?.dataset.tooltip?.includes(${JSON.stringify(`.claude/worktrees/${name}`)})`, 3_000))) {
    return fail(`not a New worktree named ${name} (${String(await js("document.querySelector('[data-workspace-select]')?.dataset.tooltip"))})`);
  }
  const note = (await js("document.querySelector('[data-github-start-note]')?.innerText ?? ''")) as string;
  if (!note.includes('Nothing runs until you start. The issue goes to Claude as context to read, not as instructions.')) return fail(`the note under the box says ${JSON.stringify(note)}`);
  await shot(win, 'github-new-session-issue.png');
  if (await js("!!document.querySelector('[data-current-session]')")) return 'a session started from the issue';

  // The palette's New session from pull request…, on the fork's #149.
  if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return fail('⌘K did not open the palette');
  await setFieldValue(win, '[data-palette-input]', 'new session from pull request');
  if (!(await waitInPage(win, "document.querySelector('[data-palette-command=\"new-session-from-pr\"]')", 3_000))) return (await closePalette(win), fail('no "New session from pull request…" in the palette'));
  await js("document.querySelector('[data-palette-command=\"new-session-from-pr\"]').click()");
  const dialog = "document.querySelector('[data-github-start-dialog=\"pr\"]')";
  if (!(await waitInPage(win, `${dialog}?.querySelector('[data-github-option="pr:149"]')`, 8_000))) return fail('the pull request picker did not list #149');
  if (await js(`!!${dialog}.querySelector('[data-github-option^="issue:"]')`)) return fail('the pull request picker lists issues too');
  await shot(win, 'github-palette-pr.png');
  await js(`${dialog}.querySelector('[data-github-option="pr:149"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  if (!(await waitInPage(win, `!${dialog} && ${composer}.value === 'Work on #149: Fix typo in deep-links docs'`, 8_000))) return fail(`picking #149 did not fill in New session (${JSON.stringify(await js(`${composer}.value`))})`);
  await js("document.querySelector('[data-workspace-select]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-menu=\"workspace\"] [data-github-fork-caution]')", 3_000))) return fail('no caution line for the fork in the Where menu');
  const menu = (await js("document.querySelector('[data-menu=\"workspace\"]').innerText")) as string;
  // The heading is in small capitals (CSS), so its text comes back in upper case.
  if (!menu.toLowerCase().includes('work on #149 in') || !menu.includes('New worktree from the pull request') || !menu.includes("#149 is from a fork. Claude can change it here, but Seshboard can't push it back.")) {
    return fail(`the Where menu reads ${JSON.stringify(menu)}`);
  }
  await shot(win, 'github-pr-where.png');
  pressKey(win, 'Escape');
  await waitInPage(win, "!document.querySelector('[data-menu=\"workspace\"]')", 2_000);
  if (await js("!!document.querySelector('[data-current-session]')")) return 'a session started from the pull request';
  await emptyNewSessionBox(win);
  return `ok: ⌥↩ on #32 filled in worktree-${name}, its chip, "${prompt}" and the note; the palette picked the fork's #149 with "Work on #149 in" and the caution line; nothing started`;
}

/**
 * A link with an issue, read-only: `issue=32&autostart=1` fills in New session the same way, with the banner and the
 * line that such links never start on their own; nothing starts. An issue of another repository is refused.
 */
async function runGithubLinkStep(win: BrowserWindow): Promise<string> {
  if (process.platform === 'win32') return 'ok: skipped on Windows, where the smoke test has no fake gh';
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  const root = smokeGithubCheckout();
  const fail = async (why: string) => (await emptyNewSessionBox(win), why);
  openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(root)}&issue=32&autostart=1`);
  const prompt = 'Fix #32: Start a session from a GitHub issue or pull request';
  if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(prompt)} && document.querySelector('[data-from-link-banner]')`, 10_000))) {
    return fail(`the link did not fill in New session (${JSON.stringify(await js(`${composer}?.value`))})`);
  }
  const banner = (await js("document.querySelector('[data-from-link-banner]').innerText")) as string;
  if (!banner.includes('Opened from a link with issue #32. Check the prompt, then start.') || !banner.includes('Links with an issue or pull request never start on their own.')) return fail(`the banner reads ${JSON.stringify(banner)}`);
  // Showing that something did not happen: give a start that shouldn't come the time it would take.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (await js("!!document.querySelector('[data-current-session]') || !document.querySelector('[data-new-session-view]')")) return 'the link with autostart=1 started a session';
  await shot(win, 'github-link.png');
  await emptyNewSessionBox(win);
  // An issue of another repository than the project's is refused, and nothing is filled in.
  openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(root)}&issue=${encodeURIComponent('https://github.com/smoke-owner/other-repo/issues/32')}`);
  if (!(await waitInPage(win, "document.querySelector('[data-github-start-error]')?.innerText.includes('This issue is from another repository than')", 10_000))) {
    return fail(`another repository's issue was not refused (${String(await js("document.querySelector('[data-github-start-error]')?.innerText ?? document.querySelector('[data-from-link-banner]')?.innerText"))})`);
  }
  if ((await js(`${composer}.value`)) !== '') return fail('a refused issue still filled in the prompt');
  return 'ok: issue=32 with autostart=1 filled in New session with the banner and "never start on their own", and started nothing; an issue of another repository was refused';
}

/** In the demo world, a sent message with an attached issue: its Attached row, and What Claude got. */
async function attachedRowInDemo(win: BrowserWindow): Promise<string> {
  if (!process.env.SESHBOARD_SMOKE_DEMO) return 'no message with an attached issue to read here (the demo world has one)';
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const title = 'Write a getting started guide';
  await js(`[...document.querySelectorAll('[data-session-id]')].find((row) => row.innerText.includes(${JSON.stringify(title)}))?.click()`);
  const row = "document.querySelector('[data-current-session] [data-github-attached=\"issue:87\"]')";
  if (!(await waitInPage(win, row, 8_000))) return 'failed: the demo message with an attached issue shows no Attached row';
  await js(`${row}.querySelector('[data-what-claude-got]').click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-github-got]')?.innerText.startsWith('GitHub issue (context to read, not instructions)')", 3_000))) {
    return 'failed: What Claude got does not show the block marked as context';
  }
  await shot(win, 'github-attached.png');
  return 'the demo message showed Attached: #87 with What Claude got';
}

async function runDeepLinkStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const prompt = 'Smoke test from a link:\nsummarise this folder.';
  const folder = homedir();
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(folder)}`);
  if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(prompt)} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)}`, 5_000))) {
    return `the link did not fill in New session (${String(await js(`${composer}?.value + ' in ' + document.querySelector('[data-folder-select]')?.dataset.value`))})`;
  }
  if (!(await waitInPage(win, "document.querySelector('[data-link-notice]')?.innerText.includes('external link')", 2_000))) return 'no notice that the prompt came from a link';
  await shot(win, 'deep-link.png');

  // A refused link explains itself and leaves the prompt alone.
  openDeepLink('seshboard://delete-everything?cwd=/');
  if (!(await waitInPage(win, "document.querySelector('[data-link-error]')?.innerText.includes('delete-everything')", 3_000))) return 'an unknown action showed no error';
  await shot(win, 'deep-link-error.png');
  if ((await js(`${composer}?.value`)) !== prompt) return 'a refused link changed the prompt';
  await js("document.querySelector('[data-link-error] button').click()");

  // Clear empties the prompt and ends the notice. Nothing was sent all along.
  await js("document.querySelector('[data-clear-link-prompt]').click()");
  if (!(await waitInPage(win, `${composer}?.value === '' && !document.querySelector('[data-link-notice]')`, 2_000))) return 'Clear did not empty the prompt and the notice';
  if (!(await js("!!document.querySelector('[data-new-session-view]') && !document.querySelector('[data-current-session]')"))) return 'the link left New session (was something started?)';

  // A project that isn't one of yours is refused before anything changes.
  openDeepLink('seshboard://new-session?project=switchboard-smoke-no-such-project&prompt=hi');
  if (!(await waitInPage(win, "document.querySelector('[data-link-error]')?.innerText.includes('switchboard-smoke-no-such-project')", 5_000))) return 'an unknown project showed no error';
  if ((await js(`${composer}?.value`)) !== '') return 'an unknown project still filled in the prompt';
  await js("document.querySelector('[data-link-error] button').click()");

  // No folder in the link: nothing is guessed, the folder list opens, and even autostart waits.
  openDeepLink('seshboard://new-session?prompt=Wait%20for%20me&autostart=1');
  if (!(await waitInPage(win, `${composer}?.value === 'Wait for me' && document.querySelector('[data-folder-select]')?.dataset.value === '' && document.querySelector('[data-folder-select]')?.getAttribute('aria-expanded') === 'true'`, 5_000))) {
    return 'a link without a folder did not leave it empty with the folder list open';
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (!(await js("!!document.querySelector('[data-new-session-view]') && !document.querySelector('[data-current-session]') && document.querySelector('[data-link-notice]')?.innerText.includes('Read it')"))) return 'autostart without a folder did not wait';
  await shot(win, 'deep-link-no-folder.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });

  // No checkout of this repository: the folder is left empty, with the reason.
  openDeepLink('seshboard://new-session?repo=switchboard-smoke/no-such-repo&prompt=hi');
  if (!(await waitInPage(win, "document.querySelector('[data-folder-select]')?.dataset.value === '' && document.querySelector('[data-route-hint]')?.innerText.includes('switchboard-smoke/no-such-repo')", 20_000))) {
    return `a repo without a checkout did not leave the folder empty (${String(await js("document.querySelector('[data-route-hint]')?.innerText"))})`;
  }
  // Empty the prompt the links left: kept, it would count as an unsent New session prompt 2s later, and put a pen on
  // the + button that later steps check for.
  await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
  if (!(await waitInPage(win, `${composer}?.value === ''`, 2_000))) return 'could not empty the prompt the links left';

  if (!smokeSessionId) return 'ok: filled in folder and prompt, refused a bad link, empty folder for an unknown repo (no session to open)';
  openDeepLink(`seshboard://session/${smokeSessionId}`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000))) return 'a session link did not open the session';
  return 'ok: filled in folder and prompt with a notice, sent nothing, refused a bad link and an unknown project, no folder (even with autostart) opens the list and waits, empty folder for an unknown repo, opened a session';
}

/**
 * The `seshboard .` shell command. Settings › General › Terminal installs the commands and removes them again (in the
 * throwaway profile: a scripted run never writes /usr/local/bin or the PATH). Then a folder on the command line, as the
 * Windows and Linux commands pass it, opens New session there, and one that isn't a folder says so. Nothing is sent.
 */
async function runShellCommandStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const dir = join(app.getPath('userData'), 'shell-command');

  await click('[data-open-settings]');
  await click('[data-settings-section="general"]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"general\"] [data-shell-command=\"missing\"] [data-shell-command-action=\"install\"]')", 5_000))) {
    return `Settings › General showed no Install for the shell command (${String(await js("document.querySelector('[data-shell-command]')?.dataset.shellCommand"))})`;
  }
  await click('[data-shell-command-action="install"]');
  if (!(await waitInPage(win, "document.querySelector('[data-shell-command=\"installed\"] [data-shell-command-action=\"remove\"]')", 5_000))) {
    return `Install did not install the shell command (${String(await js("document.querySelector('[data-shell-command-error]')?.innerText ?? document.querySelector('[data-shell-command]')?.dataset.shellCommand"))})`;
  }
  const files = SHELL_COMMAND_NAMES.map((name) => join(dir, process.platform === 'win32' ? `${name}.cmd` : name));
  if (!files.every((file) => existsSync(file) && readFileSync(file, 'utf8').includes('New session'))) return `the commands are not all in ${dir}`;
  await shot(win, 'shell-command.png');
  await click('[data-shell-command-action="remove"]');
  if (!(await waitInPage(win, "document.querySelector('[data-shell-command=\"missing\"]')", 5_000)) || files.some((file) => existsSync(file))) return 'Remove left the shell command in place';
  await click('[data-close-settings]');

  // What the Windows and Linux commands run: the executable with the folder, relative to where the command ran.
  const argv = (...args: string[]) => [...process.argv.slice(0, process.defaultApp ? 2 : 1), ...args];
  const folder = homedir();
  openFolderArgument(argv(basename(folder)), join(folder, '..'));
  if (!(await waitInPage(win, `document.querySelector('[data-new-session-view] [data-folder-select]')?.dataset.value === ${JSON.stringify(folder)}`, 5_000))) {
    return `a folder argument did not open New session in it (${String(await js("document.querySelector('[data-folder-select]')?.dataset.value"))})`;
  }
  openFolderArgument(argv('switchboard-smoke-no-such-folder'), folder);
  if (!(await waitInPage(win, "document.querySelector('[data-link-error]')?.innerText.includes('is not a folder')", 3_000))) return 'a missing folder showed no error';
  await click('[data-link-error] button');
  if (!(await js("!!document.querySelector('[data-new-session-view]') && !document.querySelector('[data-current-session]')"))) return 'the folder argument left New session (was something started?)';
  return 'ok: installed the three commands and removed them, a folder argument opened New session there, a missing one said so';
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
 * Saved prompts, in a sandbox (a throwaway git repository, opened in New session with a link): a prompt for
 * every project with a pull request and a text blank, made in Settings › Prompts; picked with / in New session, both
 * blanks filled (the pull request typed, as without gh), more context under it, and sent to the queue (never to
 * Claude), where it is the filled text without braces; then moved to just for you, shared (in the sandbox's
 * .seshboard.json) and back to every project (out of that file), and deleted.
 */
async function runSavedPromptsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const one = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const click = (selector: string) => js(`${one(selector)}?.click()`);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-smoke-prompts-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=smoke@example.com', '-c', 'user.name=Smoke', 'commit', '-q', '--allow-empty', '-m', 'initial');
  git('branch', 'feat/smoke-prompts');
  const sharedFile = join(dir, '.seshboard.json');
  const readShared = () => (existsSync(sharedFile) ? (JSON.parse(readFileSync(sharedFile, 'utf8')) as { prompts?: Array<{ id: string; text: string }> }) : null);
  const id = 'smoke-fix-a-pull-request';
  const row = `[data-saved-prompt-row="${id}"]`;
  const box = '[data-new-session-view] [data-composer]';

  /** Closes what a failure left open, and removes the sandbox. */
  const cleanUp = async () => {
    if (await js("!!document.querySelector('[role=dialog], [role=menu]')")) pressKey(win, 'Escape');
    await click('[data-close-settings]');
    await click('[data-go-home]');
    // On Windows a folder can't be removed while a process still runs in it (Claude Code warmed up for New session's
    // folder): try for a while, then leave it in temp rather than fail the step.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      console.log(`[smoke] could not remove ${dir}: ${(error as Error).message}`);
    }
  };
  try {
    // New session on the sandbox, through a link (so it isn't remembered as New session's folder).
    openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(dir)}`);
    if (!(await waitInPage(win, `${one('[data-folder-select]')}?.dataset.value === ${JSON.stringify(dir)} && ${one(box)}`, 5_000))) return 'New session did not open on the sandbox';
    // Typed in once, so Settings knows the project "just for you" and "Share" mean.
    await js(`${one(box)}.focus()`);

    // 1. A prompt for every project, with a pull request and a text blank, from Settings › Prompts.
    await click('[data-open-settings]');
    if (!(await waitInPage(win, one('[data-settings-section="prompts"]'), 3_000))) return 'Settings has no Prompts page';
    await click('[data-settings-section="prompts"]');
    if (!(await waitInPage(win, one('[data-saved-prompts-new]'), 3_000))) return 'Settings › Prompts has no New prompt';
    await click('[data-saved-prompts-new]');
    if (!(await waitInPage(win, `${one('[data-prompt-editor-dialog]')} && ${one('[data-prompt-use-in="personal"]')}?.getAttribute('aria-checked') === 'true'`, 3_000))) return 'New prompt did not open with "just for you" picked';
    await setFieldValue(win, '[data-prompt-editor-name]', 'Smoke: fix a pull request');
    await click('[data-prompt-use-in="global"]');
    await js(`${one('[data-prompt-editor] [data-prompt-run]')}.focus()`);
    await win.webContents.insertText('Fix ');
    await click('[data-add-blank]');
    if (!(await waitInPage(win, one('[role=menu] [data-add-blank-type="pr"]'), 2_000))) return 'Add blank did not list Pull request';
    await click('[role=menu] [data-add-blank-type="pr"]');
    if (!(await waitInPage(win, `${one('[data-editor-blank="pr"]')} && document.activeElement === document.querySelectorAll('[data-prompt-editor] [data-prompt-run]')[1]`, 2_000))) return 'Add blank did not put a pull request blank in the text, with the caret after it';
    // Typing {{ opens the same list.
    await win.webContents.insertText(' because {{');
    if (!(await waitInPage(win, one('[role=menu] [data-add-blank-type="text"]'), 2_000))) return 'typing {{ did not open the Add blank list';
    await click('[role=menu] [data-add-blank-type="text"]');
    if (!(await waitInPage(win, one('[data-blank-form] [data-blank-form-name]'), 2_000))) return 'a text blank did not open its form';
    await setFieldValue(win, '[data-blank-form-name]', 'reason');
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `!${one('[data-blank-form]')} && ${one('[data-prompt-editor-preview]')}?.innerText === '2 blanks · pull request, text'`, 2_000))) return `the preview did not say 2 blanks (${String(await js(`${one('[data-prompt-editor-preview]')}?.innerText`))})`;
    await shot(win, 'saved-prompt-editor.png');
    await click('[data-prompt-editor-save]');
    if (!(await waitInPage(win, `!${one('[data-prompt-editor-dialog]')} && ${one(row)}?.dataset.savedPromptScope === 'global'`, 3_000))) return `the prompt was not listed under Every project (${String(await js(`${one('[data-prompt-editor-problem]')}?.innerText`))})`;
    await click('[data-close-settings]');

    // 2. Picked with / in New session's message box.
    if (!(await waitInPage(win, one(box), 3_000))) return 'New session did not come back after Settings';
    await setFieldValue(win, box, '');
    await js(`${one(box)}.focus()`);
    await win.webContents.insertText('/smoke');
    if (!(await waitInPage(win, `${one('[data-palette] [data-palette-heading]')}?.innerText.toLowerCase() === 'saved prompts' && ${one(`[data-palette] [data-saved-prompt-option="${id}"]`)}?.getAttribute('aria-selected') === 'true'`, 3_000))) return 'the / menu did not list the prompt first under Saved prompts';
    await shot(win, 'saved-prompt-slash.png');
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `${one('[data-saved-prompt-header]')} && document.querySelectorAll('[data-blank][data-blank-empty]').length === 2 && document.activeElement?.matches('[data-blank="pr"]')`, 3_000))) return 'picking it did not show its two empty blanks, with the focus on the first';
    if (!(await waitInPage(win, `${one('[data-blanks-left]')}?.innerText === '2 blanks left' && ${one(box)}.value === ''`, 2_000))) return 'the box did not say 2 blanks left';

    // Backspace in an empty blank takes it out; Clear takes the prompt out and keeps what was typed under it. Then picked again.
    pressKey(win, 'Tab');
    if (!(await waitInPage(win, `document.activeElement?.matches('[data-blank="reason"] input')`, 2_000))) return 'Tab did not go to the reason blank';
    pressKey(win, 'Backspace');
    if (!(await waitInPage(win, `!${one('[data-blank="reason"]')} && ${one('[data-blank="pr"]')} && ${one('[data-blanks-left]')}?.innerText === '1 blank left' && document.activeElement?.matches('[data-prompt-run]')`, 2_000))) return 'Backspace in the empty reason blank did not take it out, with the caret in the text';
    await js(`${one(box)}.focus()`);
    await win.webContents.insertText('Smoke kept text');
    await click('[data-saved-prompt-clear]');
    if (!(await waitInPage(win, `!${one('[data-saved-prompt-header]')} && ${one(box)}.value === 'Smoke kept text'`, 2_000))) return `Clear did not take the prompt out and keep the text under it (${String(await js(`${one(box)}.value`))})`;
    await setFieldValue(win, box, '');
    await js(`${one(box)}.focus()`);
    await win.webContents.insertText('/smoke');
    if (!(await waitInPage(win, one(`[data-palette] [data-saved-prompt-option="${id}"]`), 3_000))) return 'the / menu did not list the prompt again';
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `document.querySelectorAll('[data-blank][data-blank-empty]').length === 2 && document.activeElement?.matches('[data-blank="pr"]')`, 3_000))) return 'picking it again did not show its two empty blanks';

    // 3. Both filled: the pull request typed (gh lists none here), the reason typed in its chip, then more context.
    pressKey(win, '1');
    if (!(await waitInPage(win, `document.activeElement?.matches('[data-blank-popover] [data-blank-field]')`, 2_000))) return 'typing on the pull request blank did not open its field';
    await win.webContents.insertText('42');
    if (!(await waitInPage(win, one('[data-blank-popover] [data-blank-option="#142"]'), 3_000))) return 'a typed number was not offered';
    pressKey(win, 'Return');
    if (!(await waitInPage(win, `${one('[data-blank="pr"]')}?.getAttribute('aria-label') === 'Pull request: #142' && document.activeElement?.matches('[data-blank="reason"] input')`, 2_000))) return 'picking #142 did not fill the blank and move on to the next';
    await win.webContents.insertText('the tests fail on main');
    if (!(await waitInPage(win, `!${one('[data-blanks-left]')} && !document.querySelector('[data-blank-empty]')`, 2_000))) return 'the blanks still counted as empty';
    pressKey(win, 'Tab');
    if (!(await waitInPage(win, `document.activeElement === ${one(box)}`, 2_000))) return 'Tab after the last blank did not go to the text under the prompt';
    await win.webContents.insertText('Smoke context after the prompt.');
    await shot(win, 'saved-prompt-filled.png');

    // 4. Sent to the queue (Claude is never asked): the filled text, no braces, the context after a blank line.
    const expected = 'Fix #142 because the tests fail on main\n\nSmoke context after the prompt.';
    await click('[data-new-session-view] [data-start-menu]');
    if (!(await waitInPage(win, `${one('[role=menu] [data-queue-add]')} && !${one('[role=menu] [data-queue-add]')}.disabled`, 2_000))) return 'Add to queue was not offered';
    await click('[role=menu] [data-queue-add]');
    if (!(await waitInPage(win, `!${one('[data-saved-prompt-header]')} && [...document.querySelectorAll('[data-toast]')].some((t) => t.innerText.includes('Added to the queue'))`, 3_000))) return 'Add to queue did not take the filled prompt';
    const items = "[...document.querySelectorAll('[data-session-list] [data-queue-item]')].map((el) => el.dataset.queueItem)";
    const [item] = (await js(items)) as string[];
    if (!item) return 'the queue has no item';
    await click(`[data-session-list] [data-queue-item="${item}"]`);
    await waitInPage(win, `${one(box)}?.value.includes('#142')`, 3_000);
    const sent = (await js(`${one(box)}?.value ?? ''`)) as string;
    await click('[data-close-queued]');
    await js(`${one(`[data-session-list] [data-queue-item="${item}"]`)}?.focus()`);
    pressKey(win, 'Backspace');
    if (sent !== expected) return `the queued prompt was not the filled text: ${JSON.stringify(sent)}`;
    if (!(await waitInPage(win, `!${one(`[data-session-list] [data-queue-item="${item}"]`)}`, 3_000))) return 'the queued item was not removed';

    // 5. Moved: just for you, shared (in the sandbox's file), every project again (out of it). Then deleted.
    await click('[data-open-settings]');
    await click('[data-settings-section="prompts"]');
    if (!(await waitInPage(win, `${one(row)}?.innerText.includes('used 1×')`, 3_000))) return `sending did not count a use (${String(await js(`${one(row)}?.innerText`))})`;
    const moveTo = async (kind: 'personal' | 'shared' | 'global') => {
      await click(`${row} [data-saved-prompt-menu]`);
      if (!(await waitInPage(win, one(`[role=menu] [data-prompt-move="${kind}"]`), 2_000))) return false;
      await click(`[role=menu] [data-prompt-move="${kind}"]`);
      return waitInPage(win, `${one(row)}?.dataset.savedPromptScope === '${kind}'`, 3_000);
    };
    if (!(await moveTo('personal'))) return 'Use in › just for you did not move it to the sandbox';
    if (readShared()?.prompts?.length) return 'just for you wrote the shared file';
    if (!(await moveTo('shared'))) return 'Share with the project did not move it';
    if (!(await waitInPage(win, "!!document.querySelector('[data-prompt-share-toast=\"shared\"] [data-prompt-show-change]')", 2_000))) return 'sharing did not say to commit the file, with Show the change';
    await shot(win, 'saved-prompt-shared.png');
    const shared = readShared()?.prompts?.find((p) => p.id === id);
    if (shared?.text !== 'Fix {{pr:pr}} because {{reason}}') return `the sandbox's .seshboard.json did not have the prompt (${JSON.stringify(readShared())})`;
    if (!(await moveTo('global'))) return 'Use in › Every project did not move it back';
    if (readShared()?.prompts) return `making it global again left it in .seshboard.json (${JSON.stringify(readShared())})`;
    await click(`${row} [data-saved-prompt-menu]`);
    await click('[role=menu] [data-prompt-delete]');
    if (!(await waitInPage(win, `!${one(row)} && !!document.querySelector('[data-prompt-deleted-toast]')`, 3_000))) return 'Delete did not take it out, with Undo';
    await click('[data-close-settings]');
    // Its toasts (saved, queued, moved, shared, deleted) would cover what later steps click.
    // Not the update toasts, which stay until they're dealt with.
    const ours = '[data-toasts] [data-toast]:not([data-update-toast]):not([data-claude-update-toast])';
    const closeToasts = `document.querySelectorAll('${ours} [data-toast-close], ${ours} button[aria-label="Dismiss"]').forEach((b) => b.click())`;
    for (let i = 0; i < 5 && (await js(`!!document.querySelector('${ours}')`)); i++) {
      await js(closeToasts);
      await settle(win);
    }
    return 'ok: made in Settings › Prompts (Add blank and {{), picked first under Saved prompts in /, ⌫ took out an empty blank, Clear took the prompt out and kept the text under it, #142 typed and a reason filled, Tab to the context, queued as the filled text, used 1×, moved to just for you, shared (in .seshboard.json, with Show the change) and back (out of it), deleted';
  } finally {
    await cleanUp();
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
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-queue-')));
  const sidebarItems = "[...document.querySelectorAll('[data-session-list] [data-queue-item]')].map((el) => el.dataset.queueItem)";
  const started = "!!document.querySelector('[data-current-session]')";
  try {
    if (!(await js("!!document.querySelector('[data-sidebar-open]')"))) return 'the sidebar is not open';
    if ((await js(`${sidebarItems}.length`)) !== 0) return 'the throwaway profile already had a queue';
    const queuePrompt = async (prompt: string) => {
      openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(folder)}`);
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
 * Start by itself (#172), in the throwaway profile and against a temp folder: a stand-in session "works" there (the
 * engine's `smokeQueueHost`, as `SESHBOARD_STUB_QUEUE` allows), and Start after this one… on its row opens New session
 * with Wait for on it and Start by itself on. Queued, the row says "starts after". A clean finish starts it once and
 * takes it off the queue (the stub never sends the prompt to Claude); after an error a second item stays, ready, and
 * says why. Both notifications are recorded.
 */
/**
 * Pipelines (#179), with stand-in steps (`SESHBOARD_STUB_QUEUE`): nothing reaches Claude Code, no worktree is made
 * and no command runs. Runs Execute and validate from the smoke session through its ⋯ menu, checks the step tree and
 * that each step's first prompt links the right sessions, has Validate find changes (a round 2 starts after Execute's
 * turn), then pass, and checks the run is done.
 */
async function runPipelineStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const parent = smokeSessionId;
  const startsFile = join(app.getPath('userData'), 'smoke-pipeline-starts.jsonl');
  type Start = { kind: 'fresh' | 'fork' | 'send'; sessionId: string; text: string };
  const starts = (): Start[] => {
    try {
      return readFileSync(startsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Start);
    } catch {
      return [];
    }
  };
  const before = starts().length;
  const mine = () => starts().slice(before);
  const turn = (sessionId: string, reply: string) => engine.send({ type: 'smokePipelineTurn', sessionId, outcome: 'clean', reply });
  const links = (text: string, sessionId: string) => text.includes('```switchboard-session') && text.includes(`session: ${sessionId}`);
  // With a session, the step tree is in its view; from New session, in the run row's pane.
  const tree = parent ? "document.querySelector('[data-current-session] [data-pipeline-tree]')" : "document.querySelector('[data-run-row] [data-pipeline-tree]')";
  const view = (name: string) => `${tree}?.querySelector('[data-pipeline-step=${JSON.stringify(name)}][data-step-view]')?.dataset.stepView`;

  if (parent) {
    await js(`document.querySelector('[data-session-id="${parent}"]')?.click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-current-session]')?.dataset.currentSession === ${JSON.stringify(parent)}`, 5_000))) return 'the smoke session did not open';
    await js("document.querySelector('[data-current-session] [data-more-menu]').click()");
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-run-pipeline-menu]')", 3_000))) return 'the ⋯ menu has no Run pipeline ›';
  } else {
    // No session that is safe to use: New session in a throwaway repository, Run as › Execute and validate, a run row.
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-pipeline-')));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder });
    execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', 'commit', '-q', '--allow-empty', '-m', 'Start'], { cwd: folder });
    openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent('Smoke pipeline: add a usage cost toggle')}&cwd=${encodeURIComponent(folder)}`);
    const ready = `document.querySelector('[data-new-session-view] [data-composer]')?.value === 'Smoke pipeline: add a usage cost toggle' && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)} && !document.querySelector('[data-new-session-view] [data-start-menu]')?.disabled`;
    if (!(await waitInPage(win, `${ready} && !!document.querySelector('[data-new-session-view] [data-run-as]')`, 8_000))) return 'New session did not open on the throwaway repository with Run as';
    await js("document.querySelector('[data-new-session-view] [data-run-as]').click()");
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-run-as-option=\"builtin-execute-validate\"]')", 3_000))) return 'Run as did not list Execute and validate';
    await js("document.querySelector('[role=menu] [data-run-as-option=\"builtin-execute-validate\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-new-session-view] [data-composer-submit]')?.dataset.startMain === 'pipeline'", 2_000))) return 'Start did not turn into Run pipeline';
  }
  if (parent) {
    await js("document.querySelector('[role=menu] [data-run-pipeline-menu]').click()");
    const item = "document.querySelector('[role=menu] [data-run-pipeline=\"builtin-execute-validate\"]')";
    if (!(await waitInPage(win, `!!${item}`, 1_500))) {
      await js("document.querySelector('[role=menu] [data-run-pipeline-menu]').focus()");
      pressKey(win, 'Right');
      if (!(await waitInPage(win, `!!${item}`, 2_000))) return 'Run pipeline › did not list Execute and validate';
    }
    await js(`${item}.click()`);
  } else await js("document.querySelector('[data-new-session-view] [data-composer-submit]').click()");
  if (!(await waitInPage(win, `!!${tree} && ${view('Execute')} === 'working'`, 10_000))) return 'the step tree did not show Execute working';
  if (!(await until(() => mine().filter((s) => s.kind === 'fresh').length === 1, 5_000))) return 'Execute did not start';
  const execute = mine()[0]!;
  if (parent ? !links(execute.text, parent) : !execute.text.includes('The task, from @')) return parent ? 'Execute’s first prompt did not link the parent' : 'Execute’s first prompt did not bring the run row’s task';
  await shot(win, 'pipeline-parent.png');

  turn(execute.sessionId, 'Done. The tests pass.');
  if (!(await until(() => mine().filter((s) => s.kind === 'fresh').length === 2, 5_000))) return 'Validate did not start after Execute';
  const validate = mine().filter((s) => s.kind === 'fresh')[1]!;
  if (!links(validate.text, execute.sessionId) || (parent && !links(validate.text, parent))) return 'Validate’s first prompt did not link Execute and the parent';
  if (!(await waitInPage(win, `${view('Execute')} === 'done' && ${view('Validate')} === 'working'`, 5_000))) return 'the step tree did not show Execute done and Validate working';

  turn(validate.sessionId, 'Mostly right.\n\nVerdict: changes needed\n- LimitsCard still shows the cost.');
  if (!(await until(() => mine().some((s) => s.kind === 'send' && s.sessionId === execute.sessionId && s.text.includes('found changes needed') && links(s.text, validate.sessionId)), 5_000))) return 'the changes did not go to Execute with @Validate linked';
  turn(execute.sessionId, 'Fixed.');
  if (!(await until(() => mine().filter((s) => s.kind === 'fresh').length === 3, 5_000))) return 'Validate round 2 did not start after Execute’s turn';
  const round2 = mine().filter((s) => s.kind === 'fresh')[2]!;
  if (!(await waitInPage(win, `(${tree}?.innerText ?? '').includes('round 2')`, 5_000))) return 'the step tree did not show round 2';

  // Still changes needed after the last round: the run stops and offers Another round, which sends them back once more.
  turn(round2.sessionId, 'Verdict: changes needed\n- The tooltip still shows the cost.');
  const another = `${tree}?.querySelector('[data-run-another-round]')`;
  if (!(await waitInPage(win, `!!${another} && !${another}.disabled`, 5_000))) return 'the step tree did not offer Another round after the last round';
  const sends = mine().filter((s) => s.kind === 'send' && s.sessionId === execute.sessionId).length;
  await js(`${another}.click()`);
  if (!(await until(() => mine().filter((s) => s.kind === 'send' && s.sessionId === execute.sessionId).length === sends + 1, 5_000))) return 'Another round did not send the changes to Execute';
  turn(execute.sessionId, 'Fixed the tooltip.');
  if (!(await until(() => mine().filter((s) => s.kind === 'fresh').length === 4, 5_000))) return 'Validate round 3 did not start after Execute’s turn';
  const round3 = mine().filter((s) => s.kind === 'fresh')[3]!;
  if (!(await waitInPage(win, `(${tree}?.innerText ?? '').includes('round 3')`, 5_000))) return 'the step tree did not show round 3';

  turn(round3.sessionId, 'All good.\n\nVerdict: pass');
  if (!(await waitInPage(win, `${tree}?.dataset.runStatus === 'done'`, 5_000))) return `the run did not end done (${String(await js(`${tree}?.dataset.runStatus`))})`;
  return `ok: ran Execute and validate ${parent ? 'from the ⋯ menu; Execute linked the parent' : 'from New session as a run row; Execute got the task'}, Validate linked Execute; changes went back with @Validate, round 2 ran after Execute’s turn, Another round sent them back once more, and a pass in round 3 ended the run`;
}

/**
 * Run as in New session (#179), with stand-in steps (`SESHBOARD_STUB_QUEUE`): in a throwaway repository, Run as ›
 * Execute and validate turns Start into Run pipeline with two pills under the box, ⌘↵ runs it as a run row with Execute
 * working, and New session is back on One session. The run is stopped at the end, so later steps see none going.
 */
async function runRunAsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-run-as-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder });
  execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', 'commit', '-q', '--allow-empty', '-m', 'Start'], { cwd: folder });
  const view = '[data-new-session-view]';
  const chip = `document.querySelector('${view} [data-run-as]')`;
  const submit = `document.querySelector('${view} [data-composer-submit]')`;
  const opened = (prompt: string) =>
    `${chip} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)} && document.querySelector('${view} [data-composer]')?.value === ${JSON.stringify(prompt)}`;
  openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(folder)}`);
  if (!(await waitInPage(win, opened(''), 8_000))) return 'New session did not open on the throwaway repository with the Run as chip';
  if ((await js(`${chip}.dataset.runAs`)) !== 'one') return `Run as did not start on One session (${String(await js(`${chip}.dataset.runAs`))})`;
  await js(`${chip}.click()`);
  const option = "document.querySelector('[role=menu] [data-run-as-option=\"builtin-execute-validate\"]')";
  if (!(await waitInPage(win, `!!${option} && document.querySelector('[role=menu] [data-run-as-option=\"one\"]')?.getAttribute('aria-checked') === 'true'`, 3_000))) return 'the Run as menu did not list One session (checked) and Execute and validate';
  await js(`${option}.click()`);
  if (!(await waitInPage(win, `${chip}?.dataset.runAs === 'builtin-execute-validate' && ${submit}?.dataset.startMain === 'pipeline' && ${submit}.innerText.includes('Run pipeline')`, 2_000))) return 'Start did not turn into Run pipeline';
  if (await js(`!!document.querySelector('${view} [data-run-as-steps]')`)) return 'the steps line showed with an empty box';
  const task = 'Smoke run as: add a usage cost toggle';
  await setFieldValue(win, `${view} [data-composer]`, task);
  if (!(await waitInPage(win, `document.querySelector('${view} [data-run-as-steps]')?.querySelectorAll('[data-run-as-step]').length === 2`, 2_000))) return 'the steps line did not show two pills';
  await shot(win, 'run-as.png');
  await js(`document.querySelector('${view} [data-composer]').focus()`);
  pressKey(win, 'Return', ['meta']);
  const tree = "document.querySelector('[data-run-row] [data-pipeline-tree]')";
  if (!(await waitInPage(win, `${tree}?.querySelector('[data-pipeline-step="Execute"][data-step-view]')?.dataset.stepView === 'working'`, 10_000))) return 'the run row did not open with Execute working';
  const runId = (await js(`${tree}.closest('[data-run-row]')?.dataset.runRow ?? ''`)) as string;
  await js(`${tree}.querySelector('[data-run-stop-button]')?.click()`);
  if (!(await waitInPage(win, `${tree}?.dataset.runStatus === 'stopped'`, 5_000))) return 'Stop the run did not stop it';
  openDeepLink(`seshboard://new-session?cwd=${encodeURIComponent(folder)}`);
  if (!(await waitInPage(win, opened(''), 8_000))) return 'New session did not open again';
  if ((await js(`${chip}.dataset.runAs`)) !== 'one') return 'Run as did not go back to One session after the run started';
  return `ok: Run as › Execute and validate made Start Run pipeline with two pills, ⌘↵ ran it as a run row${runId ? ` (${runId})` : ''} with Execute working, and New session is back on One session`;
}

/**
 * A pipeline run as one tree (#179), with stand-in steps: Execute and validate from New session in a throwaway
 * repository, Execute's turn ends so Validate starts, Stop the run, then Archive with its 2 steps from the run row's
 * menu moves the run row and both steps to Archived. Delete… takes it out again, so later steps never see it.
 */
async function runArchiveRunStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const startsFile = join(app.getPath('userData'), 'smoke-pipeline-starts.jsonl');
  const starts = (): Array<{ kind: string; sessionId: string }> => {
    try {
      return readFileSync(startsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { kind: string; sessionId: string });
    } catch {
      return [];
    }
  };
  const before = starts().length;
  const fresh = () => starts().slice(before).filter((s) => s.kind === 'fresh');
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-archive-run-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder });
  execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', 'commit', '-q', '--allow-empty', '-m', 'Start'], { cwd: folder });
  const view = '[data-new-session-view]';
  const task = 'Smoke archive run: tidy the settings page';
  openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent(task)}&cwd=${encodeURIComponent(folder)}`);
  if (!(await waitInPage(win, `!!document.querySelector('${view} [data-run-as]') && document.querySelector('${view} [data-composer]')?.value === ${JSON.stringify(task)}`, 8_000))) return 'New session did not open on the throwaway repository';
  await js(`document.querySelector('${view} [data-run-as]').click()`);
  if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-run-as-option=\"builtin-execute-validate\"]')", 3_000))) return 'Run as did not list Execute and validate';
  await js("document.querySelector('[role=menu] [data-run-as-option=\"builtin-execute-validate\"]').click()");
  if (!(await waitInPage(win, `document.querySelector('${view} [data-composer-submit]')?.dataset.startMain === 'pipeline'`, 2_000))) return 'Start did not turn into Run pipeline';
  await js(`document.querySelector('${view} [data-composer-submit]').click()`);
  const tree = "document.querySelector('[data-run-row] [data-pipeline-tree]')";
  if (!(await until(() => fresh().length === 1, 8_000))) return 'Execute did not start';
  const runId = (await waitInPage(win, `${tree}?.dataset.pipelineTree`, 5_000)) ? ((await js(`${tree}.dataset.pipelineTree`)) as string) : '';
  if (!runId) return 'the run row did not open';
  await engine.send({ type: 'smokePipelineTurn', sessionId: fresh()[0]!.sessionId, outcome: 'clean', reply: 'Done. The tests pass.' });
  if (!(await until(() => fresh().length === 2, 5_000))) return 'Validate did not start after Execute';
  const [execute, validate] = fresh().map((s) => s.sessionId);
  await js(`${tree}.querySelector('[data-run-stop-button]')?.click()`);
  if (!(await waitInPage(win, `${tree}?.dataset.runStatus === 'stopped'`, 5_000))) return 'Stop the run did not stop it';

  const row = `document.querySelector('[data-session-list] [data-session-id="${runId}"]')`;
  const openMenu = async () => {
    await js(`(() => { const row = ${row}; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); })()`);
  };
  if (!(await waitInPage(win, `!!${row}`, 3_000))) return 'the run row is not in the sidebar';
  await openMenu();
  const archiveItem = "document.querySelector('[role=menu] [data-run-row-action=\"archive\"]')";
  if (!(await waitInPage(win, `${archiveItem}?.innerText.includes('Archive with its 2 steps')`, 2_000))) return `the run row menu has no Archive with its 2 steps (${String(await js("[...document.querySelectorAll('[role=menu] [role^=menuitem]')].map((b) => b.innerText).join(', ')"))})`;
  if (await js("!!document.querySelector('[role=menu] [data-rename-session]')")) return 'the run row menu offers Rename';
  await js(`${archiveItem}.click()`);
  // Archived, closed by default: open it to see the tree.
  const opened = !(await js("!!document.querySelector('[data-session-list] [data-archived-header]')"));
  if (opened) await js("document.querySelector('[data-archived-toggle]')?.click()");
  if (!(await waitInPage(win, `${row}?.dataset.archived === 'true'`, 5_000))) return 'the run row did not move to Archived';
  // Put away like any archived session: its pane closes.
  if (!(await waitInPage(win, "!document.querySelector('[data-run-row] [data-pipeline-tree]')", 2_000))) return 'the run row stayed open after Archive';
  await js(`${row}.dataset.treeParent === 'true' || ${row}.querySelector('[data-tree-toggle]')?.click()`);
  const stepArchived = (id: string) => `document.querySelector('[data-session-list] [data-session-id="${id}"]')?.dataset.archived === 'true'`;
  if (!(await waitInPage(win, `${stepArchived(execute!)} && ${stepArchived(validate!)}`, 3_000))) return 'Execute and Validate did not move to Archived under the run row';
  await shot(win, 'pipeline-archived.png');

  // Delete… takes the run out again (its stand-in steps with it), so later steps see none of it.
  await openMenu();
  if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-run-row-action=\"delete\"]')", 2_000))) return 'the run row menu has no Delete…';
  await js("document.querySelector('[role=menu] [data-run-row-action=\"delete\"]').click()");
  if (!(await waitInPage(win, "!!document.querySelector('[data-run-delete-confirm]') && !!document.querySelector('[data-run-delete-keep]')", 2_000))) return 'Delete… did not ask, with Keep the sub-sessions';
  const body = (await js("document.querySelector('[data-run-delete-confirm]').innerText")) as string;
  if (!body.includes('The run and its 2 sub-sessions go away from Seshboard')) return `Delete… did not say what goes (${body})`;
  await js("document.querySelector('[data-run-delete-confirm] [data-confirm]').click()");
  if (!(await waitInPage(win, `!${row}`, 5_000))) return 'Delete did not take the run row away';
  if (opened) await js("document.querySelector('[data-archived-toggle]')?.click()");
  return `ok: Stop the run, then Archive with its 2 steps moved ${runId} with Execute and Validate to Archived; Delete… asked (with Keep the sub-sessions) and took it away`;
}

/**
 * Settings › Pipelines (#179): the built-in Plan, execute, validate, push, with Validate open. Its Starts choice (Fresh,
 * Fork of Plan, Fork of Execute) stays one row high, above the Model row, rather than wrapping out of its control.
 */
async function runPipelineEditorStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // Narrow, where three choices side by side no longer fit the step card.
  const [width, height] = win.getSize();
  win.setSize(860, height!);
  try {
    return await pipelineEditorChecks(win, js);
  } finally {
    win.setSize(width!, height!);
  }
}

async function pipelineEditorChecks(win: BrowserWindow, js: (code: string) => Promise<unknown>): Promise<string> {
  await js("document.querySelector('[data-open-settings]')?.click()");
  if (!(await waitInPage(win, "!!document.querySelector('[data-settings]')", 3_000))) return 'settings did not open';
  await js("document.querySelector('[data-settings-section=\"pipelines\"]')?.click()");
  const row = "document.querySelector('[data-pipeline-row=\"builtin-plan-execute-validate-push\"]')";
  if (!(await waitInPage(win, `!!${row}`, 3_000))) return 'Settings › Pipelines did not list Plan, execute, validate, push';
  await js(`${row}.click()`);
  const card = "document.querySelector('[data-pipeline-step-card=\"Validate\"]')";
  if (!(await waitInPage(win, `!!${card}`, 3_000))) return 'the editor did not show Validate';
  await js(`${card}.dataset.open || ${card}.querySelector('[data-pipeline-step-toggle]').click()`);
  if (!(await waitInPage(win, `!!${card}?.querySelector('[data-pipeline-starts]') && !!${card}.querySelector('[data-pipeline-model]')`, 3_000))) return 'Validate did not open with Starts and Model';
  const box = (await js(`(() => { const s = ${card}.querySelector('[data-pipeline-starts]').getBoundingClientRect(); const m = ${card}.querySelector('[data-pipeline-model]').getBoundingClientRect(); const spill = Math.max(0, ...[...${card}.querySelector('[data-pipeline-starts]').querySelectorAll('*')].map((el) => el.getBoundingClientRect().bottom - s.bottom)); return { height: Math.round(s.height + spill), gap: Math.round(m.top - s.bottom - spill), text: ${card}.querySelector('[data-pipeline-starts]').innerText.replace(/\\s+/g, ' ') }; })()`)) as { height: number; gap: number; text: string };
  const overflow = (await js("(() => { const el = document.querySelector('[data-settings-page=pipelines]')?.parentElement; return el ? el.scrollWidth - el.clientWidth : 0; })()")) as number;
  await shot(win, 'pipeline-editor.png');
  pressKey(win, 'Escape');
  await waitInPage(win, "!document.querySelector('[data-settings]')", 2_000);
  if (box.height > 32) return `Starts is ${box.height}px high: its choices wrapped (${box.text})`;
  if (box.gap < 0) return `Starts runs into the Model row by ${-box.gap}px`;
  if (overflow > 1) return `the Pipelines page is ${overflow}px wider than Settings`;
  return `ok: in a narrow window the list sits above the editor, and Validate's Starts (${box.text}) is one row of ${box.height}px, above the Model row`;
}

/** A session that is compacting says so after you switch to another session and back (a stand-in the host list reports as compacting). */
async function runCompactingStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-compacting-')));
  const standIn = `smoke-compacting-${randomUUID()}`;
  const host = (state: 'running' | 'idle' | 'closed', compacting?: boolean) => engine.send({ type: 'smokeQueueHost', sessionId: standIn, cwd: folder, state, ...(compacting !== undefined ? { compacting } : {}) });
  const status = `document.querySelector('[data-current-session="${standIn}"] [data-streaming][data-compacting]')?.innerText ?? ''`;
  try {
    if (!smokeSessionId) return 'no session to switch to';
    host('running', true);
    if (!(await waitInPage(win, `!!document.querySelector('[data-session-list] [data-session-id="${standIn}"]')`, 5_000))) return 'the stand-in session did not show as working';
    await js(`document.querySelector('[data-session-list] [data-session-id="${standIn}"]').click()`);
    if (!(await waitInPage(win, `${status}.includes('Compacting')`, 5_000))) return 'the session did not say it is compacting';
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    if (!(await waitInPage(win, `!!document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000))) return 'did not switch to another session';
    await js(`document.querySelector('[data-session-list] [data-session-id="${standIn}"]').click()`);
    if (!(await waitInPage(win, `${status}.includes('Compacting')`, 5_000))) return 'after switching back, the session did not say it is compacting';
    await shot(win, 'compacting.png');
    host('running', false);
    if (!(await waitInPage(win, `!document.querySelector('[data-streaming][data-compacting]')`, 3_000))) return 'it kept saying it is compacting after the compact ended';
    return 'ok: a compacting session said Compacting the conversation, still did after switching to another session and back, and stopped when the compact ended';
  } finally {
    host('closed');
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A temp folder left behind is harmless.
    }
  }
}

/**
 * Keep awake until done (#241), on a stand-in session: the ⋯ menu turns it on and the pill above the message box
 * shows it, main holds sleep off while the session works, the pill turns it off, and once the session is done the flag
 * goes by itself (after the engine's short grace period with `SESHBOARD_STUB_QUEUE`).
 */
async function runKeepAwakeSessionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-keep-awake-')));
  const standIn = `smoke-keep-awake-${randomUUID()}`;
  const host = (state: 'running' | 'idle' | 'closed', outcome?: 'clean') => engine.send({ type: 'smokeQueueHost', sessionId: standIn, cwd: folder, state, ...(outcome ? { outcome } : {}) });
  const view = `[data-current-session="${standIn}"]`;
  const pill = `!!document.querySelector('${view} [data-keep-awake-pill]')`;
  /** The ⋯ menu's Keep awake until done, picked. */
  const pick = async (): Promise<string | null> => {
    await js(`document.querySelector('${view} [data-more-menu]')?.click()`);
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-keep-awake-session]:not([aria-disabled=true])')", 2_000))) return 'the ⋯ menu has no Keep awake until done to pick';
    await js("document.querySelector('[role=menu] [data-keep-awake-session]').click()");
    return null;
  };
  try {
    if (!smokeSessionId) return 'no session to switch back to';
    host('running');
    if (!(await waitInPage(win, `!!document.querySelector('[data-session-list] [data-session-id="${standIn}"]')`, 5_000))) return 'the stand-in session did not show as working';
    await js(`document.querySelector('[data-session-list] [data-session-id="${standIn}"]').click()`);
    if (!(await waitInPage(win, `!!document.querySelector('${view}')`, 5_000))) return 'the stand-in session did not open';
    const first = await pick();
    if (first) return first;
    if (!(await waitInPage(win, pill, 3_000))) return 'no Awake until done pill after turning it on';
    if (!(await until(() => sessionsAwake.active, 3_000))) return 'sleep was not held off while the session works';
    await shot(win, 'keep-awake-session.png');
    await js(`document.querySelector('${view} [data-keep-awake-pill]').click()`);
    if (!(await waitInPage(win, `!${pill}`, 3_000))) return 'the pill did not turn it off';
    if (!(await until(() => !sessionsAwake.active, 3_000))) return 'sleep stayed held off after turning it off';
    const again = await pick();
    if (again) return again;
    if (!(await until(() => sessionsAwake.active, 3_000))) return 'turning it on again did not hold sleep off';
    host('idle', 'clean');
    if (!(await until(() => !sessionsAwake.active, 5_000))) return 'sleep stayed held off after the session was done';
    if (!(await waitInPage(win, `!${pill}`, 3_000))) return 'the pill stayed after the session was done';
    return 'ok: the ⋯ menu turned Keep awake until done on, sleep was held off while the session worked, the pill turned it off, and it went by itself once the session was done';
  } finally {
    host('closed');
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A temp folder left behind is harmless.
    }
  }
}

async function runQueueAutoStartStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-autostart-')));
  const standIn = `smoke-autostart-${randomUUID()}`;
  const host = (state: 'running' | 'idle' | 'closed', outcome?: 'clean' | 'error') => engine.send({ type: 'smokeQueueHost', sessionId: standIn, cwd: folder, state, ...(outcome ? { outcome } : {}) });
  const sidebarItems = "[...document.querySelectorAll('[data-session-list] [data-queue-item]')].map((el) => el.dataset.queueItem)";
  const box = '[data-new-session-view] [data-composer]';
  const recorded = (kind: RecordedAlert['kind'], prompt: string) => recordedNotifications.filter((n) => n.kind === kind && n.title.includes(prompt)).length;
  /** Start after this one… on the stand-in's row, then Add to queue (the main part of Start, opened this way). */
  const queueAfter = async (prompt: string): Promise<string | null> => {
    const opened = await js(
      `(() => { const row = document.querySelector('[data-session-list] [data-session-id="${standIn}"]'); if (!row) return false; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 })); return true; })()`,
    );
    if (!opened) return 'the stand-in session has no row';
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-start-after]')", 2_000))) return 'the session menu has no Start after this one…';
    await js("document.querySelector('[role=menu] [data-start-after]').click()");
    const ready = `document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)} && document.querySelector('[data-queue-autostart-box]')?.getAttribute('aria-checked') === 'true' && !!document.querySelector('[data-queue-busy-line]')`;
    if (!(await waitInPage(win, ready, 5_000))) return 'Start after this one… did not open New session on the project with Start by itself on';
    if (!(await js("document.querySelector('[data-new-session-view] [data-composer-submit]')?.innerText.includes('Add to queue')"))) return 'Add to queue did not lead in New session';
    await setFieldValue(win, box, prompt);
    if (!(await waitInPage(win, `!document.querySelector('[data-new-session-view] [data-composer-submit]')?.disabled`, 2_000))) return 'Add to queue stayed disabled';
    await js("document.querySelector('[data-new-session-view] [data-composer-submit]').click()");
    const row = `[...document.querySelectorAll('[data-session-list] [data-queue-item]')].find((el) => el.getAttribute('aria-label')?.includes(${JSON.stringify(prompt)}))`;
    if (!(await waitInPage(win, `${row}?.closest('[data-queue-autostart]')?.dataset.queueState === 'waiting'`, 3_000))) return 'the queued item did not wait to start by itself';
    const label = (await js(`${row}.getAttribute('aria-label')`)) as string;
    if (!label.includes('Starts by itself')) return `its row did not say it starts by itself (${label})`;
    return null;
  };
  try {
    if (!(await js("!!document.querySelector('[data-sidebar-open]')"))) return 'the sidebar is not open';
    if ((await js(`${sidebarItems}.length`)) !== 0) return 'the throwaway profile already had a queue';
    host('running');
    if (!(await waitInPage(win, `!!document.querySelector('[data-session-list] [data-session-id="${standIn}"]')`, 5_000))) return 'the stand-in session did not show as working';

    // A clean finish: it starts once and leaves the queue.
    const first = 'Smoke autostart: run the tests';
    const failed = await queueAfter(first);
    if (failed) return failed;
    await shot(win, 'queue-autostart.png');
    host('idle', 'clean');
    if (!(await waitInPage(win, `${sidebarItems}.length === 0`, 5_000))) return 'the item did not start after a clean finish';
    if (!(await until(() => recorded('queue-started', first) === 1, 3_000))) return 'no "Started" notification';
    // Long enough for a second start to show: there must be none.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (recorded('queue-started', first) !== 1) return `it started ${recorded('queue-started', first)} times`;

    // An error: it doesn't start, stays in the queue, ready, and says why.
    host('running');
    const second = 'Smoke autostart: write the changelog';
    const failedAgain = await queueAfter(second);
    if (failedAgain) return failedAgain;
    host('idle', 'error');
    const row = `[...document.querySelectorAll('[data-session-list] [data-queue-item]')].find((el) => el.getAttribute('aria-label')?.includes(${JSON.stringify(second)}))`;
    if (!(await waitInPage(win, `${row}?.closest('[data-queue-state]')?.dataset.queueState === 'ready' && ${row}.closest('[data-queue-state]').innerText.includes('ended with an error')`, 5_000))) return 'after an error the item did not turn ready and say why';
    if (!(await until(() => recorded('queue-skipped', second) === 1, 3_000))) return 'no "didn\'t start" notification';
    if (recorded('queue-started', second) !== 0) return 'it started after an error';
    return 'ok: Start after this one… opened New session (Wait for set, Start by itself on, Add to queue first), the row said it starts by itself, a clean finish started it once and took it off the queue, an error left the next one ready with the reason, both notified';
  } finally {
    if (await js("!!document.querySelector('[data-new-session-view] [data-composer]')?.value")) await setFieldValue(win, box, '');
    for (let i = 0; i < 4 && (await js(`${sidebarItems}.length`)) > 0; i++) {
      await js("document.querySelector('[data-session-list] [data-queue-item]').focus()");
      pressKey(win, 'Backspace');
      await waitInPage(win, `${sidebarItems}.length < ${(await js(`${sidebarItems}.length`)) as number}`, 2_000);
    }
    host('closed');
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A temp folder left behind is harmless.
    }
  }
}

/**
 * Scheduled sessions (#173), in the throwaway profile: a demo prompt in New session goes through Start ▾ › Schedule…
 * (every day, a minute from now), and shows on Home. The engine's schedule clock (`smokeScheduleClock`, with
 * `SESHBOARD_STUB_QUEUE`, which also keeps the run from sending anything to Claude) moves on: the run is titled
 * "<name> · <day>", notified, and the row shows Last. Paused, a day later nothing runs. Delete, then Undo, puts it back;
 * it is deleted for good at the end.
 */
async function runSchedulesStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const name = 'Smoke schedule: review open pull requests';
  const prompt = "document.querySelector('[data-new-session-view] [data-composer]')";
  const rowOf = `[...document.querySelectorAll('[data-schedules-card] [data-schedule-row]')].find((el) => el.innerText.includes(${JSON.stringify(name)}))`;
  const started = () => recordedNotifications.filter((n) => n.kind === 'schedule-started' && n.title === `Scheduled: ${name} started`).length;
  const menu = async (item: string) => {
    await js(`${rowOf}?.querySelector('[data-schedule-more]')?.click()`);
    if (!(await waitInPage(win, `!!document.querySelector('[role=menu] ${item}')`, 2_000))) return false;
    await js(`document.querySelector('[role=menu] ${item}').click()`);
    return true;
  };
  const clock = (ms: number) => engine.send({ type: 'smokeScheduleClock', ms });
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-schedules-')));
  const goHome = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: [MOD_MODIFIER, 'shift'] });
    await waitInPage(win, "!!document.querySelector('[data-home], [data-onboarding]')", 3_000);
  };
  try {
    // A folder of its own, opened with a link, so the run finds it (and nothing real is touched).
    const text = `${name}\nList yesterday's open pull requests.`;
    openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent(text)}&cwd=${encodeURIComponent(folder)}`);
    if (!(await waitInPage(win, `${prompt}?.value === ${JSON.stringify(text)} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)}`, 5_000))) return 'New session did not open on the schedule\'s folder';
    await js("document.querySelector('[data-new-session-view] [data-start-menu]').click()");
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-schedule-add]')", 2_000))) return 'Start ▾ has no Schedule…';
    await js("document.querySelector('[role=menu] [data-schedule-add]').click()");
    if (!(await waitInPage(win, `document.querySelector('[data-schedule-dialog] [data-schedule-name]')?.value === ${JSON.stringify(name)}`, 3_000))) return 'Schedule… did not open the dialog with the name from the first line';
    await js("document.querySelector('[data-schedule-dialog] [data-schedule-repeat=\"daily\"]').click()");
    // Two minutes from now on the clock, so the real clock can't reach it during the step: the run is due once the
    // engine's clock has moved 150 seconds on, and still on time.
    const at = new Date(Date.now() + 120_000);
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    await setFieldValue(win, '[data-schedule-dialog] [data-schedule-time]', time);
    if (!(await waitInPage(win, `document.querySelector('[data-schedule-dialog] [data-schedule-describe]')?.innerText === 'Every day at ${time}' && document.querySelectorAll('[data-schedule-dialog] [data-schedule-next-runs] li').length === 3`, 2_000))) {
      return `the dialog did not say "Every day at ${time}" with three next runs`;
    }
    await shot(win, 'schedule-dialog.png');
    await js("document.querySelector('[data-schedule-dialog] [data-schedule-save]').click()");
    if (!(await waitInPage(win, `!document.querySelector('[data-schedule-dialog]') && ${prompt}?.value === '' && !!document.querySelector('[data-schedule-saved-toast]')`, 3_000))) return 'saving did not close the dialog, clear New session and say it is scheduled';

    await goHome();
    if (!(await waitInPage(win, `!!${rowOf}`, 5_000))) return 'the schedule did not show in the Schedules card on Home';
    const label = (await js(`${rowOf}.getAttribute('aria-label')`)) as string;
    if (!label.startsWith(`${name}, every day at ${time}, next `)) return `its row's label is "${label}"`;
    if (!(await js("!!document.querySelector('[data-schedules-platform]')"))) return 'no line under the card says when schedules run';

    clock(150_000);
    if (!(await until(() => started() === 1, 5_000))) return 'the run did not start after the clock moved on';
    const run = recordedScheduleRuns.find((r) => r.name === name && r.result === 'started');
    if (!run?.title || !/^Smoke schedule: review open pull requests · \w{3} \d{1,2} \w{3}$/.test(run.title)) return `the run was titled "${run?.title}"`;
    if (!(await waitInPage(win, `${rowOf}?.querySelector('[data-schedule-last]')?.innerText.startsWith('Last: ')`, 3_000))) return 'the row did not show Last';
    await shot(win, 'schedules-card.png');

    // Paused: a day later, nothing starts.
    if (!(await menu('[data-schedule-menu-pause="pause"]'))) return 'the row menu has no Pause';
    if (!(await waitInPage(win, `${rowOf}?.dataset.schedulePaused === 'true' && ${rowOf}.innerText.includes('Paused')`, 3_000))) return 'Pause did not dim the row and say Paused';
    clock(24 * 60 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (started() !== 1) return 'a paused schedule ran';

    // Delete, then Undo.
    if (!(await menu('[data-schedule-menu-delete]'))) return 'the row menu has no Delete';
    if (!(await waitInPage(win, `!${rowOf} && !!document.querySelector('[data-schedule-deleted-toast] [data-toast-undo]')`, 3_000))) return 'Delete did not remove the row with an Undo';
    await js("document.querySelector('[data-schedule-deleted-toast] [data-toast-undo]').click()");
    if (!(await waitInPage(win, `${rowOf}?.dataset.schedulePaused === 'true'`, 3_000))) return 'Undo did not put the schedule back as it was';
    return `ok: Schedule… opened the dialog (name from the first line, "Every day at ${time}", three next runs), the card listed it, the moved clock ran it once as "${run.title}" and the row showed Last; paused, nothing ran a day later; Delete and Undo put it back`;
  } finally {
    // Deleted for good (whatever the step got to), and New session left empty.
    await goHome();
    for (let i = 0; i < 2 && (await js(`!!${rowOf}`)); i++) {
      await menu('[data-schedule-menu-delete]');
      await waitInPage(win, `!${rowOf}`, 2_000);
    }
    if (await js(`!!${prompt}?.value`)) await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A temp folder left behind is harmless.
    }
  }
}

/**
 * Upcoming, in the throwaway profile against a temp folder: a queued prompt and a daily schedule made in New session,
 * then Upcoming from the sidebar with its three cards. The project filter keeps them; Skip this run dims the run and
 * says so, and Undo brings it back; Start now on the Queue card takes the item off the queue (the stub never sends
 * the prompt to Claude). The schedule is deleted again.
 */
async function runUpcomingStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-upcoming-')));
  const name = 'Smoke upcoming: standup summary';
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  const view = '[data-upcoming]';
  const queued = `[...document.querySelectorAll('${view} [data-upcoming-queue] [data-queue-item]')]`;
  const scheduleRow = `[...document.querySelectorAll('${view} [data-upcoming-schedule]')].find((el) => el.innerText.includes(${JSON.stringify(name)}))`;
  /**
   * The last run on screen of the smoke schedule that is still to come. Not the first: the schedules step moved the
   * engine's clock a day on, so to the engine today's run has already passed.
   */
  const laterRun = `[...document.querySelectorAll('${view} [data-upcoming-run]')].filter((el) => el.innerText.includes(${JSON.stringify(name)}) && el.dataset.upcomingRunState === 'next').pop()`;
  const fill = async (text: string) => {
    openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent(text)}&cwd=${encodeURIComponent(folder)}`);
    if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(text)} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)} && !document.querySelector('[data-new-session-view] [data-start-menu]')?.disabled`, 5_000))) return false;
    await js("document.querySelector('[data-new-session-view] [data-start-menu]').click()");
    return waitInPage(win, "!!document.querySelector('[role=menu] [data-queue-add]')", 2_000);
  };
  try {
    // A queued prompt and a schedule, in New session.
    if (!(await fill('Smoke upcoming: queued prompt'))) return 'New session did not open on the temp folder';
    await js("document.querySelector('[role=menu] [data-queue-add]').click()");
    if (!(await waitInPage(win, `${composer}?.value === ''`, 3_000))) return 'Add to queue did not take the prompt';
    if (!(await fill(`${name}\nWrite the standup summary.`))) return 'New session did not open again';
    await js("document.querySelector('[role=menu] [data-schedule-add]').click()");
    if (!(await waitInPage(win, `document.querySelector('[data-schedule-dialog] [data-schedule-name]')?.value === ${JSON.stringify(name)}`, 3_000))) return 'Schedule… did not open the dialog';
    await js(`document.querySelector('[data-schedule-dialog] [data-schedule-repeat="daily"]').click()`);
    // An hour ahead (or the next morning), so a run is still to come today or tomorrow.
    const at = new Date(Date.now() + 60 * 60_000);
    await setFieldValue(win, '[data-schedule-dialog] [data-schedule-time]', `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
    await js("document.querySelector('[data-schedule-dialog] [data-schedule-save]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-schedule-dialog]')", 3_000))) return 'saving the schedule did not close the dialog';

    // Upcoming from the sidebar (or the rail): its three cards.
    if (!(await js("!!document.querySelector('[data-upcoming-nav]')"))) return 'the sidebar has no Upcoming';
    await js("document.querySelector('[data-upcoming-nav]').click()");
    if (!(await waitInPage(win, `!!document.querySelector('${view}')`, 3_000))) return 'Upcoming did not open';
    if (!(await js("document.querySelector('[data-upcoming-nav]')?.getAttribute('aria-current') === 'page'"))) return 'the Upcoming row was not selected';
    if (!(await js(`document.querySelector('[data-upcoming-kind="all"]')?.getAttribute('aria-checked') === 'true'`))) await js(`document.querySelector('[data-upcoming-kind="all"]')?.click()`);
    if (!(await waitInPage(win, `!!document.querySelector('${view} [data-upcoming-queue]') && !!document.querySelector('${view} [data-upcoming-runs]') && !!document.querySelector('${view} [data-upcoming-schedules]')`, 3_000))) return 'Upcoming did not show the Queue, Scheduled runs and Schedules cards';
    if (!(await waitInPage(win, `${queued}.length === 1 && !!${scheduleRow} && !!${laterRun}`, 5_000))) return 'Upcoming did not list the queued prompt, the schedule and its next run';
    await shot(win, 'upcoming.png');

    // The project filter: the temp folder's project keeps both.
    // Compared in JavaScript, not in a selector: a Windows path's backslashes are escapes in CSS.
    const pick = `[...document.querySelectorAll('[role=menu] [data-upcoming-project]')].find((el) => el.dataset.upcomingProject === ${JSON.stringify(folder)})`;
    await js("document.querySelector('[data-upcoming-project-chip]').click()");
    if (!(await waitInPage(win, `!!${pick}`, 2_000))) return 'the project filter did not offer the temp folder';
    await js(`${pick}.click()`);
    if (!(await waitInPage(win, `document.querySelector('[data-upcoming-project-chip]')?.innerText.includes(${JSON.stringify(basename(folder))}) && ${queued}.length === 1 && !!${scheduleRow}`, 3_000))) return 'filtering by the project lost its items';

    // Skip this run, then Undo: the run comes back.
    const runId = (await js(`${laterRun}.dataset.upcomingRun`)) as string;
    const run = `document.querySelector('[data-upcoming-run=${JSON.stringify(runId)}]')`;
    await js(`${run}.querySelector('[data-upcoming-skip]').click()`);
    if (!(await waitInPage(win, `${run}?.dataset.upcomingRunState === 'skipped-by-you' && ${run}.innerText.includes('Skipped by you') && !!document.querySelector('[data-run-skipped-toast] [data-toast-undo]')`, 3_000))) return 'Skip this run did not mark the run Skipped by you with an Undo';
    await js("document.querySelector('[data-run-skipped-toast] [data-toast-undo]').click()");
    if (!(await waitInPage(win, `${run}?.dataset.upcomingRunState === 'next'`, 3_000))) return 'Undo did not bring the run back';

    // Start now on the Queue card: the item leaves the queue.
    const itemId = (await js(`${queued}[0].dataset.queueItem`)) as string;
    await js(`document.querySelector('${view} [data-queue-start="${itemId}"]').click()`);
    if (!(await waitInPage(win, `!document.querySelector('[data-queue-item="${itemId}"]')`, 5_000))) return 'Start now did not take the item off the queue';
    return 'ok: Upcoming from the sidebar showed the queue, the scheduled runs and the schedules; the project filter kept them; Skip this run and Undo; Start now took the item off the queue';
  } finally {
    // Back to all projects, the schedule and any queued item gone, New session empty, the session later steps use.
    if (!(await js("!!document.querySelector('[data-upcoming]')"))) await js("document.querySelector('[data-upcoming-nav]')?.click()");
    await waitInPage(win, "!!document.querySelector('[data-upcoming]')", 2_000);
    if (await js("!!document.querySelector('[data-upcoming-project-chip]')")) {
      await js("document.querySelector('[data-upcoming-project-chip]').click()");
      if (await waitInPage(win, `!!document.querySelector('[role=menu] [data-upcoming-project="all"]')`, 2_000)) await js(`document.querySelector('[role=menu] [data-upcoming-project="all"]').click()`);
    }
    for (let i = 0; i < 2 && (await js(`!!${scheduleRow}`)); i++) {
      await js(`${scheduleRow}.querySelector('[data-schedule-more]').click()`);
      if (await waitInPage(win, "!!document.querySelector('[role=menu] [data-schedule-menu-delete]')", 2_000)) await js("document.querySelector('[role=menu] [data-schedule-menu-delete]').click()");
      await waitInPage(win, `!${scheduleRow}`, 2_000);
    }
    for (let i = 0; i < 3 && (await js(`${queued}.filter((el) => el.innerText.includes('Smoke upcoming')).length`)) > 0; i++) {
      await js(`${queued}.find((el) => el.innerText.includes('Smoke upcoming')).focus()`);
      pressKey(win, 'Backspace');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (await js(`!!${composer}?.value`)) await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A temp folder left behind is harmless.
    }
  }
}

/**
 * Event triggers (#180), in the throwaway profile, against a temp folder and the smoke's fake gh, whose repository is
 * the file FAKE_GH_TRIGGERS names (tests/fixtures/fake-gh-triggers.cjs): nothing reaches GitHub. A prompt in New
 * session goes through Start ▾ › Start when… to an issues trigger on the `seshboard` label with state labels on. Its first
 * check starts nothing. A new labelled issue and the engine's moved clock (`smokeScheduleClock`) start one session with
 * the filled prompt (the stub records it, with `SESHBOARD_STUB_QUEUE`, and never sends it to Claude), and the fake
 * saw `--add-label "seshboard: working" --remove-label seshboard`. Paused, a new issue starts nothing. The trigger and the
 * project are removed again.
 */
async function runTriggersStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const stateFile = process.env.FAKE_GH_TRIGGERS;
  // Windows can't start the fake gh script without a shell (see scripts/smoke.ts): the real gh would answer.
  if (!stateFile) return 'ok: skipped, no fake gh on this platform';
  const callsFile = `${stateFile}.calls`;
  const startsFile = join(app.getPath('userData'), 'smoke-trigger-starts.jsonl');
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-triggers-')));
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  const issue = (number: number, title: string) => ({ number, title, body: `The text of issue ${number}.`, labels: ['seshboard'], association: 'OWNER', updatedAt: new Date().toISOString() });
  type State = { issues: ReturnType<typeof issue>[] } & Record<string, unknown>;
  const read = () => JSON.parse(readFileSync(stateFile, 'utf8')) as State;
  const write = (state: State) => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const starts = () => (existsSync(startsFile) ? readFileSync(startsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { title: string; prompt: string }) : []);
  const calls = () => (existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);
  const card = `document.querySelector('[data-triggers-tab=${JSON.stringify(folder)}] [data-trigger-card]')`;
  const clock = (ms: number) => engine.send({ type: 'smokeScheduleClock', ms });
  const startsBefore = starts().length;
  write({ repo: 'smoke-owner/trigger-repo', login: 'smoke-user', labels: ['seshboard'], issues: [issue(1, 'Already there before the trigger')] });
  writeFileSync(callsFile, '');
  try {
    const prompt = 'Smoke trigger: work on {{event.title}} ({{event.url}}).';
    openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(folder)}`);
    if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(prompt)} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)} && !document.querySelector('[data-new-session-view] [data-start-menu]')?.disabled`, 5_000))) return 'New session did not open on the temp folder';
    await js("document.querySelector('[data-new-session-view] [data-start-menu]').click()");
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-trigger-add]')", 2_000))) return 'Start ▾ has no Start when…';
    await js("document.querySelector('[role=menu] [data-trigger-add]').click()");
    const editor = '[data-trigger-editor="new"]';
    if (!(await waitInPage(win, `!!document.querySelector('${editor} [data-trigger-prompt]') && document.querySelector('${editor} [data-trigger-prompt]').value === ${JSON.stringify(prompt)}`, 3_000))) return 'Start when… did not open the editor with the prompt';
    if (!(await js(`document.querySelector('${editor} [role=radiogroup] [data-trigger-source="issues"]')?.getAttribute('aria-checked') === 'true' && document.querySelector('${editor} [data-trigger-source="command"]')?.getAttribute('aria-disabled') === 'true'`))) return 'the source cards are not a radio group with Issues for you picked and A command disabled';
    if (!(await js(`[...document.querySelectorAll('${editor} [data-trigger-field="title"], ${editor} [data-trigger-field="url"]')].length === 2`))) return 'the prompt shows no event field chips';
    // The summary says what Issues for you does, with the login the fake gh gives; the temp folder isn't a git
    // repository, so New session hands over the project folder, one at a time.
    const summary = `document.querySelector('${editor} [data-trigger-summary]')?.innerText`;
    const expected = "When an issue with the seshboard label is assigned to @smoke-user, start a session in the project's folder. One at a time.";
    if (!(await waitInPage(win, `${summary} === ${JSON.stringify(expected)}`, 3_000))) return `the summary said "${await js(summary)}"`;
    if (!(await js(`['when', 'which', 'github', 'start', 'limits'].every((s) => !!document.querySelector('${editor} [data-trigger-section="' + s + '"]')) && !!document.querySelector('${editor} [data-trigger-section="github"][data-folded]') && !document.querySelector('${editor} [data-trigger-section="limits"][data-folded]') && !!document.querySelector('${editor} [data-trigger-folder-note]')`))) return 'the editor does not show its five sections, with GitHub folded and Limits open on the folder reason';
    await js(`document.querySelector('${editor} [data-trigger-which="label"]').click()`);
    if (!(await waitInPage(win, `document.querySelector('${editor} [data-trigger-label]')?.value === 'seshboard' && !document.querySelector('${editor} [data-trigger-assignee]') && document.querySelector('${editor} [data-trigger-collaborators]')?.getAttribute('aria-checked') === 'true' && ${summary}?.startsWith('When an issue gets the seshboard label, ')`, 2_000))) return 'With a label did not keep the seshboard label and Only from collaborators, hide Assigned to and update the summary';
    // What happens on GitHub? opens with Change, and state labels go on.
    const change = `document.querySelector('${editor} [data-trigger-section-change="github"]')`;
    if (!(await js(`${change}?.getAttribute('aria-expanded') === 'false' && !!document.getElementById(${change}.getAttribute('aria-controls'))`))) return "GitHub's Change has no aria-expanded or aria-controls";
    await js(`${change}.click()`);
    if (!(await waitInPage(win, `!document.querySelector('${editor} [data-trigger-section="github"][data-folded]') && document.querySelector('${editor} [data-trigger-state-labels]')?.getAttribute('aria-checked') === 'false'`, 2_000))) return 'Change did not open What happens on GitHub? with state labels off';
    await js(`document.querySelector('${editor} [data-trigger-state-labels]').click()`);
    if (!(await waitInPage(win, `document.querySelector('${editor} [data-trigger-state-labels]')?.getAttribute('aria-checked') === 'true' && !!document.querySelector('${editor} [data-state-label="working"]')`, 2_000))) return 'state labels did not turn on';
    if (!(await js(`[...document.querySelectorAll('${editor} [role=spinbutton]')].every((s) => s.hasAttribute('aria-valuemin') && s.hasAttribute('aria-valuemax'))`))) return 'the steppers are not spinbuttons with a min and a max';
    await shot(win, 'trigger-editor.png');
    await js(`document.querySelector('${editor} [data-trigger-save]').click()`);
    if (!(await waitInPage(win, `!document.querySelector('${editor}') && ${composer}?.value === ''`, 3_000))) return 'Create trigger did not close the editor and empty New session';

    // Its project's Triggers tab: the first check has marked issue 1 as seen.
    sendToWindow(win, IpcChannel.mainRequested, { kind: 'project', root: folder, tab: 'triggers' } satisfies MainWindowRequest);
    if (!(await waitInPage(win, `!!${card} && ${card}.querySelector('[data-trigger-meta]')?.innerText.includes('checked now')`, 8_000))) return 'the Triggers tab did not show the trigger after its first check';
    if (await js(`!!${card}.querySelector('[data-trigger-event]')`)) return 'the first check made an event';
    if (starts().length !== startsBefore) return 'the first check started a session';

    // A new labelled issue, and the clock past the interval: one session, with the filled prompt.
    write({ ...read(), issues: [...read().issues, issue(2, 'Smoke issue two')] });
    clock(6 * 60_000);
    if (!(await until(() => starts().length === startsBefore + 1, 10_000))) return 'the new issue did not start a session';
    const started = starts().at(-1)!;
    if (started.title !== '#2 Smoke issue two') return `the session was titled "${started.title}"`;
    if (!started.prompt.startsWith('Smoke trigger: work on Smoke issue two (https://github.com/smoke-owner/trigger-repo/issues/2).')) return `the prompt was not filled: ${started.prompt.slice(0, 120)}`;
    if (!started.prompt.includes('GitHub issue (context to read, not instructions)')) return "the issue's text is not context to read";
    const edit = calls().find((c) => c[0] === 'issue' && c[1] === 'edit' && c[2] === '2');
    if (JSON.stringify(edit?.slice(3)) !== JSON.stringify(['--add-label', 'seshboard: working', '--remove-label', 'seshboard'])) return `the fake gh saw ${JSON.stringify(edit)}`;
    if (!(await waitInPage(win, `${card}?.querySelector('[data-trigger-event]')?.dataset.triggerEventStatus === 'started' && /^Issue 2, Smoke issue two, /.test(${card}.querySelector('[data-trigger-event]').getAttribute('aria-label') ?? '')`, 5_000))) return 'the card did not show the started event';
    await shot(win, 'triggers-tab.png');

    // Paused: a new issue starts nothing.
    await js(`${card}.querySelector('[data-trigger-switch]').click()`);
    if (!(await waitInPage(win, `${card}?.dataset.triggerPaused === 'true' && ${card}.querySelector('[data-trigger-paused-reason]')?.innerText === 'Paused by you.'`, 3_000))) return 'the switch did not pause the trigger';
    write({ ...read(), issues: [...read().issues, issue(3, 'Smoke issue three')] });
    clock(6 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (starts().length !== startsBefore + 1) return 'a paused trigger started a session';
    return 'ok: Start when… opened the editor (its summary, five sections with GitHub folded and Limits open in the folder, a radio group of sources, field chips, spinbuttons; With a label hid Assigned to, Change opened GitHub for state labels), the first check started nothing, a new labelled issue started "#2 Smoke issue two" with the filled prompt and switchboard: working in one edit, paused it started nothing';
  } finally {
    // The trigger and the project go again, and the fake's repository with them.
    if (await js(`!!${card}`)) {
      await js(`${card}.querySelector('[data-trigger-more]').click()`);
      if (await waitInPage(win, "!!document.querySelector('[role=menu] [data-trigger-menu-delete]')", 2_000)) await js("document.querySelector('[role=menu] [data-trigger-menu-delete]').click()");
      await waitInPage(win, `!${card}`, 3_000);
    }
    await removeProjectInProjects(win, folder);
    rmSync(stateFile, { force: true });
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A temp folder left behind is harmless.
    }
  }
}

/**
 * A trigger that starts a pipeline (#185), in the throwaway profile, against a throwaway repository and the smoke's fake
 * gh. New session with Run as on Execute and validate, then Start ▾ › Start when…: the editor opens on A pipeline with
 * that pipeline picked, and Run without stopping for me is turned on. Its first check starts nothing; a new labelled issue starts one run (its stand-in first step gets
 * the filled task and the issue as context), whose run row in the sidebar has the bolt and whose event on the card is
 * started. The run, the trigger and the project are removed again.
 */
async function runTriggerPipelineStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const stateFile = process.env.FAKE_GH_TRIGGERS;
  // Windows can't start the fake gh script without a shell (see scripts/smoke.ts): the real gh would answer.
  if (!stateFile) return 'ok: skipped, no fake gh on this platform';
  const startsFile = join(app.getPath('userData'), 'smoke-pipeline-starts.jsonl');
  const starts = (): Array<{ kind: string; sessionId: string; text: string }> => {
    try {
      return readFileSync(startsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { kind: string; sessionId: string; text: string });
    } catch {
      return [];
    }
  };
  const before = starts().length;
  const fresh = () => starts().slice(before).filter((s) => s.kind === 'fresh');
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-trigger-pipeline-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder });
  execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', 'commit', '-q', '--allow-empty', '-m', 'Start'], { cwd: folder });
  const issue = (number: number, title: string) => ({ number, title, body: `The text of issue ${number}.`, labels: ['seshboard'], association: 'OWNER', updatedAt: new Date().toISOString() });
  type State = { issues: ReturnType<typeof issue>[] } & Record<string, unknown>;
  const read = () => JSON.parse(readFileSync(stateFile, 'utf8')) as State;
  const write = (state: State) => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const view = '[data-new-session-view]';
  const card = `document.querySelector('[data-triggers-tab=${JSON.stringify(folder)}] [data-trigger-card]')`;
  const runRow = "[...document.querySelectorAll('[data-session-list] [data-session-id^=\"run-\"]')].find((row) => row.querySelector('[data-row-triggered]'))";
  write({ repo: 'smoke-owner/trigger-repo', login: 'smoke-user', labels: ['seshboard'], issues: [issue(1, 'Already there before the trigger')] });
  try {
    const task = 'Smoke pipeline trigger: {{event.title}} ({{event.url}}).';
    openDeepLink(`seshboard://new-session?prompt=${encodeURIComponent(task)}&cwd=${encodeURIComponent(folder)}`);
    if (!(await waitInPage(win, `!!document.querySelector('${view} [data-run-as]') && document.querySelector('${view} [data-composer]')?.value === ${JSON.stringify(task)}`, 8_000))) return 'New session did not open on the throwaway repository';
    await js(`document.querySelector('${view} [data-run-as]').click()`);
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-run-as-option=\"builtin-execute-validate\"]')", 3_000))) return 'Run as did not list Execute and validate';
    await js("document.querySelector('[role=menu] [data-run-as-option=\"builtin-execute-validate\"]').click()");
    if (!(await waitInPage(win, `document.querySelector('${view} [data-composer-submit]')?.dataset.startMain === 'pipeline'`, 2_000))) return 'Start did not turn into Run pipeline';
    await js(`document.querySelector('${view} [data-start-menu]').click()`);
    if (!(await waitInPage(win, "!!document.querySelector('[role=menu] [data-trigger-add]')", 2_000))) return 'Start ▾ has no Start when… with a pipeline picked';
    await js("document.querySelector('[role=menu] [data-trigger-add]').click()");
    const editor = '[data-trigger-editor="new"]';
    if (!(await waitInPage(win, `document.querySelector('${editor} [data-trigger-starts="pipeline"]')?.getAttribute('aria-checked') === 'true' && document.querySelector('${editor} [data-trigger-pipeline-pick]')?.dataset.value === 'builtin-execute-validate'`, 3_000))) return 'Start when… did not open the editor on A pipeline with Execute and validate';
    if (await js(`!!document.querySelector('${editor} [data-trigger-model]') || !!document.querySelector('${editor} [data-trigger-workspace]')`)) return 'the editor still offers a model or a workspace for a pipeline';
    if (!(await js(`document.querySelector('${editor} [data-trigger-unattended]')?.getAttribute('aria-checked') === 'false' && document.querySelector('${editor} [data-trigger-auto-push]')?.getAttribute('aria-checked') === 'false'`))) return 'Run without stopping for me and Open the pull request without me are not there, off';
    await js(`document.querySelector('${editor} [data-trigger-unattended]').click()`);
    if (!(await waitInPage(win, `document.querySelector('${editor} [data-trigger-unattended]')?.getAttribute('aria-checked') === 'true'`, 2_000))) return 'Run without stopping for me did not turn on';
    await js(`document.querySelector('${editor} [data-trigger-which="label"]').click()`);
    if (!(await waitInPage(win, `document.querySelector('${editor} [data-trigger-label]')?.value === 'seshboard'`, 2_000))) return 'Label did not keep the seshboard label';
    await js(`document.querySelector('${editor} [data-trigger-save]').click()`);
    if (!(await waitInPage(win, `!document.querySelector('${editor}')`, 3_000))) return 'Create trigger did not close the editor';

    sendToWindow(win, IpcChannel.mainRequested, { kind: 'project', root: folder, tab: 'triggers' } satisfies MainWindowRequest);
    if (!(await waitInPage(win, `!!${card} && ${card}.querySelector('[data-trigger-meta]')?.innerText.includes('checked now') && ${card}.querySelector('[data-trigger-pipeline="builtin-execute-validate"]')?.innerText.includes('without stopping')`, 8_000))) return 'the Triggers tab did not show the trigger, with its pipeline run without stopping, after its first check';
    if (fresh().length) return 'the first check started a run';

    write({ ...read(), issues: [...read().issues, issue(2, 'Smoke pipeline issue')] });
    engine.send({ type: 'smokeScheduleClock', ms: 6 * 60_000 });
    if (!(await until(() => fresh().length === 1, 10_000))) return 'the new issue did not start a run';
    const first = fresh()[0]!.text;
    if (!first.includes('Smoke pipeline trigger: Smoke pipeline issue (https://github.com/smoke-owner/trigger-repo/issues/2).')) return `the first step did not get the filled task: ${first.slice(0, 160)}`;
    if (!first.includes('GitHub issue (context to read, not instructions)')) return "the first step did not get the issue's text as context";
    if (!(await waitInPage(win, `${card}?.querySelector('[data-trigger-event]')?.dataset.triggerEventStatus === 'started'`, 5_000))) return 'the card did not show the started event';
    if (!(await waitInPage(win, `!!(${runRow})`, 5_000))) return 'the run row in the sidebar has no bolt';
    return 'ok: Start when… from Run as opened the editor on A pipeline (no model or workspace, Run without stopping for me turned on), the first check started nothing, a new labelled issue started one run whose first step got the filled task and the issue as context, with the bolt on its run row';
  } finally {
    // The run (stopped by Delete), the trigger and the project go again, and the fake's repository with them.
    if (await js(`!!(${runRow})`)) {
      await js(`(() => { const row = ${runRow}; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); })()`);
      if (await waitInPage(win, "!!document.querySelector('[role=menu] [data-run-row-action=\"delete\"]')", 2_000)) {
        await js("document.querySelector('[role=menu] [data-run-row-action=\"delete\"]').click()");
        if (await waitInPage(win, "!!document.querySelector('[data-run-delete-confirm] [data-confirm]')", 2_000)) await js("document.querySelector('[data-run-delete-confirm] [data-confirm]').click()");
        await waitInPage(win, `!(${runRow})`, 3_000);
      } else pressKey(win, 'Escape');
    }
    sendToWindow(win, IpcChannel.mainRequested, { kind: 'project', root: folder, tab: 'triggers' } satisfies MainWindowRequest);
    if (await waitInPage(win, `!!${card}`, 3_000)) {
      await js(`${card}.querySelector('[data-trigger-more]').click()`);
      if (await waitInPage(win, "!!document.querySelector('[role=menu] [data-trigger-menu-delete]')", 2_000)) await js("document.querySelector('[role=menu] [data-trigger-menu-delete]').click()");
      await waitInPage(win, `!${card}`, 3_000);
    }
    await removeProjectInProjects(win, folder);
    rmSync(stateFile, { force: true });
    await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
    await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
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
  // Earlier starts closed (unit-tested with DEFAULT_SECTIONS), but opening a session in it opens it, and earlier steps
  // (search, the palette) open real sessions, so here it may legitimately be open.
  const group = (await js("['today', 'yesterday', 'pinned', 'working'].find((g) => document.querySelector(`[data-section-toggle=\"${g}\"][data-open=\"true\"]`)) ?? null")) as string | null;
  if (!group) return `ok: no open section to collapse (Earlier ${earlier === 'none' ? 'not shown' : 'closed'})`;
  const toggle = `document.querySelector('[data-section-toggle="${group}"]')`;
  const rowsUnder = `(() => { const rows = [...document.querySelectorAll('[data-session-list] [data-list-row]')]; const at = rows.findIndex((r) => r.querySelector('[data-section-toggle="${group}"]')); const out = []; for (const r of rows.slice(at + 1)) { if (r.querySelector('[data-section-toggle], [data-session-group], [data-archived-toggle]')) break; const s = r.querySelector('[data-session-id]'); if (s) out.push(s.dataset.sessionId); } return out; })()`;
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
  return `ok: closed ${group} (${before} ${before === 1 ? 'row' : 'rows'} hidden, header "${header}"${summary ? `, summary "${summary}"` : ''}), ← → on the header, Earlier ${earlier === 'none' ? 'not shown' : earlier === 'true' ? 'open' : 'closed'}`;
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
    if (process.env.SESHBOARD_GH && mode !== 'open-page') return `Star on GitHub would ${mode} with a gh that can't reach GitHub`;
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
  const landed = `!!${header} && !${dock} && ${header}.style.transform === '' && ![...document.querySelectorAll('[data-session-list] [data-list-row].opacity-0')].length`;
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
      // A pixel of rounding (Windows at a fractional scale) is not a scroll.
      return { outside: !l.contains(d), below: dr.top >= lr.bottom - 1, fits: content <= l.clientHeight, scrolls: l.scrollHeight > l.clientHeight + 1, content, scrollHeight: l.scrollHeight, clientHeight: l.clientHeight, dockTop: dr.top, listBottom: lr.bottom, dpr: devicePixelRatio };
    })()`)) as { outside: boolean; below: boolean; fits: boolean; scrolls: boolean; content: number; scrollHeight: number; clientHeight: number; dockTop: number; listBottom: number; dpr: number };
    if (!docked.outside || !docked.below) return `the closed Archived header is not docked under the list (${JSON.stringify(docked)})`;
    if (docked.fits && docked.scrolls) {
      // Seen only on Windows runners (#240): say what reaches below the rows (an element, a ::before/::after, a
      // transform beyond the row's own place, or a row's content taller than the row), so the report names it.
      const below = (await js(`(() => {
        const l = ${list}, inner = l.firstElementChild, top = inner.getBoundingClientRect().top, limit = inner.offsetHeight;
        const name = (el) => el.tagName.toLowerCase() + Object.keys(el.dataset).map((k) => '[' + k + ']').join('') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 6).join('.') : '');
        const found = [];
        for (const el of l.querySelectorAll('*')) {
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el), row = el.closest('[data-list-row]');
          if (r.bottom - top > limit + 0.5) found.push(name(el) + ' to ' + Math.round(r.bottom - top) + (cs.transform !== 'none' ? ' ' + cs.transform : '') + (row && row !== el ? ' in row ' + row.getAttribute('data-list-row') : ''));
          for (const p of ['::before', '::after']) {
            const s = getComputedStyle(el, p);
            if (s.content !== 'none' && s.content !== 'normal' && r.bottom - top + Math.max(0, parseFloat(s.height) || 0) > limit + 0.5) found.push(name(el) + p + ' ' + s.position + ' ' + s.height + ' bottom ' + s.bottom);
          }
        }
        return { limit, rows: l.querySelectorAll('[data-list-row]').length, found: found.slice(0, 12) };
      })()`)) as { limit: number; rows: number; found: string[] };
      await shot(win, 'archived-dock-scrolls.png');
      return `a list that fits still scrolls (${JSON.stringify(docked)}; below the rows: ${JSON.stringify(below)})`;
    }
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
      const item = ${header}.closest('[data-list-row]'), at = Number(item.getAttribute('data-list-row'));
      const prev = [...document.querySelectorAll('[data-session-list] [data-list-row]')].find((r) => Number(r.getAttribute('data-list-row')) === at - 1);
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
    if (!(await waitInPage(win, `!!${header} && !${dock} && ${header}.style.transform === '' && ![...document.querySelectorAll('[data-session-list] [data-list-row].opacity-0')].length`, 2_000))) return 'Archived did not open on the short list';
    const placed = (await js(`(() => {
      const item = ${header}.closest('[data-list-row]'), at = Number(item.getAttribute('data-list-row'));
      const prev = [...document.querySelectorAll('[data-session-list] [data-list-row]')].find((r) => Number(r.getAttribute('data-list-row')) === at - 1);
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
/** Settings › Usage: Show estimated cost and Currency are saved, and Open usage opens the Usage view. */
async function runUsageSettingsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const before = { showCost: preferences.get().showCost, costCurrency: preferences.get().costCurrency };
  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await js("document.querySelector('[data-open-settings]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"usage\"]')", 3_000))) return 'Settings has no Usage section';
  await js("document.querySelector('[data-settings-section=\"usage\"]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"usage\"] [data-show-cost]')", 2_000))) return 'the Usage page did not open';
  const missing = (await js("['[data-settings-open-usage]', '[data-show-cost]', '[data-cost-currency]'].filter((s) => !document.querySelector(s))")) as string[];
  if (missing.length > 0) return `missing: ${missing.join(', ')}`;
  await js("document.querySelector('[data-show-cost]').click()");
  if (!(await until(() => preferences.get().showCost === !before.showCost, 2_000))) return 'Show estimated cost was not saved';
  if (!(await waitInPage(win, `document.querySelector('[data-cost-currency]').disabled === ${before.showCost}`, 2_000))) return 'Currency does not follow Show estimated cost';
  await js("document.querySelector('[data-show-cost]').click()");
  updatePreferences({ costCurrency: before.costCurrency === 'EUR' ? 'GBP' : 'EUR' });
  const picked = preferences.get().costCurrency;
  if (!(await waitInPage(win, `document.querySelector('[data-cost-currency]').innerText.includes(${JSON.stringify(picked)})`, 2_000))) return `Currency does not show ${picked}`;
  updatePreferences({ costCurrency: before.costCurrency });
  // Large context: its four rows, and Warn when quitting saves (and is put back).
  const large = (await js("['[data-large-context-enabled]', '[data-large-context-percent]', '[data-large-context-notify]', '[data-large-context-quit]'].filter((s) => !document.querySelector(s))")) as string[];
  if (large.length > 0) return `Large context is missing: ${large.join(', ')}`;
  const warning = preferences.get().contextWarning;
  if (!(await waitInPage(win, `document.querySelector('[data-large-context-percent]').innerText.includes('${warning.percent}%')`, 2_000))) return `Large from does not show ${warning.percent}%`;
  await js("document.querySelector('[data-large-context-quit]').click()");
  if (!(await until(() => preferences.get().contextWarning.onQuit === !warning.onQuit, 2_000))) return 'Warn when quitting was not saved';
  await js("document.querySelector('[data-large-context-quit]').click()");
  if (!(await until(() => preferences.get().contextWarning.onQuit === warning.onQuit, 2_000))) return 'Warn when quitting did not go back';
  await shot(win, 'settings-usage.png');
  await js("document.querySelector('[data-settings-open-usage]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-usage-view]') && !document.querySelector('[data-settings]')", 3_000))) return 'Open usage did not open the Usage view';
  // The Tokens tab shows the period's cost while the estimate is on (the transcripts are real, so the amount isn't checked).
  await js("document.querySelector('[data-usage-tab=\"tokens\"]')?.click()");
  if (preferences.get().showCost && !(await waitInPage(win, "document.querySelector('[data-usage-tile=\"cost\"]')?.innerText.includes('≈')", 10_000))) return 'the Tokens tab shows no Cost (est.) tile';
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-usage-view]')", 3_000))) return 'Esc did not leave the Usage view';
  return `ok: cost estimate ${preferences.get().showCost ? 'on' : 'off'}, ${preferences.get().costCurrency}`;
}

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

/**
 * The catch-up on the smoke session, made from its transcript with the stubbed summary (no model is called): the
 * palette's Catch up on this session opens the banner over the conversation; Space opens Details and Esc closes Details,
 * then folds the banner into the strip, and Space opens it again; a key pressed in the message box stays there; the
 * sidebar's Quickest to unblock groups the sessions. Read-only: nothing is committed, archived, marked read or sent.
 */
async function runCatchUpStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const has = (selector: string) => js(`!!document.querySelector(${JSON.stringify(selector)})`) as Promise<boolean>;
  if (!smokeSessionId) return 'failed: no smoke session was opened';
  const view = `[data-current-session="${smokeSessionId}"]`;
  const banner = `${view} [data-catchup-banner]`;
  const strip = `${view} [data-catchup-strip]`;
  const blur = () => js('document.activeElement?.blur?.(); true');
  const transcriptShown = `getComputedStyle(document.querySelector('${view} [data-transcript]')).display !== 'none'`;
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  if (!(await waitInPage(win, `document.querySelector('${view} [data-transcript-item]')`, 5_000))) return 'failed: the smoke session did not open';

  if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return '⌘K did not open the commands';
  await setFieldValue(win, '[data-palette-input]', 'Catch up on this session');
  if (!(await waitInPage(win, "document.querySelector('[data-palette-command=\"build-catch-up\"]')", 3_000))) {
    await closePalette(win);
    // A catch-up made earlier in the run (or one the session already had) shows its strip instead.
    if (!(await has(strip))) return 'the palette did not offer Catch up on this session';
    await js(`document.querySelector('${strip} [data-catchup-show]').click()`);
  } else await js("document.querySelector('[data-palette-command=\"build-catch-up\"]').click()");
  if (!(await waitInPage(win, `document.querySelector('${banner}')`, 15_000))) {
    const toast = (await js("document.querySelector('[data-toast]')?.innerText ?? ''")) as string;
    if (/no finished turn/i.test(toast)) return 'ok: skipped, the smoke session has no finished turn to catch up on';
    return `the catch-up banner did not open${toast ? ` (${toast.replace(/\s+/g, ' ')})` : ''}`;
  }
  if (!(await has(`${banner} [data-catchup-primary]`))) return 'the banner has no primary action';
  if (!(await waitInPage(win, transcriptShown, 2_000))) return 'the banner hid the conversation';
  await shot(win, 'catch-up-banner.png');
  const need = await js(`document.querySelector('${banner}').dataset.catchupNeed`);

  await blur();
  // Esc closes the nearest thing first: the Changes panel (an earlier step may have left it open), then the banner.
  const changesOpen = await has('[data-changes-panel]');
  if (changesOpen) {
    pressKey(win, 'Escape');
    if (!(await waitInPage(win, `!document.querySelector('[data-changes-panel]') && document.querySelector('${banner}')`, 3_000))) return 'Esc did not close the Changes panel before the banner';
  }
  // The banner shows with its Details open; Space closes and opens them.
  const details = `document.querySelector('${banner} [data-catchup-details]')`;
  if (!(await waitInPage(win, details, 3_000))) return 'the banner did not show with its Details open';
  pressKey(win, 'Space');
  if (!(await waitInPage(win, `!${details}`, 3_000))) return 'Space did not close the banner’s Details';
  pressKey(win, 'Space');
  if (!(await waitInPage(win, details, 3_000))) return 'Space did not open the banner’s Details again';
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, `document.querySelector('${banner}') && !${details}`, 3_000))) return 'Esc did not close Details first';
  pressKey(win, 'Escape');
  if (!(await waitInPage(win, `document.querySelector('${strip}') && !document.querySelector('${banner}')`, 3_000))) return 'Esc did not fold the banner into the strip';
  pressKey(win, 'Space');
  if (!(await waitInPage(win, `document.querySelector('${banner}')`, 3_000))) return 'Space did not open the banner again';
  if (!(await waitInPage(win, details, 3_000))) return 'the banner came back without its Details';

  // In the message box, keys are the message box's: Esc there leaves the banner alone.
  await js(`document.querySelector('${view} [data-composer]')?.focus(); true`);
  pressKey(win, 'Escape');
  // A fixed wait, only to show that nothing happened.
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!(await has(banner))) return 'Esc in the message box folded the banner';
  await blur();

  await js("document.querySelector('[data-sort-quick]')?.click()");
  const grouped = await waitInPage(win, "document.querySelector('[data-session-group=\"review\"], [data-session-group=\"read\"], [data-session-group=\"still-working\"]') && !document.querySelector('[data-session-group=\"today\"], [data-session-group=\"pinned\"], [data-queue-header]')", 3_000);
  if (grouped) await shot(win, 'sidebar-quickest.png');
  await js("document.querySelector('[data-sort-recent]')?.click()");
  if (!grouped) return 'Quickest to unblock did not regroup the sidebar';
  if (!(await waitInPage(win, "!document.querySelector('[data-session-group=\"read\"], [data-session-group=\"still-working\"]')", 3_000))) return 'Recent did not come back';
  return `ok: banner (needs ${need}) over the conversation, ${changesOpen ? 'Esc closed the Changes panel first, then ' : ''}Details open at first, Space closed and opened them, Esc closed Details then folded the banner, Space opened it again with Details, Esc in the message box left it, Quickest to unblock regrouped the sidebar`;
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
 * and Enter run Toggle changes (and again, to put it back), which outside git isn't offered.
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
  // Outside git the session has no Changes panel, so the palette doesn't offer Toggle changes.
  const onGit = await has('[data-current-session] [data-toggle-changes]');
  const firstMatch = "document.querySelector('[data-command-palette] [data-palette-command]')?.dataset.paletteCommand ?? null";
  const runCommand = async (text: string) => {
    if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return null;
    await setFieldValue(win, '[data-palette-input]', text);
    // The palette reads the checkout's git state when it opens: on git, wait for the command to be offered.
    if (onGit) await waitInPage(win, `${firstMatch} === 'toggle-changes'`, 3_000);
    else await settle(win);
    const first = await js(firstMatch);
    if (first === 'toggle-changes') pressKey(win, 'Return');
    else await closePalette(win);
    await waitInPage(win, "!document.querySelector('[data-command-palette]')", 2_000);
    return first;
  };
  const first = await runCommand('tog chan');
  if (onGit && first !== 'toggle-changes') return `"tog chan" ranked ${String(first)} first`;
  if (!onGit && first === 'toggle-changes') return 'Toggle changes was offered outside git';
  if (onGit && !(await waitInPage(win, before ? "!document.querySelector('[data-changes-panel]')" : "!!document.querySelector('[data-changes-panel]')", 2_000))) return 'Toggle changes did nothing';
  if (onGit) await runCommand('tog chan');
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
  return `ok: ⌘K and ⌘⇧P open the commands with "This session" first, ⌘P lists sessions, ">" and ⌫ switch mode, ${onGit ? '"tog chan" ran Toggle changes' : 'no Toggle changes outside git'}, nothing for a session at Home`;
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

/**
 * More terminal tabs than Chromium keeps WebGL contexts for (16), then each tab in turn: only the one on screen draws with
 * WebGL (`data-renderer`), the hidden ones gave their context back, so the one you switch to still gets a fast renderer.
 * Skipped where this window has no WebGL2 at all. Opens plain shells in the session's folder and closes them again.
 */
async function runTerminalRendererStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await js("!!document.createElement('canvas').getContext('webgl2')"))) return 'ok: skipped, this window has no WebGL2';
  const tabs = "document.querySelectorAll('[data-terminal-panel] [role=tab]')";
  const visible = "document.querySelector('[data-terminal-panel] [role=tabpanel]:not(.hidden) [data-terminal]')";
  const webglCount = "document.querySelectorAll('[data-terminal-panel] [data-terminal][data-renderer=webgl]').length";
  const wanted = 18;
  let baseline = -1;
  try {
    if (!(await js("!!document.querySelector('[data-terminal-panel]')"))) await js("document.querySelector('[data-toggle-terminal]')?.click()");
    if (!(await waitInPage(win, `document.querySelector('[data-terminal-panel] [data-terminal] textarea')`, 5_000))) return 'failed: the panel did not open with a terminal';
    baseline = (await js(`${tabs}.length`)) as number;
    for (let count = baseline; count < wanted; count++) {
      await js("document.querySelector('[data-terminal-panel] [data-new-terminal]').click()");
      if (!(await waitInPage(win, `${tabs}.length === ${count + 1}`, 5_000))) return `failed: tab ${count + 1} did not open`;
    }
    // The newest tab is selected; each tab in turn must be drawn by WebGL while it shows, and be the only one that is.
    const check = async (index: number) => {
      await js(`${tabs}[${index}].click()`);
      if (!(await waitInPage(win, `${visible}?.dataset.renderer === 'webgl' && ${webglCount} === 1`, 5_000))) {
        return `failed: tab ${index + 1} of ${wanted} shows with the "${String(await js(`${visible}?.dataset.renderer`))}" renderer, and ${String(await js(webglCount))} terminals use WebGL`;
      }
      return null;
    };
    for (const index of [wanted - 1, 0, 8, wanted - 1, 0]) {
      const problem = await check(index);
      if (problem) return problem;
    }
    return `ok: ${wanted} tabs, and each one on screen drew with WebGL while the others held no context`;
  } finally {
    // Close the tabs this step opened, back to what was there (closing the last one hides the panel).
    for (let count = (await js(`${tabs}.length`)) as number; baseline >= 0 && count > baseline; count--) {
      await js("document.querySelector('[data-terminal-panel] [role=tab][aria-selected=true] + [data-terminal-tab-close]')?.click()");
      await waitInPage(win, `${tabs}.length < ${count}`, 3_000);
    }
    // Leave the next steps a closed panel.
    await js("document.querySelector('[data-terminal-panel]') && document.querySelector('[data-toggle-terminal]')?.click()");
  }
}

/**
 * Letters keep their normal spacing in a terminal drawn as DOM text (#201). The tab runs without WebGL, prints a
 * line, hides behind another tab while the zoom changes (xterm sets its rows' spacing up again then, and every
 * letter measures 0px while hidden), and shows again: its rows' spacing and the line's width must fit its cells.
 */
async function runTerminalLetterSpacingStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const tabs = "document.querySelectorAll('[data-terminal-panel] [role=tab]')";
  const zoom = win.webContents.getZoomFactor();
  let baseline = -1;
  try {
    if (!(await js("!!document.querySelector('[data-terminal-panel]')"))) await js("document.querySelector('[data-toggle-terminal]')?.click()");
    if (!(await waitInPage(win, `document.querySelector('[data-terminal-panel] [data-terminal] textarea')`, 5_000))) return 'failed: the panel did not open with a terminal';
    baseline = (await js(`${tabs}.length`)) as number;
    // Without WebGL2 the terminal draws its rows as DOM text, the renderer that spaces each letter.
    await js("window.__smokeGetContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' ? null : window.__smokeGetContext.call(this, kind, ...rest); }; true");
    await js("document.querySelector('[data-terminal-panel] [data-new-terminal]').click()");
    if (!(await waitInPage(win, `${tabs}.length === ${baseline + 1}`, 5_000))) return 'failed: the tab did not open';
    const host = "document.querySelector('[data-terminal-panel] [role=tabpanel]:not(.hidden) [data-terminal]')";
    if (!(await waitInPage(win, `${host}?.dataset.renderer === 'dom' && ${host}.querySelector('textarea')`, 5_000))) return `failed: the tab draws with "${String(await js(`${host}?.dataset.renderer`))}", not the DOM renderer`;
    const id = (await js(`${host}.dataset.terminal`)) as string;
    const terminal = `document.querySelector('[data-terminal=${JSON.stringify(id)}]')`;
    await js(`${terminal}.querySelector('textarea').focus()`);
    await win.webContents.insertText('echo "ready in 854 ms"');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    // The printed line (the command's own row holds the text too, in quotes).
    const spacing = `(() => {
      const host = ${terminal};
      const rows = host?.querySelector('.xterm-rows');
      if (!rows || !Number(host.dataset.cols)) return null;
      const row = [...rows.children].find((r) => r.textContent.trim() === 'ready in 854 ms');
      if (!row) return null;
      const cell = host.querySelector('.xterm-screen').getBoundingClientRect().width / Number(host.dataset.cols);
      let width = 0, chars = 0;
      for (const span of row.querySelectorAll('span')) { if (chars >= 15) break; width += span.getBoundingClientRect().width; chars += span.textContent.length; }
      return { cell, rows: parseFloat(rows.style.letterSpacing) || 0, ratio: width / (chars * cell), respaced: Number(host.dataset.respaced ?? 0) };
    })()`;
    if (!(await waitInPage(win, spacing, 10_000))) return 'failed: the shell did not print the line';
    const before = (await js(spacing)) as { cell: number; rows: number; ratio: number; respaced: number };

    // Hidden behind another tab, the zoom changes and back.
    await js("document.querySelector('[data-terminal-panel] [data-new-terminal]').click()");
    if (!(await waitInPage(win, `${tabs}.length === ${baseline + 2} && !${terminal}.offsetParent`, 5_000))) return 'failed: the second tab did not open over the first';
    const ratio = (await js('devicePixelRatio')) as number;
    win.webContents.setZoomFactor(zoom * 1.25);
    if (!(await waitInPage(win, `devicePixelRatio !== ${ratio}`, 3_000))) return 'failed: the zoom did not change';
    win.webContents.setZoomFactor(zoom);
    if (!(await waitInPage(win, `devicePixelRatio === ${ratio}`, 3_000))) return 'failed: the zoom did not change back';

    await js(`${tabs}[${baseline}].click()`);
    const fits = `(() => { const s = ${spacing}; return !!s && s.rows < s.cell / 2 && Math.abs(s.ratio - 1) < 0.03; })()`;
    if (!(await waitInPage(win, fits, 5_000))) {
      const after = (await js(spacing)) as { cell: number; rows: number; ratio: number } | null;
      return after
        ? `failed: shown again, the rows are spaced ${after.rows.toFixed(2)}px (a cell is ${after.cell.toFixed(2)}px) and the line is ${after.ratio.toFixed(2)}× its cells`
        : 'failed: the line is gone after the tab showed again';
    }
    const after = (await js(spacing)) as { respaced: number };
    return `ok: the line fits its cells (${before.ratio.toFixed(2)}× before, the same after hiding through a zoom change; spaced again ${after.respaced - before.respaced} time(s))`;
  } finally {
    win.webContents.setZoomFactor(zoom);
    await js('if (window.__smokeGetContext) { HTMLCanvasElement.prototype.getContext = window.__smokeGetContext; delete window.__smokeGetContext; } true');
    // Close the tabs this step opened, back to what was there (closing the last one hides the panel).
    for (let count = (await js(`${tabs}.length`)) as number; baseline >= 0 && count > baseline; count--) {
      await js("document.querySelector('[data-terminal-panel] [role=tab][aria-selected=true] + [data-terminal-tab-close]')?.click()");
      await waitInPage(win, `${tabs}.length < ${count}`, 3_000);
    }
    await js("document.querySelector('[data-terminal-panel]') && document.querySelector('[data-toggle-terminal]')?.click()");
  }
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
  // Refresh asks again (a session running here reads its MCP servers and plugins again first) and settles.
  await js("document.querySelector('[data-capabilities-refresh]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-capabilities-refresh]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-capabilities-tab]')", 20_000))) {
    return 'refreshing the Tools window did not finish';
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await waitInPage(win, "!document.querySelector('[data-capabilities]')", 2_000);
  return `ok: ${counts.mcp} MCP servers, ${counts.commands} skills and commands, ${counts.agents} agents, ${counts.plugins} plugins`;
}

/** ⌥-click a second session: two panes; clicking one makes it active; closing one leaves the other. */
async function runSplitStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const active = () => js("document.querySelector('[data-pane-active=\"true\"]')?.dataset.pane ?? null") as Promise<string | null>;
  const other = (await js(`[...document.querySelectorAll('[data-session-id]')].find((row) => row.dataset.sessionId !== '${smokeSessionId}')?.dataset.sessionId ?? null`)) as string | null;
  if (!other) return 'failed: no second session to open beside';
  await js(`document.querySelector('[data-session-id="${other}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`);
  if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 2", 5_000))) return '⌥-click did not open a second pane';
  if ((await active()) !== other) return 'the new pane is not the active one';
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
  await js(`document.querySelector('[data-pane="${smokeSessionId}"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  if (!(await waitInPage(win, `document.querySelector('[data-pane-active="true"]')?.dataset.pane === '${smokeSessionId}'`, 2_000))) return 'clicking the first pane did not make it active';
  await js(`document.querySelector('[data-pane="${other}"] [data-close-pane]').click()`);
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
 * Docking across the whole window and dragging sessions in from the sidebar, in a window wide enough for four
 * columns. A header dragged to a window edge band becomes a cell the whole length of the window (three equal
 * columns, a full-width row at the bottom, and back); a session's sidebar row that is not open adds a tile, and
 * one that is open moves its tile (never a copy, never a replacement, the centre swaps); aiming over the message
 * box, a header and the terminal still finds the pane; no pane is remounted. The window and the layout are put back.
 */
async function runSplitEdgeStep(win: BrowserWindow): Promise<string> {
  const { js, box, slot, activePane, slots, mark, changed, stickingOut, tiles, drag, ended, handleOf } = splitTools(win);
  const smoke = smokeSessionId;
  if (!smoke || !(await waitInPage(win, `document.querySelector('[data-current-session="${smoke}"]')`, 3_000))) return 'failed: no session open to split';
  await openSidebarSections(win);
  const others = (await js(`[...document.querySelectorAll('[data-session-id]')].map((row) => row.dataset.sessionId).filter((id) => id !== '${smoke}').slice(0, 3)`)) as string[];
  if (others.length < 3) return `failed: needs four sessions in the sidebar to arrange, found ${others.length + 1}`;
  const [one, two, three] = others as [string, string, string];
  const bounds = win.getBounds();
  /** Which of the marked panes lost their mark since `mark()`: they were remounted (a pane opened later has none to lose). */
  const remounted = (ids: string[]) => js(`${JSON.stringify(ids)}.filter((id) => document.querySelector('[data-current-session="' + id + '"]')?.dataset.smokeMark !== id).join()`) as Promise<string>;
  const row = (rows: Array<{ id: string; left: number; top: number; width: number; height: number }>) => rows.sort((a, b) => a.left - b.left);
  /** Every pane the same share of the area's width, the whole height, side by side in this order. */
  const columns = async (order: string[]): Promise<string | null> => {
    const area = await box('[data-pane-count]');
    const all = row((await slots()).filter((s) => !s.hidden));
    if (!area || all.map((s) => s.id).join() !== order.join()) return `the columns are ${all.map((s) => s.id.slice(0, 8)).join(', ')}, not ${order.map((id) => id.slice(0, 8)).join(', ')}`;
    for (const s of all) {
      if (Math.abs(s.width - area.width / order.length) > 4 || Math.abs(s.height - area.height) > 2 || Math.abs(s.top - area.top) > 2) return `${s.id.slice(0, 8)} is ${s.width} x ${s.height}, not a ${Math.round(area.width / order.length)}px column`;
    }
    return null;
  };
  try {
    // Wide enough for four columns of 340px next to the sidebar.
    win.setContentSize(1760, 820);
    if (!(await waitInPage(win, "document.querySelector('[data-current-session]').getBoundingClientRect().width > 1300", 3_000))) return 'failed: the window did not widen';
    const openBeside = (id: string) => js(`document.querySelector('[data-session-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`);
    await openBeside(one);
    if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 2", 5_000))) return 'failed: ⌥-click did not open a second pane';
    await openBeside(two);
    if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 3", 5_000))) return 'failed: ⌥-click did not open a third pane';
    await waitInPage(win, "document.querySelectorAll('[data-transcript-item]').length > 0", 5_000);
    await settle(win);
    // [smoke | one over two]: the second pane's header dragged to the right edge of the window gives three equal columns.
    const grid = await slots();
    const twoAt = grid.find((s) => s.id === two);
    const oneAt = grid.find((s) => s.id === one);
    if (!twoAt || !oneAt || twoAt.left !== oneAt.left || twoAt.top <= oneAt.top) return `failed: the panes are not [one over two] beside the first (${JSON.stringify(grid)})`;
    await mark();

    const toRight = await drag(handleOf(two), { edge: 'right' }, 'drop', {
      label: 'Dock on the right, full height',
      picture: 'split-edge-dock.png',
      region: (r, area) => (Math.abs(r.height - area.height) > 2 || r.right < area.right - 2 || Math.abs(r.width - area.width / 3) > 6 ? `the indicator should be the full-height right third, not ${JSON.stringify(r)}` : null),
    });
    if (toRight) return `failed: ${toRight}`;
    if (!(await waitInPage(win, ended, 2_000))) return 'failed: the indicator stayed after the drop';
    const equalThirds = await columns([smoke, one, two]);
    if (equalThirds) return `failed: docking on the right edge did not give three equal columns: ${equalThirds}`;
    const edgeLost = await changed();
    if (edgeLost) return `failed: docking on the window edge remounted a pane (${edgeLost})`;

    // The bottom edge: the first pane takes the whole width under the other two; the left edge puts it back as a column.
    const toBottom = await drag(handleOf(smoke), { edge: 'bottom' }, 'drop', {
      label: 'Dock at the bottom, full width',
      picture: 'split-edge-dock-bottom.png',
      region: (r, area) => (Math.abs(r.width - area.width) > 2 || r.bottom < area.bottom - 2 ? `the indicator should be the full-width bottom row, not ${JSON.stringify(r)}` : null),
    });
    if (toBottom) return `failed: ${toBottom}`;
    const [bottomBox, topBox] = [await slot(smoke), await slot(one)];
    const areaNow = await box('[data-pane-count]');
    if (!bottomBox || !topBox || !areaNow || Math.abs(bottomBox.width - areaNow.width) > 2 || bottomBox.top < topBox.bottom - 2) return `failed: the bottom dock is not a full-width row under the others (${JSON.stringify({ bottomBox, topBox })})`;
    const tidy = await tiles();
    if (tidy) return `failed: after docking at the bottom the panes do not tile the area: ${tidy}`;
    const toLeft = await drag(handleOf(smoke), { edge: 'left' }, 'drop', { label: 'Dock on the left, full height' });
    if (toLeft) return `failed: ${toLeft}`;
    const back = await columns([smoke, one, two]);
    if (back) return `failed: docking on the left edge did not give three equal columns again: ${back}`;
    const alongLost = await changed();
    if (alongLost) return `failed: docking along the edges remounted a pane (${alongLost})`;

    // Aiming anywhere over a pane finds it: over its message box, its header and its terminal, a session's row from the sidebar still shows where it lands.
    const view = `[data-current-session="${smoke}"]`;
    await js(`document.querySelector('${view} [data-toggle-terminal]')?.click()`);
    if (!(await waitInPage(win, `document.querySelector('${view} [data-terminal-panel] .xterm')`, 5_000))) return 'failed: the terminal did not open in the first pane';
    await settle(win);
    const centreOf = async (selector: string) => {
      const b = await box(selector);
      return b ? { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } : null;
    };
    const probes: Array<[string, string, string]> = [
      ['message box', one, `[data-pane-slot="${one}"] [data-composer]`],
      ['header', one, `[data-pane-slot="${one}"] header`],
      ['terminal', smoke, `${view} [data-terminal-panel] .xterm`],
      ['conversation', two, `[data-pane-slot="${two}"] [data-transcript]`],
    ];
    for (const [name, pane, selector] of probes) {
      const at = await centreOf(selector);
      if (!at) return `failed: nothing to aim at for the ${name}`;
      const probed = await drag(`[data-session-id="${three}"]`, { at }, 'escape');
      void pane;
      if (probed) return `failed: aiming a sidebar row over a pane's ${name}: ${probed}`;
      if (!(await waitInPage(win, ended, 2_000))) return `failed: Esc did not end the drag over the ${name}`;
    }
    if ((await slots()).length !== 3 || (await changed())) return 'failed: aiming over the panes changed them';
    await js(`document.querySelector('${view} [data-terminal-panel] [data-terminal-tab-close]')?.click()`);
    await waitInPage(win, `!document.querySelector('${view} [data-terminal-panel]')`, 3_000);

    // A session that is not open yet, dragged from the sidebar to the right edge, adds a column: four equal ones.
    const added = await drag(`[data-session-id="${three}"]`, { edge: 'right' }, 'drop', { label: 'Dock on the right, full height', picture: 'split-sidebar-edge.png' });
    if (added) return `failed: dragging a session in from the sidebar: ${added}`;
    if (!(await waitInPage(win, `document.querySelectorAll('[data-pane]').length === 4 && document.querySelector('[data-pane-slot="${three}"]')`, 4_000))) return 'failed: a session dragged in from the sidebar did not become a tile';
    await settle(win);
    const four = await columns([smoke, one, two, three]);
    if (four) return `failed: four equal columns after the sidebar drop: ${four}`;
    if ((await activePane()) !== three) return 'failed: the new tile did not become active';
    if (await remounted([smoke, one, two])) return 'failed: opening a tile from the sidebar remounted another pane';
    const sticking = await stickingOut();
    if (sticking.length) return `failed: with four columns these stick out of their pane: ${sticking.join(', ')}`;

    // One that is already open moves its tile: still four tiles, none twice, and the centre swaps instead of replacing.
    const moved = await drag(`[data-session-id="${one}"]`, { edge: 'left' }, 'drop', { label: 'Dock on the left, full height' });
    if (moved) return `failed: dragging an open session's row to the edge: ${moved}`;
    const afterMove = await columns([one, smoke, two, three]);
    if (afterMove) return `failed: dragging the row of an open session did not move its tile to the left: ${afterMove}`;
    const copies = (await js(`[...document.querySelectorAll('[data-pane-slot]')].length + ':' + document.querySelectorAll('[data-pane-slot="${one}"]').length`)) as string;
    if (copies !== '4:1') return `failed: dragging an open session's row left ${copies} tiles (one of it)`;
    const swapped = await drag(`[data-session-id="${smoke}"]`, { pane: three, zone: 'center' }, 'drop', { label: 'Swap panes' });
    if (swapped) return `failed: dragging an open session's row onto a pane's centre: ${swapped}`;
    const swappedColumns = await columns([one, three, two, smoke]);
    if (swappedColumns) return `failed: the centre did not swap the two tiles: ${swappedColumns}`;
    if (await remounted([smoke, one, two])) return 'failed: moving tiles remounted a pane';
    return 'ok: a header dragged to the right edge made three equal columns, to the bottom a full-width row, and back; a sidebar row that was not open added a fourth column, an open one moved its tile (the centre swaps, nothing is duplicated or replaced); aiming over the message box, a header, the terminal and the conversation found the pane; nothing remounted';
  } finally {
    win.setBounds(bounds);
    // Put things back: no terminal in the smoke session, one pane with it, a settled window.
    await js(`document.querySelector('[data-current-session="${smoke}"] [data-terminal-panel] [data-terminal-tab-close]')?.click()`);
    for (let i = 0; i < 8; i++) {
      const extra = (await js(`[...document.querySelectorAll('[data-pane]')].map((el) => el.dataset.pane).find((id) => id !== '${smoke}') ?? null`)) as string | null;
      if (!extra) break;
      await js(`document.querySelector('[data-pane="${extra}"] [data-close-pane]')?.click()`);
      await settle(win);
    }
    await waitInPage(win, "!document.querySelector('[data-split]')", 2_000);
    if (!(await js(`!!document.querySelector('[data-current-session="${smoke}"]')`))) await js(`document.querySelector('[data-session-id="${smoke}"]')?.click()`);
    await settle(win);
  }
}

type DragTarget = { pane: string; zone: 'left' | 'right' | 'top' | 'bottom' | 'center' } | { edge: 'left' | 'right' | 'top' | 'bottom' } | { at: { x: number; y: number } };

/**
 * Opens every closed section of the sidebar, so its rows are in the page. Earlier starts closed, and which demo
 * sessions fall in it depends on the time of day the run starts: after midnight the sessions of a few hours ago are
 * there, and steps that pick rows from the sidebar found too few.
 */
async function openSidebarSections(win: BrowserWindow): Promise<void> {
  const closed = "document.querySelector('[data-section-list], [data-sidebar]')?.querySelectorAll('[data-section-toggle][data-open=\"false\"]') ?? []";
  await win.webContents.executeJavaScript(`for (const toggle of ${closed}) toggle.click()`);
  await waitInPage(win, `${closed}.length === 0`, 2_000);
}

/** What the split view's smoke steps share: reading the panes' places, marking them to see a remount, and dragging with the mouse. */
function splitTools(win: BrowserWindow) {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const box = (selector: string) =>
    js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; })()`) as Promise<Box | null>;
  const slot = (id: string) => box(`[data-pane-slot="${id}"]`);
  const activePane = () => js("document.querySelector('[data-pane-active=\"true\"]')?.dataset.pane ?? null") as Promise<string | null>;
  const paneCount = () => js("Number(document.querySelector('[data-pane-count]')?.dataset.paneCount ?? 0)") as Promise<number>;
  const domOrder = () => js("[...document.querySelectorAll('[data-current-session]')].map((el) => el.dataset.currentSession).join()") as Promise<string>;
  const slots = () => js("[...document.querySelectorAll('[data-pane-slot]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.paneSlot, hidden: el.hasAttribute('data-pane-hidden'), left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })") as Promise<Array<{ id: string; hidden: boolean; left: number; top: number; width: number; height: number }>>;
  // Tags each pane's view and notes its scroll position: a remounted or moved view loses both.
  const mark = async () => {
    // Scrolled up a little, then left alone until the conversations stop moving (they open at their end). A wheel up
    // first, as a person scrolls: a scroll from a script alone doesn't stop a conversation following its end (the list
    // moves itself while rows are measured), so it would snap back to the end on the next resize.
    await js("for (const t of document.querySelectorAll('[data-current-session] [data-transcript]')) { t.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true })); t.scrollTop = 30; }");
    await waitInPage(
      win,
      "(() => { const now = [...document.querySelectorAll('[data-current-session] [data-transcript]')].map((t) => t.scrollTop + '/' + t.scrollHeight).join(); const at = performance.now(); if (window.__smokeScroll?.now !== now) { window.__smokeScroll = { now, at }; return false; } return at - window.__smokeScroll.at > 500; })()",
      6_000,
    );
    await js("for (const view of document.querySelectorAll('[data-current-session]')) { view.dataset.smokeMark = view.dataset.currentSession; const t = view.querySelector('[data-transcript]'); if (t) view.dataset.smokeScroll = String(t.scrollTop); }");
  };
  /**
 * What changed in a pane since `mark()`, or an empty string when nothing did: remounted (its mark is gone), or moved
 * in the DOM, which resets its conversation's scroll to the top. How far it is from the end isn't compared: a pane
 * that changes width wraps its text again, so that changes when nothing is wrong. A hidden pane (a window too small
 * for every pane) reads as scrolled to the top, so only its mark counts, and so does one that got so much room that
 * its conversation no longer scrolls as far (the browser holds the scroll to what is left).
   */
  const changed = () =>
    js("[...document.querySelectorAll('[data-current-session]')].map((view) => { const t = view.querySelector('[data-transcript]'); return (view.dataset.smokeMark !== view.dataset.currentSession ? view.dataset.currentSession.slice(0, 8) + ' remounted' : '') + (t && t.clientHeight > 0 && Number(view.dataset.smokeScroll ?? 0) > 0 && t.scrollTop === 0 && t.scrollHeight - t.clientHeight >= Number(view.dataset.smokeScroll) ? view.dataset.currentSession.slice(0, 8) + ' scrolled back to the top from ' + view.dataset.smokeScroll + 'px' : ''); }).filter(Boolean).join('; ')") as Promise<string>;
  /** What sticks out of its pane, or overlaps: the header, the message box with its chips and Send, and the conversation above it. */
  const stickingOut = () =>
    js(`[...document.querySelectorAll('[data-pane-slot]:not([data-pane-hidden]) [data-current-session]')].flatMap((view) => {
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
  /** The panes tile the area: none overlaps another, none is under its minimum size, and together they cover it. */
  const tiles = async (): Promise<string | null> => {
    const area = await box('[data-pane-count]');
    const all = (await slots()).filter((s) => !s.hidden);
    if (!area || all.length === 0) return 'no panes';
    let covered = 0;
    for (const [i, a] of all.entries()) {
      if (a.width < 338 || a.height < 338) return `${a.id.slice(0, 8)} is only ${a.width} x ${a.height}`;
      covered += a.width * a.height;
      for (const b of all.slice(i + 1)) {
        const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
        const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        if (w > 2 && h > 2) return `${a.id.slice(0, 8)} and ${b.id.slice(0, 8)} overlap`;
      }
    }
    return Math.abs(covered - area.width * area.height) / (area.width * area.height) > 0.02 ? `the panes cover ${covered} of ${area.width * area.height}px²` : null;
  };
  const point = (b: Box, zone: 'left' | 'right' | 'top' | 'bottom' | 'center') => ({
    x: Math.round(zone === 'left' ? b.left + b.width * 0.2 : zone === 'right' ? b.right - b.width * 0.2 : b.left + b.width / 2),
    y: Math.round(zone === 'top' ? b.top + b.height * 0.2 : zone === 'bottom' ? b.bottom - b.height * 0.2 : b.top + b.height / 2),
  });

  /**
 * Presses on `grab` (a pane's title, or a session's row in the sidebar), drags to `target` (a zone of a pane, or
 * a band along an edge of the window, or a point) and lets go ('drop'), presses Esc first ('escape'), or lets go
 * in place ('click'). Returns what was wrong, or null.
   */
  const drag = async (grab: string, target: DragTarget, finish: 'drop' | 'escape' | 'click', expect: { label?: string; blocked?: boolean; picture?: string; region?: (region: Box, area: Box) => string | null } = {}): Promise<string | null> => {
    const handle = await box(grab);
    const area = await box('[data-pane-count]');
    const aimed = 'pane' in target ? await slot(target.pane) : area;
    if (!handle || !area || !aimed) return 'there is no header to drag or no pane to drop on';
    const start = { x: handle.left + Math.min(12, Math.round(handle.width / 2)), y: Math.round(handle.top + handle.height / 2) };
    const end =
      'edge' in target
        ? { x: target.edge === 'left' ? area.left + 12 : target.edge === 'right' ? area.right - 12 : Math.round(area.left + area.width / 2), y: target.edge === 'top' ? area.top + 12 : target.edge === 'bottom' ? area.bottom - 12 : Math.round(area.top + area.height / 2) }
        : 'at' in target
          ? target.at
          : point(aimed, target.zone);
    const selector = 'edge' in target ? `[data-pane-drop-target="edge"][data-pane-drop-zone="${target.edge}"]` : 'at' in target ? '[data-pane-drop-target]' : `[data-pane-drop-target="${target.pane}"][data-pane-drop-zone="${target.zone}"]`;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    let problem: string | null = null;
    if (finish !== 'click') {
      for (let i = 1; i <= 6; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + Math.round(((end.x - start.x) * i) / 6), y: start.y + Math.round(((end.y - start.y) * i) / 6), button: 'left' });
      if (!(await waitInPage(win, `document.querySelector('${selector}')`, 2_000))) problem = `no drop indicator for ${JSON.stringify(target)} showed while dragging`;
      else {
        await settle(win);
        const frame = (await js(`(() => { const el = document.querySelector('[data-pane-drop-target]'); const r = el.getBoundingClientRect(); return { label: el.innerText.trim(), blocked: el.hasAttribute('data-pane-drop-blocked'), border: getComputedStyle(el).borderTopWidth, region: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }, ghost: !!document.querySelector('[data-pane-drag-ghost]'), cursor: getComputedStyle(document.body).cursor }; })()`)) as { label: string; blocked: boolean; border: string; region: Box; ghost: boolean; cursor: string };
        if (frame.border === '0px' || frame.blocked !== Boolean(expect.blocked) || (expect.label && frame.label !== expect.label) || !frame.ghost) problem = `the drop indicator is wrong: ${JSON.stringify(frame)}`;
        else if (expect.region) problem = expect.region(frame.region, area);
        if (expect.picture) await shot(win, expect.picture);
      }
    }
    if (finish === 'escape') pressKey(win, 'Escape');
    const up = finish === 'click' ? start : end;
    win.webContents.sendInputEvent({ type: 'mouseUp', x: up.x, y: up.y, button: 'left', clickCount: 1 });
    await settle(win);
    return problem;
  };
  const ended = "!document.querySelector('[data-pane-drop-target]') && !document.documentElement.hasAttribute('data-pane-dragging') && !document.querySelector('[data-session-drag-ghost]')";
  const handleOf = (id: string) => `[data-pane-slot="${id}"] [data-pane-handle] h1`;

  return { js, box, slot, activePane, paneCount, domOrder, slots, mark, changed, stickingOut, tiles, point, drag, ended, handleOf };
}

/**
 * Split view as a tiling layout: a third pane (a row and a column mixed), a drop that does not fit refused with
 * a red indicator, docking by dragging a header onto an edge, swapping on the centre (Esc cancels, a click does
 * nothing), a divider moved by the keyboard (and its minimum, double-click for equal sizes, a drag), flipping a
 * split with ⌘⇧O, going to a neighbour with ⌘⌥ and the arrows, the palette, closing a pane, a window too small for
 * the panes showing only the active one (and everything coming back), and opening a session by dragging its row
 * from the sidebar onto a pane. No pane is remounted or moved in the DOM (each keeps its mark and scroll). Only
 * the layout changes (nothing is kept between runs), and it is put back to the smoke session alone.
 */
async function runSplitLayoutStep(win: BrowserWindow): Promise<string> {
  const { js, box, slot, activePane, paneCount, domOrder, slots, mark, changed, stickingOut, tiles, point, drag, ended, handleOf } = splitTools(win);
  void paneCount;

  const smoke = smokeSessionId;
  if (!smoke || !(await waitInPage(win, `document.querySelector('[data-current-session="${smoke}"]')`, 3_000))) return 'failed: no session open to split';
  await openSidebarSections(win);
  const others = (await js(`[...document.querySelectorAll('[data-session-id]')].map((row) => row.dataset.sessionId).filter((id) => id !== '${smoke}').slice(0, 3)`)) as string[];
  if (others.length < 3) return `failed: needs four sessions in the sidebar to arrange, found ${others.length + 1}`;
  const [one, two, three] = others as [string, string, string];
  const bounds = win.getBounds();
  try {
    const region = await js("(() => { const h = document.querySelector('[data-pane-handle]'); return h ? getComputedStyle(h).getPropertyValue('-webkit-app-region') : 'no-handle'; })()");
    if (region !== 'no-handle') return 'failed: a lone session has a pane handle';

    // Two panes, then a third: a row and a column mixed, nothing sticking out, no divider missing.
    const openBeside = (id: string) => js(`document.querySelector('[data-session-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`);
    await openBeside(one);
    if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 2", 5_000))) return 'failed: ⌥-click did not open a second pane';
    await openBeside(two);
    if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 3", 5_000))) return 'failed: ⌥-click did not open a third pane';
    await waitInPage(win, "document.querySelectorAll('[data-transcript-item]').length > 0", 5_000);
    await settle(win);
    const handleRegion = (await js("getComputedStyle(document.querySelector('[data-pane-handle]')).getPropertyValue('-webkit-app-region')")) as string;
    if (handleRegion && handleRegion !== 'no-drag') return `failed: the header's handle is part of the window's drag region (${handleRegion}), which takes the mouse`;
    if ((await activePane()) !== two) return 'failed: the newest pane is not the active one';
    const three3 = await slots();
    const lefts = new Set(three3.map((s) => s.left));
    const tops = new Set(three3.map((s) => s.top));
    if (lefts.size < 2 || tops.size < 2) return `failed: three panes are not a row and a column mixed (${JSON.stringify(three3)})`;
    const gaps = await tiles();
    if (gaps) return `failed: three panes do not tile the area: ${gaps}`;
    if ((await js("document.querySelectorAll('[data-pane-divider]').length")) !== 2) return 'failed: three panes should have two dividers';
    const sticking = await stickingOut();
    if (sticking.length) return `failed: with three panes these stick out of their pane: ${sticking.join(', ')}`;
    await shot(win, 'split-three.png');
    await mark();
    const order = await domOrder();
    const stays = async (what: string): Promise<string | null> => {
      const lost = await changed();
      return lost || (await domOrder()) !== order ? `failed: ${what} remounted or moved a pane (${lost || 'its place in the DOM changed'})` : null;
    };
    const was = await slots();

    // A drop that cannot fit (three panes stacked need more height than there is) is refused in red and changes nothing.
    const tall = await slot(smoke);
    const below = await slot(two);
    if (tall && below && tall.left < below.left) {
      const refused = await drag(handleOf(smoke), { edge: 'bottom' }, 'drop', { blocked: true, label: 'No room for that here', picture: 'split-no-room.png' });
      if (refused) return `failed: ${refused}`;
      if (JSON.stringify(await slots()) !== JSON.stringify(was) || !(await waitInPage(win, ended, 2_000))) return 'failed: a drop that does not fit changed the layout or left the indicator';
    }

    // Docking: the first pane's header onto the right edge of another pane docks it beside that pane.
    const docked = await drag(handleOf(smoke), { pane: one, zone: 'right' }, 'drop', { label: 'Dock on the right', picture: 'split-dock.png' });
    if (docked) return `failed: ${docked}`;
    if (!(await waitInPage(win, ended, 2_000))) return 'failed: the drag indicator stayed after the drop';
    const [smokeBox, oneBox, twoBox] = [await slot(smoke), await slot(one), await slot(two)];
    if (!smokeBox || !oneBox || !twoBox || smokeBox.left < oneBox.right - 2 || Math.abs(smokeBox.top - oneBox.top) > 2 || twoBox.top < oneBox.bottom - 2) {
      return `failed: docking on the right did not put the pane beside the other with the third below (${JSON.stringify({ smokeBox, oneBox, twoBox })})`;
    }
    if ((await activePane()) !== smoke) return 'failed: the docked pane did not become active';
    const afterDock = await stays('docking');
    if (afterDock) return afterDock;
    const tidy = await tiles();
    if (tidy) return `failed: after docking the panes do not tile the area: ${tidy}`;

    // The centre swaps; Esc cancels; a click on the header does nothing.
    const swapped = await drag(handleOf(smoke), { pane: two, zone: 'center' }, 'drop', { label: 'Swap panes' });
    if (swapped) return `failed: ${swapped}`;
    const [smokeAfter, twoAfter] = [await slot(smoke), await slot(two)];
    if (!smokeAfter || !twoAfter || Math.abs(smokeAfter.top - twoBox.top) > 2 || Math.abs(twoAfter.top - smokeBox.top) > 2) return 'failed: dropping on the centre did not swap the panes';
    const placed = JSON.stringify(await slots());
    const cancelled = await drag(handleOf(smoke), { pane: one, zone: 'top' }, 'escape');
    if (cancelled) return `failed: ${cancelled}`;
    if (!(await waitInPage(win, ended, 2_000)) || JSON.stringify(await slots()) !== placed) return 'failed: Esc did not cancel the drag';
    const clicked = await drag(handleOf(smoke), { pane: one, zone: 'top' }, 'click');
    if (clicked || JSON.stringify(await slots()) !== placed) return 'failed: a click on a header moved a pane';
    const afterSwap = await stays('swapping');
    if (afterSwap) return afterSwap;

    // A divider by the keyboard: ← → move it by one step (24px), Home and End stop at the minimum sizes.
    const divider = '[data-pane-divider="row"]';
    const everyPane = await slots();
    const topRow = everyPane.filter((s) => s.top === Math.min(...everyPane.map((x) => x.top))).sort((a, b) => a.left - b.left);
    const [left, right] = topRow;
    if (topRow.length !== 2 || !left || !right) return `failed: no two panes side by side to resize (${JSON.stringify(everyPane)})`;
    await js(`document.querySelector('${divider}').focus()`);
    const role = (await js(`(() => { const el = document.querySelector('${divider}'); return el.getAttribute('role') + ' ' + el.getAttribute('aria-orientation') + ' ' + el.getAttribute('aria-valuenow'); })()`)) as string;
    if (!role.startsWith('separator vertical')) return `failed: the divider is not a vertical separator (${role})`;
    pressKey(win, 'Right');
    if (!(await waitInPage(win, `Math.abs(document.querySelector('[data-pane-slot="${left.id}"]').getBoundingClientRect().width - ${left.width + 24}) < 3`, 2_000))) return 'failed: → did not move the divider by one step';
    const stepped = (await slots()).find((s) => s.id === right.id)!;
    if (Math.abs(stepped.width - (right.width - 24)) > 3) return 'failed: the pane on the other side of the divider did not give up the space';
    pressKey(win, 'Left');
    pressKey(win, 'End');
    if (!(await waitInPage(win, `document.querySelector('[data-pane-slot="${right.id}"]').getBoundingClientRect().width < 345`, 2_000))) return 'failed: End did not stop at the pane minimum';
    const squeezed = (await slots()).find((s) => s.id === right.id)!;
    if (squeezed.width < 338) return `failed: End took a pane under its minimum (${squeezed.width}px)`;
    // Double-click: equal sizes. Then a drag of the divider with the mouse moves it with the pointer.
    const grip = await box(divider);
    if (!grip) return 'failed: the divider went away';
    const at = { x: Math.round(grip.left + grip.width / 2), y: Math.round(grip.top + grip.height / 2) };
    win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
    for (const clickCount of [1, 2]) {
      win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount });
    }
    if (!(await waitInPage(win, `(() => { const a = document.querySelector('[data-pane-slot="${left.id}"]').getBoundingClientRect().width, b = document.querySelector('[data-pane-slot="${right.id}"]').getBoundingClientRect().width; return Math.abs(a - b) < 3; })()`, 2_000))) return 'failed: double-clicking the divider did not make the two panes equal';
    const before = (await slots()).find((s) => s.id === left.id);
    const moved = await box(divider);
    if (!before || !moved) return 'failed: no divider to drag';
    const from = { x: Math.round(moved.left + moved.width / 2), y: Math.round(moved.top + moved.height / 2) };
    win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 5; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x + 16 * i, y: from.y, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: from.x + 80, y: from.y, button: 'left', clickCount: 1 });
    if (!(await waitInPage(win, `Math.abs(document.querySelector('[data-pane-slot="${left.id}"]').getBoundingClientRect().width - ${before.width + 80}) < 4`, 2_000))) return 'failed: dragging the divider did not follow the pointer';
    const afterResize = await stays('resizing');
    if (afterResize) return afterResize;
    const resized = await tiles();
    if (resized) return `failed: after resizing the panes do not tile the area: ${resized}`;

    // The keyboard: ⌘⌥ and the arrows go to the neighbour; ⌘⇧O is refused when the turned layout would not fit; ⌘⇧X swaps.
    const [west, east] = [left, right];
    await js(`document.querySelector('[data-pane="${east.id}"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    pressKey(win, 'Left', ['meta', 'alt']);
    if (!(await waitInPage(win, `document.querySelector('[data-pane-active="true"]')?.dataset.pane === '${west.id}'`, 2_000))) return 'failed: ⌘⌥← did not go to the pane on the left';
    pressKey(win, 'Right', ['meta', 'alt']);
    if (!(await waitInPage(win, `document.querySelector('[data-pane-active="true"]')?.dataset.pane === '${east.id}'`, 2_000))) return 'failed: ⌘⌥→ did not go to the pane on the right';
    pressKey(win, 'Down', ['meta', 'alt']);
    if (!(await waitInPage(win, `document.querySelector('[data-pane-active="true"]')?.dataset.pane === '${smoke}'`, 2_000))) return 'failed: ⌘⌥↓ did not go to the pane below';
    pressKey(win, 'Up', ['meta', 'alt']);
    if (!(await waitInPage(win, `[${JSON.stringify(west.id)}, ${JSON.stringify(east.id)}].includes(document.querySelector('[data-pane-active="true"]')?.dataset.pane)`, 2_000))) return 'failed: ⌘⌥↑ did not go back up';
    const beforeFlip = JSON.stringify(await slots());
    pressKey(win, 'O', ['meta', 'shift']);
    await settle(win);
    if (JSON.stringify(await slots()) !== beforeFlip) return 'failed: ⌘⇧O changed three panes into a layout that does not fit the window';
    const rects = async () => (await slots()).map((s) => `${s.left},${s.top},${s.width},${s.height}`).sort().join('|');
    const activeRect = async () => {
      const id = await activePane();
      const s = (await slots()).find((x) => x.id === id);
      return s ? `${s.left},${s.top}` : '';
    };
    const [placesBefore, activeBefore] = [await rects(), await activeRect()];
    pressKey(win, 'X', ['meta', 'shift']);
    if (!(await waitInPage(win, `[...document.querySelectorAll('[data-pane-slot]')].some((el) => el.dataset.paneSlot === (document.querySelector('[data-pane-active="true"]')?.dataset.pane) && Math.round(el.getBoundingClientRect().left) + ',' + Math.round(el.getBoundingClientRect().top) !== '${activeBefore}')`, 2_000))) return 'failed: ⌘⇧X did not move the active pane to the next one’s place';
    if ((await rects()) !== placesBefore) return 'failed: swapping changed the places or sizes of the panes';
    if (!(await openPalette(win, 'K', ['meta'], 'commands'))) return 'failed: ⌘K did not open the palette';
    await setFieldValue(win, '[data-palette-input]', 'pane');
    const commands = (await js("[...document.querySelectorAll('[data-command-palette] [data-palette-command]')].map((el) => el.dataset.paletteCommand)")) as string[];
    for (const wanted of ['swap-panes', 'close-pane', 'close-other-panes', 'focus-other-pane']) if (!commands.includes(wanted)) return `failed: the palette has no ${wanted} (it lists ${commands.join(', ')})`;
    await closePalette(win);
    const afterKeys = await stays('moving with the keyboard');
    if (afterKeys) return afterKeys;

    // A window too small for every pane at its minimum shows only the active one; the others stay and come back.
    const full = JSON.stringify(await slots());
    win.setContentSize(1280, 560);
    if (!(await waitInPage(win, "document.querySelector('[data-split-fallback]') && document.querySelector('[data-pane-fallback-note]')", 3_000))) return 'failed: in a window too small for three panes the active one did not take over';
    await settle(win);
    const small = await slots();
    const shown = small.filter((s) => !s.hidden);
    const keptActive = await activePane();
    if (small.length !== 3 || shown.length !== 1 || shown[0]!.id !== keptActive) return `failed: a small window should show only the active pane and keep the others (${JSON.stringify(small)})`;
    const smallSticking = await stickingOut();
    if (smallSticking.length) return `failed: in the small window these stick out of the pane: ${smallSticking.join(', ')}`;
    await shot(win, 'split-small-window.png');
    const shrinkLost = await changed();
    if (shrinkLost) return `failed: shrinking the window remounted a pane (${shrinkLost})`;
    win.setBounds(bounds);
    if (!(await waitInPage(win, "!document.querySelector('[data-split-fallback]')", 3_000))) return 'failed: the panes did not come back in the larger window';
    await settle(win);
    if (JSON.stringify(await slots()) !== full) return 'failed: the layout did not come back as it was';
    const grown = await stays('shrinking and growing the window');
    if (grown) return grown;

    // Closing: a pane's × gives its space to the neighbours. Two panes can turn (stacked, side by side) with ⌘⇧O.
    await js(`document.querySelector('[data-pane="${one}"] [data-close-pane]').click()`);
    if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 2", 2_000))) return 'failed: closing a pane left a different number';
    await settle(win);
    const closed = await tiles();
    if (closed) return `failed: after closing a pane the others do not tile the area: ${closed}`;
    await js(`document.querySelector('[data-pane="${two}"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await mark();
    const orderTwo = await domOrder();
    const stacked = JSON.stringify(await slots());
    pressKey(win, 'O', ['meta', 'shift']);
    if (!(await waitInPage(win, `(() => { const a = document.querySelector('[data-pane-slot="${two}"]').getBoundingClientRect(), b = document.querySelector('[data-pane-slot="${smoke}"]').getBoundingClientRect(); return Math.abs(a.top - b.top) < 3 && (a.left - b.left) * (a.left - b.left) > 2500; })()`, 3_000))) return `failed: ⌘⇧O did not turn the two stacked panes side by side (${stacked})`;
    const turnedTiles = await tiles();
    if (turnedTiles) return `failed: after turning the split the panes do not tile the area: ${turnedTiles}`;
    pressKey(win, 'O', ['meta', 'shift']);
    if (!(await waitInPage(win, `(() => { const a = document.querySelector('[data-pane-slot="${two}"]').getBoundingClientRect(), b = document.querySelector('[data-pane-slot="${smoke}"]').getBoundingClientRect(); return Math.abs(a.left - b.left) < 3 && (a.top - b.top) * (a.top - b.top) > 2500; })()`, 3_000))) return 'failed: ⌘⇧O again did not stack them';
    // The panes changed height, so how far each conversation is from its end rightly changed: only a remount or a move counts here.
    const remountedAfterTurn = await js("[...document.querySelectorAll('[data-current-session]')].some((view) => view.dataset.smokeMark !== view.dataset.currentSession)");
    if (remountedAfterTurn || (await domOrder()) !== orderTwo) return 'failed: turning a split remounted or moved a pane';
    pressKey(win, 'W', ['meta', 'alt']);
    if (!(await waitInPage(win, `!document.querySelector('[data-split]') && document.querySelector('[data-current-session="${smoke}"]')`, 2_000))) return 'failed: ⌘⌥W did not close the active pane, leaving the other';
    // The last pane grows into the closed one's space a frame or two later on a slow machine (CI): wait for it.
    let tail = await tiles();
    for (const startedAt = Date.now(); tail && Date.now() - startedAt < 3_000; tail = await tiles()) await settle(win);
    if (tail) return `failed: one pane does not fill the area: ${tail}`;

    // From the sidebar: dragging a session's row onto a pane's edge opens it there, and onto its centre replaces it.
    const viaSidebar = await drag(`[data-session-id="${three}"]`, { pane: smoke, zone: 'bottom' }, 'drop', { label: 'Dock below', picture: 'split-drag-from-sidebar.png' });
    if (viaSidebar) return `failed: dragging a row from the sidebar: ${viaSidebar}`;
    if (!(await waitInPage(win, `document.querySelectorAll('[data-pane]').length === 2 && document.querySelector('[data-pane-slot="${three}"]')`, 3_000)) || !(await waitInPage(win, ended, 2_000))) return 'failed: dropping a sidebar row on a pane edge did not open it there';
    const [keptBox, droppedBox] = [await slot(smoke), await slot(three)];
    if (!keptBox || !droppedBox || droppedBox.top < keptBox.bottom - 2) return 'failed: the session dropped on the bottom edge is not below the other';
    if ((await activePane()) !== three) return 'failed: the session opened by dragging did not become active';
    const replaced = await drag(`[data-session-id="${one}"]`, { pane: three, zone: 'center' }, 'drop', { label: 'Replace this session' });
    if (replaced) return `failed: dragging a row onto a pane's centre: ${replaced}`;
    if (!(await waitInPage(win, `document.querySelectorAll('[data-pane]').length === 2 && document.querySelector('[data-pane-slot="${one}"]') && !document.querySelector('[data-pane-slot="${three}"]')`, 3_000))) return "failed: dropping a sidebar row on a pane's centre did not replace its session";
    return 'ok: opened a third pane (a row and a column mixed), refused a drop and a turn that did not fit, docked by dragging to an edge, swapped on the centre (Esc and a click do nothing), moved a divider with the arrows, Home and End, a double-click and the mouse, moved between panes and swapped with the keyboard, listed the pane commands, showed only the active pane in a window too small and brought the rest back, closed panes, turned a split, and opened sessions by dragging their rows, all without remounting';
  } finally {
    win.setBounds(bounds);
    // Put things back: one pane with the smoke session, a settled window.
    for (let i = 0; i < 6; i++) {
      const extra = (await js(`[...document.querySelectorAll('[data-pane]')].map((el) => el.dataset.pane).find((id) => id !== '${smoke}') ?? null`)) as string | null;
      if (!extra) break;
      await js(`document.querySelector('[data-pane="${extra}"] [data-close-pane]')?.click()`);
      await settle(win);
    }
    await waitInPage(win, "!document.querySelector('[data-split]')", 2_000);
    // A lone pane that is not the smoke session (the drops replaced it): the sidebar's row brings it back.
    if (!(await js(`!!document.querySelector('[data-current-session="${smoke}"]')`))) await js(`document.querySelector('[data-session-id="${smoke}"]')?.click()`);
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
 * Ask about this session in the smoke session, answered by the engine's stub (SESHBOARD_STUB_BTW), so no model is
 * called and nothing reaches the session: the transcript and Up next must not change. Questions go through the Ask
 * button, the panel's field and `/btw`, never through Send, so a broken button could never send one as a message.
 */
async function runAskStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pane = '[data-current-session]';
  const box = `document.querySelector('${pane} [data-composer]')`;
  const field = `document.querySelector('${pane} [data-ask-field]')`;
  const has = (selector: string) => `!!document.querySelector('${pane} ${selector}')`;
  const count = (selector: string) => `document.querySelectorAll('${pane} ${selector}').length`;
  const lastItem = `[...document.querySelectorAll('${pane} [data-ask-item]')].at(-1)`;
  const press = (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const running = await runningSessions();
  if (!running) return 'could not ask the engine which sessions are running, so none is safe to type in';
  if (!smokeSessionId || running.ids.has(smokeSessionId)) return 'ok: skipped, no idle smoke session to ask in';
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  if (!(await waitInPage(win, `${box} && !${box}.disabled && ${box}.value === ''`, 5_000))) return 'the smoke session has no empty message box';
  // The conversation's own count: its list is virtualised, so the rows in the DOM change when the Ask panel narrows it.
  const transcript = `Number(document.querySelector('${pane} [data-transcript]')?.dataset.transcriptCount ?? -1)`;
  const before = (await js(transcript)) as number;
  const askButton = `document.querySelector('${pane} [data-ask-button]')`;
  const close = async () => {
    if (await js(has('[data-ask-panel]'))) await js(`document.querySelector('${pane} [data-ask-close]')?.click()`);
  };
  const fail = async (why: string) => {
    await close();
    return why;
  };
  /** The last question in the thread on screen has its answer, with these words in it. */
  const answered = (words: string) => waitInPage(win, `${lastItem}?.dataset.askItem === 'done' && ${lastItem}.textContent.includes(${JSON.stringify(words)})`, 10_000);
  const askInField = async (question: string) => {
    await js(`${field}.focus()`);
    await win.webContents.insertText(question);
    press('Return');
  };
  if (!(await js(`!!${askButton} && ${askButton}.dataset.askButton === '' && !${has('[data-ask-ready]')}`))) return 'no Ask button next to Send, or it starts pressed or with a dot';

  // An empty box: Ask opens the panel, on the intro, with the caret in its field.
  await js(`${askButton}.click()`);
  if (!(await waitInPage(win, `${has('[data-ask-panel]')} && document.activeElement === ${field} && ${askButton}.dataset.askButton === 'open'`, 3_000))) return await fail('Ask with an empty box did not open the panel with its field focused and the button pressed');
  if (!(await js(`${has('[data-ask-intro]')} && ${count('[data-ask-suggestion]')} === 4`))) return await fail('the first open has no intro with four suggestions');

  // Text in the box: Ask asks it and empties the box.
  await js(`${box}.focus()`);
  await win.webContents.insertText('Which flag did we use for the beta publish?');
  await js(`${askButton}.click()`);
  if (!(await answered('--cleanStart'))) return await fail('the answer to the question from the message box did not come in');
  if (((await js(`${box}.value`)) as string) !== '') return await fail('the message box kept the question after Ask');

  // A follow-up from the panel's field, with ↩, in the same thread.
  await askInField('and the release script?');
  if (!(await answered('release script'))) return await fail('the follow-up did not get its answer');
  if ((await js(count('[data-ask-item]'))) !== 2) return await fail('the follow-up did not stay in the same thread');
  if (!(await js(`${field}.value === ''`))) return await fail('the field kept the follow-up after asking');

  // ↑ in the empty field puts the last question back.
  await js(`${field}.focus()`);
  press('Up');
  if (!(await waitInPage(win, `${field}.value === 'and the release script?'`, 2_000))) return await fail('↑ in the empty field did not put the last question back');
  win.webContents.selectAll();
  press('Backspace');

  // Quote in message: the answer goes into the message box as a quote, with the focus.
  await js(`${lastItem}.querySelector('[data-ask-quote]').click()`);
  if (!(await waitInPage(win, `${box}.value.startsWith('> ') && ${box}.value.includes('release script') && document.activeElement === ${box}`, 2_000))) return await fail('Quote in message did not put the answer in the message box as a quote');
  win.webContents.selectAll();
  press('Backspace');
  if (!(await waitInPage(win, `${box}.value === ''`, 1_000))) return await fail('could not empty the message box after the quote');

  // Closed while it answers (Esc lets go of the field, Esc again closes): the dot shows when it is done, and goes on open.
  await askInField('What is left to do?');
  if (!(await waitInPage(win, has('[data-ask-answering]'), 3_000))) return await fail('no Answering while the answer came in');
  press('Escape');
  if (!(await waitInPage(win, `${has('[data-ask-panel]')} && document.activeElement !== ${field}`, 1_000))) return await fail('Esc in the field did not let go of it first');
  press('Escape');
  if (!(await waitInPage(win, `!${has('[data-ask-panel]')}`, 1_000))) return await fail('Esc on the panel did not close it');
  if (!(await waitInPage(win, has('[data-ask-ready]'), 10_000))) return 'the Ask button got no dot when the answer came in while the panel was closed';
  await js(`${askButton}.click()`);
  if (!(await waitInPage(win, `${has('[data-ask-panel]')} && !${has('[data-ask-ready]')}`, 2_000))) return await fail('opening the panel did not clear the dot');
  if (!(await answered('scheduler'))) return await fail('the answer that came in while closed is not there');

  // New thread starts empty; a suggestion asks there.
  await js(`document.querySelector('${pane} [data-ask-new-thread]').click()`);
  if (!(await waitInPage(win, `${has('[data-ask-intro]')} && ${count('[data-ask-item]')} === 0`, 2_000))) return await fail('New thread did not start empty');
  await js(`document.querySelector('${pane} [data-ask-suggestion="What changed so far?"]').click()`);
  if (!(await answered('sidebarRows.ts'))) return await fail('a suggestion did not ask');

  // Earlier threads: both, newest first; picking the first one opens it.
  await js(`document.querySelector('${pane} [data-ask-threads]').click()`);
  if (!(await waitInPage(win, `document.querySelectorAll('[role=menu] [data-ask-thread]').length === 2`, 2_000))) return await fail('Earlier threads did not list both threads');
  await js(`document.querySelectorAll('[role=menu] [data-ask-thread]')[1].click()`);
  if (!(await waitInPage(win, `${count('[data-ask-item]')} === 3`, 2_000))) return await fail('picking the earlier thread did not open it');

  // /btw asks in the same panel; a bare /btw opens it.
  await js(`${box}.focus()`);
  await win.webContents.insertText('/btw Did we round the tax per invoice?');
  if (!(await waitInPage(win, `${has('[data-btw-token]')} && ${box}.value === 'Did we round the tax per invoice?'`, 2_000))) return await fail('"/btw " did not become the token');
  await js(`${askButton}.click()`);
  if (!(await answered('half up'))) return await fail('/btw did not ask in the panel');
  if (await js(has('[data-btw-token]'))) return await fail('the token stayed after /btw asked');
  await close();
  await js(`${box}.focus()`);
  await win.webContents.insertText('/btw ');
  await js(`${askButton}.click()`);
  if (!(await waitInPage(win, `${has('[data-ask-panel]')} && ${box}.value === '' && !${has('[data-btw-token]')}`, 2_000))) return await fail('a bare /btw did not open the panel');

  // With Changes open too, the right side has tabs; opening Changes never closes Ask.
  let tabs = 'no Changes here';
  if (await js(has('[data-toggle-changes]'))) {
    const wasOpen = (await js(has('[data-changes-panel]'))) as boolean;
    if (!wasOpen) await js(`document.querySelector('${pane} [data-toggle-changes]').click()`);
    else await js(`document.querySelector('${pane} [data-right-tab="changes"]')?.click()`);
    const tab = (id: string) => `document.querySelector('${pane} [data-right-tab="${id}"]')?.getAttribute('aria-selected') === 'true'`;
    if (!(await waitInPage(win, `${has('[data-right-tabs]')} && ${tab('changes')} && ${has('[data-changes-panel]')} && !${has('[data-ask-panel]')}`, 3_000))) return await fail('opening Changes with Ask open did not show it in front as a tab');
    if (!(await js(`document.querySelector('${pane} [data-right-tab="ask"]').textContent.includes('4')`))) return await fail('the Ask tab does not count the thread’s questions');
    await js(`document.querySelector('${pane} [data-right-tab="ask"]').click()`);
    if (!(await waitInPage(win, `${tab('ask')} && ${has('[data-ask-panel]')} && !${has('[data-changes-panel]')}`, 2_000))) return await fail('the Ask tab did not bring Ask to the front');
    if (!wasOpen) {
      // ⌘⇧D with Changes behind: to the front, then closed (Ask stays).
      await js(`document.querySelector('${pane} [data-toggle-changes]').click()`);
      if (!(await waitInPage(win, `${tab('changes')}`, 2_000))) return await fail('the Changes toggle did not bring Changes to the front');
      await js(`document.querySelector('${pane} [data-toggle-changes]').click()`);
      if (!(await waitInPage(win, `!${has('[data-right-tabs]')} && ${has('[data-ask-panel]')}`, 2_000))) return await fail('closing Changes did not leave Ask on its own');
    }
    tabs = 'tabs with Changes';
  }
  await close();

  const after = (await js(transcript)) as number;
  if (after !== before) return `the transcript changed: ${before} items, then ${after}`;
  if (await js(has('[data-queue-item]'))) return 'a question went into Up next';
  return `ok: Ask opens on an empty box and asks the box's text, follow-up, ↑, Quote in message, the dot, New thread, Earlier threads, /btw, ${tabs}; transcript unchanged at ${before} items`;
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
  // A working session asks first: Archive while it works? for one in another app (the demo's), Stop and archive for one
  // the smoke started here.
  if (working) {
    if (!(await waitInPage(win, "!!document.querySelector('[data-stop-archive-confirm] [data-confirm]')", 3_000))) return 'archiving a working session did not ask first';
    await js("document.querySelector('[data-stop-archive-confirm] [data-confirm]').click()");
  }
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
 * Quick actions on hover: hovering a finished session shows its buttons, Archive moves it under Archived with a toast,
 * and Undo brings it back. Archive on a working session asks first (Cancel keeps it). U on the focused row marks it
 * unread, and ⌘Z takes that back. Flags live in the throwaway profile.
 */
async function runQuickActionsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const list = "document.querySelector('[data-session-list]')";
  const row = (id: string) => `document.querySelector('[data-session-id="${id}"]')`;
  const toolbar = (id: string) => `document.querySelector('[data-row-actions="${id}"]')`;
  const inMainList = (id: string) =>
    `(() => { const r = ${row(id)}; if (!r) return false; const h = document.querySelector('[data-archived-toggle]'); return !h || r.getBoundingClientRect().top < h.getBoundingClientRect().top; })()`;
  /** Moves the real pointer onto a row, so its buttons show by hover alone. */
  // A row that just turned busy can still move as the list re-sorts (slow on CI runners), so the pointer may land on
  // another row: measure again and move away and back, a few times.
  const hover = async (id: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const box = (await js(`(() => { const r = ${row(id)}?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`)) as { x: number; y: number } | null;
      if (!box) return false;
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
      if (await waitInPage(win, `${toolbar(id)} && getComputedStyle(${toolbar(id)}).opacity === '1'`, 1_500)) return true;
    }
    return false;
  };
  const actions = (id: string) => js(`[...(${toolbar(id)}?.querySelectorAll('[data-row-action]') ?? [])].map((b) => b.dataset.rowAction).join(',')`) as Promise<string>;
  await js(`${list}.scrollTop = 0`);

  // 1. A finished session in the main list: its buttons, Archive, and a toast with Undo.
  const id = (await js(`(() => {
    const header = document.querySelector('[data-archived-toggle]');
    const top = header ? header.getBoundingClientRect().top : Infinity;
    return [...document.querySelectorAll('[data-session-id]')].find((r) => r.getBoundingClientRect().top < top && r.dataset.indexed === 'true' && r.dataset.sessionId !== ${JSON.stringify(smokeSessionId)} && !/Claude is working|Waiting for you/.test(r.getAttribute('aria-label') ?? ''))?.dataset.sessionId ?? null;
  })()`)) as string | null;
  if (!id) return 'ok: skipped, no finished session in the main list';
  // The pointer away from the list first: a step before may have left it on a row.
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  if (!(await js(`!!${toolbar(id)}`))) return `a finished session has no buttons: ${await js(`${row(id)}?.outerHTML.slice(0, 300)`)}`;
  if (await js(`getComputedStyle(${toolbar(id)}).opacity !== '0'`)) return 'the buttons show without hover';
  if (!(await hover(id))) return 'hovering a finished session showed no buttons';
  await shot(win, 'sidebar-quick-actions.png');
  const shown = await actions(id);
  if (!/^(read,)?pin,archive$/.test(shown)) return `a finished session shows ${shown || 'nothing'}, not Mark read, Pin and Archive`;
  const label = (await js(`${toolbar(id)}.querySelector('[data-row-action="archive"]').dataset.tooltip`)) as string;
  if (!/^Archive \(E\)$/.test(label)) return `the Archive tooltip says “${label}”`;
  await js(`${toolbar(id)}.querySelector('[data-row-action="archive"]').click()`);
  await js(`${list}.scrollTop = 0`);
  if (!(await waitInPage(win, `!${inMainList(id)}`, 3_000))) return 'Archive did not move the session out of the main list';
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-quick-action-toast]')].some((t) => t.innerText.startsWith('Archived') && t.querySelector('[data-toast-undo]'))", 2_000))) return 'no “Archived …” toast with Undo';

  // 2. Undo puts it back.
  await js("[...document.querySelectorAll('[data-quick-action-toast]')].at(-1).querySelector('[data-toast-undo]').click()");
  if (!(await waitInPage(win, `(${list}.scrollTop = 0, ${inMainList(id)})`, 3_000))) return 'Undo did not bring the session back';

  // 3. A working session: Archive asks first, and Cancel keeps it where it is. The demo lists none (its working sessions
  // are on the second profile), so there one is made to look busy: an entry in the made-up home's live registry, kept
  // alive by this process, and taken away after.
  const working$ = `[...document.querySelectorAll('[data-session-id]')].find((r) => /Claude is working|Waiting for you/.test(r.getAttribute('aria-label') ?? '') && r.closest('[data-row-wrap]'))?.dataset.sessionId ?? null`;
  let busy = (await js(working$)) as string | null;
  let registryEntry: string | null = null;
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (!busy && process.env.SESHBOARD_SMOKE_DEMO && configDir) {
    const other = (await js(`[...document.querySelectorAll('[data-session-id]')].find((r) => r.dataset.indexed === 'true' && r.dataset.sessionId !== ${JSON.stringify(id)} && r.dataset.sessionId !== ${JSON.stringify(smokeSessionId)})?.dataset.sessionId ?? null`)) as string | null;
    if (other) {
      registryEntry = join(configDir, 'sessions', `${process.pid}.json`);
      mkdirSync(join(configDir, 'sessions'), { recursive: true });
      writeFileSync(registryEntry, JSON.stringify({ pid: process.pid, sessionId: other, cwd: homedir(), startedAt: Date.now(), kind: 'interactive', entrypoint: 'cli', status: 'busy', statusUpdatedAt: Date.now(), updatedAt: Date.now() }));
      if (await waitInPage(win, `(${list}.scrollTop = 0, /Claude is working/.test(${row(other)}?.getAttribute('aria-label') ?? ''))`, 5_000)) busy = other;
      else rmSync(registryEntry, { force: true });
    }
  }
  const unbusy = () => registryEntry && rmSync(registryEntry, { force: true });
  let working = 'no working session to try';
  if (busy) try {
    if (!(await hover(busy))) return 'hovering a working session showed no buttons';
    if (!(await actions(busy)).includes('archive')) return `a working session shows ${await actions(busy)}`;
    await js(`${toolbar(busy)}.querySelector('[data-row-action="archive"]').click()`);
    if (!(await waitInPage(win, "!!document.querySelector('[data-stop-archive-confirm]')", 2_000))) return 'Archive on a working session did not ask first';
    await shot(win, 'sidebar-quick-actions-confirm.png');
    await js("[...document.querySelectorAll('[data-stop-archive-confirm] button')].find((b) => b.innerText === 'Cancel').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-stop-archive-confirm]')", 2_000))) return 'Cancel did not close the question';
    if (!(await waitInPage(win, `(${list}.scrollTop = 0, ${inMainList(busy)})`, 1_000))) return 'Cancel archived the working session anyway';
    working = 'a working session asked first';
  } finally {
    unbusy();
  }

  // 4. U on the focused row marks it unread; ⌘Z takes it back.
  const unread = (target: string) => `/New activity since you last looked/.test(${row(target)}?.getAttribute('aria-label') ?? '')`;
  if (await js(unread(id))) return 'ok: the read session was unread already';
  const key = (key: string, mod = false) => js(`${row(id)}.focus(); ${row(id)}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ${MOD_KEY_PROPERTY}: ${mod} }))`);
  await key('u');
  if (!(await waitInPage(win, unread(id), 2_000))) return 'U on the focused row did not mark it unread';
  await key('z', true);
  if (!(await waitInPage(win, `!${unread(id)}`, 2_000))) return '⌘Z did not undo Mark as unread';
  return `ok: hover showed Mark read, Pin and Archive; Archive and Undo; ${working}; U and ⌘Z`;
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
  if (!(await js(`${row(a)}?.querySelector('[data-pick-box]')?.dataset.pickBox === 'true' && !!${row(a)}?.closest('[data-list-row]')?.querySelector('[data-pick-block]')`))) return 'the picked row has no ticked checkbox or tinted block';
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
 * Sessions running in Claude Code right now, in Seshboard or anywhere else, and their folders, plus the Claude
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

/**
 * Claude Code mods: a session in a throwaway profile loads the test mod (tests/fixtures/smoke-mod, copied by the
 * launcher into SESHBOARD_SMOKE_MODS) and starts with its own `/smoke-ping`, which the mod answers without the model.
 * Checks its band above the message box, its pane's tab, its status chip, that a press reaches the mod (the band and
 * status change and a toast comes), and that Show mods off takes all of it away without a restart.
 */
async function runModsStep(win: BrowserWindow): Promise<string> {
  const spec = JSON.parse(process.env.SESHBOARD_SMOKE_MODS ?? 'null') as { out: string } | null;
  if (!spec) return 'ok: skipped, the launcher made no test mod (SESHBOARD_SMOKE_MODS)';
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const text = (selector: string) => `(document.querySelector('${selector}')?.innerText ?? '')`;
  engine.sendStanding({ type: 'smokeMods' });
  if (!(await until(() => existsSync(spec.out), 45_000))) return 'failed: the engine never started the mods session';
  const started = JSON.parse(readFileSync(spec.out, 'utf8')) as { sessionId?: string; supported?: boolean; error?: string };
  if (started.error || !started.sessionId) return `failed: starting the mods session: ${started.error ?? 'no session id'}`;
  if (!started.supported) return "ok: skipped, this Claude Code doesn't report ui_surface_v1 (no mod support)";
  openSession(started.sessionId);
  const band = '[data-mod-band="smoke-mod"]';
  if (!(await waitInPage(win, `${text(band)}.includes('Smoke band: pressed 0')`, 15_000))) return 'failed: the band did not show above the message box';
  if (!(await js(`!!document.querySelector('${band}[data-mod-frame]')?.querySelector('header')?.innerText.includes('smoke-mod')`))) return 'failed: the band has no frame with the mod\'s name';
  if (!(await waitInPage(win, `${text('[data-mod-pane="smoke-pane"]')}.includes('From smoke-mod · pane') && ${text('[data-mod-pane-body]')}.includes('Smoke pane')`, 10_000))) return 'failed: the pane did not open in the right panel';
  // The status shows as a chip, or in the "+N" list when the footer is narrow (statuses fold first).
  const status = (want: string) =>
    waitInPage(
      win,
      `${text('[data-mod-status="smoke-mod"]')}.includes('${want}') || (document.querySelector('[data-mod-status-more]') && (document.querySelector('[data-mod-status-list]') || (document.querySelector('[data-mod-status-more]').click(), false)) && ${text('[data-mod-status-list]')}.includes('${want}'))`,
      10_000,
    );
  if (!(await status('ready'))) return 'failed: the status chip did not show';
  // A narrow message box: the chips under it must not run under anything on the right of the footer (the mods' chips,
  // Ask, Stop, Send), side by side or on a line of their own. Measured once the footer has settled at that width.
  const squeeze = "(() => { const f = document.querySelector('[data-composer-footer]'); if (f) f.style.maxWidth = '380px'; return !!f; })()";
  const release = "(() => { const f = document.querySelector('[data-composer-footer]'); if (f) f.style.maxWidth = ''; })()";
  const clear = `(() => {
    const f = document.querySelector('[data-composer-footer]');
    const chips = [...document.querySelectorAll('[data-composer-chips] [data-chip]')].map((c) => c.getBoundingClientRect());
    const right = [...(document.querySelector('[data-composer-footer-end]')?.children ?? [])].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 1 && r.height > 1);
    if (!f || f.getBoundingClientRect().width > 381 || chips.length === 0 || right.length === 0) return false;
    return !chips.some((c) => right.some((r) => c.right > r.left + 0.5 && c.left < r.right - 0.5 && c.bottom > r.top + 0.5 && c.top < r.bottom - 0.5));
  })()`;
  if (!(await js(squeeze))) return 'failed: no message box footer to narrow';
  try {
    if (!(await waitInPage(win, clear, 5_000))) return "failed: at a narrow width the chips under the message box run under the mods' chips or the buttons on the right";
  } finally {
    await js(release);
  }
  await js("document.querySelector('[data-mod-status-list]') && document.querySelector('[data-mod-status-more]').click()");
  if (!(await js("!!document.querySelector('[data-mods-chip]')"))) return 'failed: no mods chip in the header';
  await js(`document.querySelector('${band} [data-mod-button="press"]').click()`);
  if (!(await waitInPage(win, `${text(band)}.includes('pressed 1')`, 10_000)) || !(await status('pressed 1'))) return 'failed: a press on the band did not reach the mod';
  await js("document.querySelector('[data-mod-status-list]') && document.querySelector('[data-mod-status-more]').click()");
  if (!(await waitInPage(win, `${text('[data-mod-toast="smoke-mod"]')}.includes('Smoke toast')`, 5_000))) return 'failed: the mod\'s toast did not show';
  await shot(win, 'mods.png');
  // Show mods off: everything goes, without a restart.
  const toggle = async () => {
    await js("document.querySelector('[data-open-settings]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"mods\"]')", 3_000))) return false;
    await js("document.querySelector('[data-settings-section=\"mods\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-show-mods]')", 3_000))) return false;
    await js("document.querySelector('[data-show-mods]').click()");
    await js("document.querySelector('[data-close-settings]')?.click()");
    return waitInPage(win, "!document.querySelector('[data-settings]')", 3_000);
  };
  try {
    if (!(await toggle())) return 'failed: could not turn Show mods off in Settings › Mods';
    const gone = "!document.querySelector('[data-mod-band], [data-mod-pane], [data-mod-status], [data-mod-status-more], [data-mods-chip]')";
    if (!(await waitInPage(win, gone, 10_000))) return 'failed: Show mods off left mod UI on screen';
  } finally {
    await toggle();
  }
  if (!(await waitInPage(win, `${text(band)}.includes('Smoke band')`, 15_000))) return 'failed: the band did not come back with Show mods on';
  return 'ok: band, pane, status, toast and header chip from the test mod; a press reached it; Show mods off removed all of it and on brought it back';
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
        only: smokeOnly ? { pattern: smokeOnly.source, matched: smokeRun.matched } : null,
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
    await smokeRun.step(RESTART_STEP, async () => `ok: in ${Math.round(performance.now() - crashedAt)}ms`, { cleanup: false });
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

  // The first two always run: the steps after them work in the session they open.
  await step('sessions listed after the initial scan', async () => {
    if (!(await waitInPage(win, "document.querySelector('[data-session-id]')", 5_000))) return 'failed: no session rows';
    await shot(win, 'window.png');
    await js("document.querySelector('[data-project-filter]')?.click()");
    await waitInPage(win, "document.querySelector('[role=menu]')", 1_000);
    await shot(win, 'projects.png');
    pressKey(win, 'Escape');
    await waitInPage(win, "!document.querySelector('[role=menu]')", 1_000);
    return `ok: ${await js("document.querySelectorAll('[data-session-id]').length")} rows (${readyReports[0]!.sessionCount} in the first snapshot)`;
  }, { always: true });
  await step('newest session with messages rendered', () => openSmokeSession(win), { always: true });
  await step('transcript opens at the end', () => checkTranscriptEnd(win));
  await step('permission mode for new sessions: global mode, Remember last and a fixed mode', () => runNewSessionModeStep(win));
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
  await step('file preview', () => runFilePreviewStep(win));
  await step('long prompts', () => runLongPromptStep(win));
  await step('prompt outline: marks, a click and Next prompt', () => runPromptOutlineStep(win), { timeoutMs: 60_000 });
  await step('copy messages', () => runCopyMessageStep(win));
  await step('reply actions', () => runReplyActionsStep(win));
  await step('under each reply: the turn line on hover with the actions, its tokens, Nothing hides it', () => runTurnMetaStep(win), { timeoutMs: 60_000 });
  await step('reading mode: Read, outline, Esc and back land on the reply', () => runReadModeStep(win), { timeoutMs: 60_000 });
  await step('remember this', () => runRememberStep(win));
  await step('selection toolbar', () => runSelectionToolbarStep(win));
  await step('run code blocks', () => runCodeRunStep(win));
  await step('unsent drafts', () => runDraftStep(win));
  await step('unsent messages', () => runUnsentStep(win));
  await step('search', () => runSearchStep(win));
  await step('command palette', () => runPaletteStep(win));
  await step('catch-up: banner, strip, keys and Quickest to unblock', () => runCatchUpStep(win));
  await step('shortcuts sheet', () => runShortcutsStep(win));
  await step('tools', () => runToolsStep(win));
  await step('split panes', () => runSplitStep(win));
  // Both take about 5s locally and five times that on a CI runner.
  await step('split layout: tiling panes', () => runSplitLayoutStep(win), { timeoutMs: 60_000 });
  await step('split layout: window edges and the sidebar', () => runSplitEdgeStep(win), { timeoutMs: 60_000 });
  await step('archive', () => runArchiveStep(win));
  await step('rename', () => runRenameStep(win));
  await step('multi-select and archive', () => runArchiveManyStep(win));
  await step('quick actions on hover: Archive with Undo, a working session asks first, U and ⌘Z', () => runQuickActionsStep(win));
  await step('drop target', () => runDropStep(win));
  await step('prompt history', () => runHistoryStep(win));
  await step('send now only while Claude works', () => runSendNowStep(win));
  await step('Ask about this session, nothing added to the conversation', () => runAskStep(win));
  await step('controls', () => runControlsStep(win));
  await step('sidebar states', () => runSidebarStatesStep(win));
  await step('new session view', () => runNewSessionStep(win));
  // Finding a checkout of an unknown repository walks the folders on disk.
  await step('links', () => runDeepLinkStep(win), { timeoutMs: 45_000 });
  await step('shell command: Settings installs and removes seshboard, sesh and switchboard, a folder argument opens New session', () => runShellCommandStep(win));
  await step('# lists issues and pull requests (fake gh), ↩ adds a chip, Esc keeps typing, an Attached row (nothing sent)', () => runGithubListStep(win), { timeoutMs: 45_000 });
  await step('new session from an issue (⌥↩) and a pull request (palette), fork caution, not started', () => runGithubNewSessionStep(win), { timeoutMs: 45_000 });
  await step('link with an issue and autostart=1 fills in New session and never starts; another repository is refused', () => runGithubLinkStep(win), { timeoutMs: 45_000 });
  await step('VS Code companion', () => runCompanionStep(win));
  await step('queue', () => runQueueStep(win));
  await step('pipelines: run, @ links, a round 2, another round, done', () => runPipelineStep(win));
  await step('run as: a pipeline picked in New session, Run pipeline with its steps, ⌘↵ runs it, back to One session', () => runRunAsStep(win));
  await step('pipelines: Stop the run, archive the run with its steps, then delete it', () => runArchiveRunStep(win));
  await step('pipelines: the editor keeps a step\'s Starts choice on one row', () => runPipelineEditorStep(win));
  await step('queue: start by itself after a clean finish, not after an error', () => runQueueAutoStartStep(win));
  await step('compacting: the status stays after switching to another session and back', () => runCompactingStep(win));
  await step('keep awake until done: the ⋯ menu, the pill, and it goes once the session is done', () => runKeepAwakeSessionStep(win));
  await step('schedules: made in New session, run on a moved clock, paused, deleted and put back', () => runSchedulesStep(win), { timeoutMs: 45_000 });
  await step('upcoming: the queue, the runs and the schedules, filtered by project, a run skipped and put back, an item started', () => runUpcomingStep(win), { timeoutMs: 45_000 });
  await step('triggers: Start when… makes an issues trigger, the first check starts nothing, a new issue starts once with claude: working, paused starts nothing', () => runTriggersStep(win), { timeoutMs: 60_000 });
  await step('triggers: a trigger that starts a pipeline, from Run as and Start when…, starts one run with the issue as its task and the bolt on its run row', () => runTriggerPipelineStep(win), { timeoutMs: 60_000 });
  await step('saved prompts: made in Settings, picked with /, filled, queued, moved and shared', () => runSavedPromptsStep(win), { timeoutMs: 60_000 });
  await step('collapsible sections', () => runSectionsStep(win));
  await step('archived dock', () => runArchivedDockStep(win));
  await step('star on GitHub', () => runStarStep(win));
  await step('quick question', () => runQuickQuestionStep(win));
  await step('usage band above the composer', async () => {
    if (!(await waitInPage(win, "document.querySelector('[data-usage-band]')", 15_000))) {
      // Under a session the band needs Claude Code's usage report, which takes a login the demo home doesn't have.
      return process.env.SESHBOARD_SMOKE_DEMO ? 'ok: skipped, no login in the demo home to read usage from' : 'failed: not shown';
    }
    await shot(win, 'usage.png');
    return `ok: ${await js("document.querySelector('[data-usage-band]').innerText.replace(/\\s+/g, ' ')")}`;
  });
  await step('usage view: open from the usage bar, tabs and periods, a session from a row, Esc', () => runUsageViewStep(win), { timeoutMs: 45_000 });
  await step('settings › usage: Show estimated cost and Currency are saved, Open usage opens the view with its cost', () => runUsageSettingsStep(win));
  await step('⌘Q asks first, Cancel keeps the app open, a second ⌘Q quits', () => runQuitStep(win));
  await step('settings: theme, sidebar style, session scope, tool activity, open at login, keep awake, startup and quit prompt apply at once and are saved', () => runSettingsStep(win));
  await step('settings search: ⌘F, results per page, Enter and Escape, and every setting opens at its row', () => runSettingsSearchStep(win), { timeoutMs: 90_000 });
  await step('settings groups: four headers and the bottom block, ↓ skips headers, Pipelines opens, search keeps the groups in order, a short window scrolls', () => runSettingsGroupsStep(win));
  await step('focus limit', () => runFocusStep(win));
  await step('settings › sessions: archive days, deleting asks first, overview picks a month (nothing deleted)', () => runSessionsSettingsStep(win));
  await step('terminal panel opened a shell', () => runTerminalStep(win));
  await step('⌘K in the terminal', () => runTerminalClearStep(win));
  await step('terminal layout', () => runTerminalLayoutStep(win));
  await step('terminal renderer: WebGL only for the tab on screen, with more tabs than contexts', () => runTerminalRendererStep(win), { timeoutMs: 60_000 });
  await step('terminal letters: normal spacing without WebGL after the tab hides through a zoom change', () => runTerminalLetterSpacingStep(win));
  await step("the window's own terminal, outside a session", () => runAppTerminalStep(win));
  await step('a session in its own window: panel buttons, Ask, the terminal key, the palette and shortcuts sheet, a narrow window, Move back, panels going with the session', () => runPopoutStep(win), { timeoutMs: 120_000 });
  await step('project action added through the editor and run in a terminal tab', () => runActionStep(win));
  await step('action terminal', () => runActionTerminalStep(win));
  await step('action menu', () => runActionMenuStep(win));
  await step('settings › notifications: both switches, the blocked notice, a test notification, a sound per moment, ▶, hover and the volume (recorded, never heard)', () => runNotificationsStep(win));
  await step('projects', () => runProjectsStep(win), { timeoutMs: 60_000 });
  await step('profiles', () => runProfilesStep(win));
  // After projects and profiles: it adds a project (removed again), and New session may stay on its folder.
  await step('add a project in New session: the Add project dialog, a typed path, Tab, ↩, and a refused drop', () => runAddFolderStep(win));
  await step('clone from GitHub: the setting with its folder, a URL in the folder field, the clone of a local repository, the trust question (no session)', () => runCloneStep(win), { timeoutMs: 60_000 });
  // After projects: it adds ten projects (removed again), which the Projects view's first step must not see.
  await step('new session project list: three columns and nine rows, two and eight, one and six, ⌘F finds, ⌘2 picks the second row', () => runProjectListStep(win), { timeoutMs: 90_000 });
  await step('about', () => runAboutStep(win));
  await step('backup', () => runBackupStep(win));
  await step('settings › remote: the three steps, the status card, Change… and Advanced, renaming a device', () => runRemoteSettingsStep(win), { timeoutMs: 45_000 });
  await step('connected to this Mac: a test phone connects, its row, toast and details, Revoke disconnects it', () => runConnectedDevicesStep(win), { timeoutMs: 45_000 });
  await step('other computers: a remote session in the sidebar with its chip, the violet line and "on …", the terminal disabled, New session runs there', () => runOtherComputerStep(win), { timeoutMs: 60_000 });
  // The remote app on a phone, in a window of its own (remotePhoneSmoke.ts). The first of these to run pairs it, which
  // waits for Vite's first build of the app on a fresh runner.
  await step('remote app on a phone: the menu button opens the drawer, no app icon, Settings and the computer at the bottom', runPhoneDrawerStep, { timeoutMs: 75_000 });
  await step('remote app on a phone: New session from the drawer in a session', runPhoneDrawerNewStep, { timeoutMs: 75_000 });
  await step('remote app on a phone: Settings switches the theme, Back returns to Home in it', runPhoneSettingsThemeStep, { timeoutMs: 75_000 });
  await step('remote app on a phone: ⋯ › All settings opens Settings', runPhoneMoreStep, { timeoutMs: 75_000 });
  await step("remote app on a phone: a finished session's catch-up shows the prompt's title without #", runPhoneCatchUpStep, { timeoutMs: 75_000 });
  await step("remote app on a phone: a session's ⋯ has Ask about this session", runPhoneSessionMoreStep, { timeoutMs: 75_000 });
  await step('remote app on a phone: New session, a model picked in Options shows in the accent colour', runPhoneOptionsStep, { timeoutMs: 75_000 });
  await step('remote app on a phone: New session, Start is dim while empty and ready with a task', runPhoneStartStep, { timeoutMs: 75_000 });
  await closeRemotePhone();
  // Every built-in theme in light and dark (about 11s locally) runs over 30s on a CI runner.
  // Every built-in theme in both modes: about 11 s here, and 70 s or more on the macOS runners, so it gets room.
  await step('themes: export, import, pick, remove, and every built-in in light and dark', () => runThemeStep(win), { timeoutMs: 150_000 });
  await step('settings › theme › app icon: Signal yellow is checked, saved and applied, the keys, light and dark, Reset to Graphite', () => runAppIconStep(win));
  await step('settings › theme › app icon: Show when Claude is working animates the Dock and stops when off', () => runDockActivityStep(win));
  await step('diagnostics', () => runDiagnosticsStep(win));
  await step('Claude Code mods: band, pane, status, toast, press, Show mods off', () => runModsStep(win), { timeoutMs: 120_000 });
  rendering = (await js(
    "({ diffs: document.querySelectorAll('[data-diff]').length, highlighted: document.querySelectorAll('.shiki').length, codeBlocks: document.querySelectorAll('.code-block').length, todos: document.querySelectorAll('[data-todos]').length, images: document.querySelectorAll('[data-transcript-image] img').length })",
  )) as Record<string, number>;
  const liveCwd = process.env.SESHBOARD_SMOKE_LIVE_CWD;
  if (liveCwd) await step('live session through the UI', () => runLiveSessionStep(win, liveCwd), { timeoutMs: 180_000 });
  // With --only, the engine restart runs only when it is picked.
  if (smokeOnly && !smokeOnly.test(RESTART_STEP)) {
    writeSmokeResult();
    exitApp(0);
    return;
  }
  crashedAt = performance.now();
  engine.crash();
  // The second ready finishes the run; if it never comes, say so instead of waiting for the watchdog.
  setTimeout(() => {
    if (smokeFinished) return;
    void smokeRun.step(RESTART_STEP, async () => 'failed: the renderer did not reconnect within 15s', { cleanup: false }).then(() => {
      writeSmokeResult();
      exitApp(0);
    });
  }, 15_000).unref();
}

app.whenReady().then(() => {
  // Packaged builds take the icon from the bundle's icon.icns, unless another colourway was chosen; in development the
  // Dock gets Graphite's, which is build/icon.png.
  appIcon.apply(preferences.get().appIcon);
  dockActivity.setEnabled(preferences.get().dockActivity);
  keepAwake.apply(preferences.get().keepAwake);
  // The commit shows in brackets after the version, handy when someone reports a bug from a build.
  app.setAboutPanelOptions({
    applicationName: 'Seshboard',
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
      // The sessions ended with the engine that ran them.
      sessionsAwake.apply(false);
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.engineRestarted);
      notifier.connect();
    },
  });
  sendEngineSettings(preferences.get());
  engine.start();
  // The website's screenshots draw a session with demo mods (SESHBOARD_SMOKE_MODS), started as the app opens.
  if (driven && process.env.SESHBOARD_SMOKE_MODS) engine.sendStanding({ type: 'smokeMods' });
  themes.watch();
  installMenu();
  notifier = new Notifier({
    engine,
    window: () => mainWindow ?? undefined,
    focused: () => {
      const win = BrowserWindow.getFocusedWindow();
      return !!win && !win.isMinimized();
    },
    focusedSession: sessionOnScreen,
    openSession,
    openUpcoming: (scheduleId) => sendToWindow(showWindow(), IpcChannel.mainRequested, { kind: 'upcoming', filter: null, scheduleId } satisfies MainWindowRequest),
    openTriggers: (root) => sendToWindow(showWindow(), IpcChannel.mainRequested, { kind: 'project', root, tab: 'triggers' } satisfies MainWindowRequest),
    showAllSessions: () => preferences.get().sessionScope === 'all',
    alerts: () => preferences.get(),
    cachePrefs: () => ({ ...preferences.get(), locale: app.getLocale() }),
    sounds,
    notificationIcon: () => appIcon.windowIcon(),
    // Only the Dock has an icon to animate: Windows and Linux show the window's.
    ...(process.platform === 'darwin' ? { working: (working: boolean) => dockActivity.setWorking(working) } : {}),
    ...(smokeOutDir ? { record: (event: RecordedAlert) => void recordedNotifications.push(event), recordRuns: (runs: ScheduleRunEvent[]) => void recordedScheduleRuns.push(...runs) } : {}),
  });
  notifier.connect();
  // Running pull request checks are read every 30 seconds while a window has focus, else every 5 minutes. A blur
  // comes before the next window's focus, so it looks once that has settled.
  const sendForeground = () => engine.sendStanding({ type: 'foreground', foreground: BrowserWindow.getFocusedWindow() !== null });
  app.on('browser-window-focus', sendForeground);
  app.on('browser-window-blur', () => setTimeout(guarded('foreground update', sendForeground), 100));
  // Scheduled sessions (#173): runs due while the computer slept are dealt with when it wakes. The engine's own timer
  // sees a clock or time zone change within a minute.
  powerMonitor.on('resume', () => engine.send({ type: 'wake' }));
  createWindow();
  updater.start();
  // The packaged app declares the scheme in Info.plist; this also takes it back if another app claimed it.
  // Development and smoke builds leave the system's link handlers alone.
  if (app.isPackaged && !scripted) {
    for (const scheme of [DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEME]) if (!app.isDefaultProtocolClient(scheme)) app.setAsDefaultProtocolClient(scheme);
  }
  const launchLink = linkFromArgv(process.argv);
  if (launchLink) openDeepLink(launchLink);
  else if (!scripted) openFolderArgument(process.argv, process.cwd());

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
  // A last resort for a run that hangs outside a step (each step has its own time limit): it stops once no step has
  // finished for a while, and still writes what ran. Not a limit on the whole run: as steps were added, a slow CI
  // runner needed more than three minutes for all of them and was stopped halfway, every step after it failing.
  if (smokeOutDir) {
    const quietMs = process.env.SESHBOARD_SMOKE_LIVE_CWD ? 300_000 : 180_000;
    let finished = -1;
    let since = Date.now();
    setInterval(() => {
      if (smokeRun.steps.length !== finished) {
        finished = smokeRun.steps.length;
        since = Date.now();
      } else if (Date.now() - since > quietMs) {
        writeSmokeResult();
        exitApp(2);
      }
    }, 5_000).unref();
  }
  if (screenshotOutDir) setTimeout(() => exitApp(2), 240_000).unref();
});

// macOS delivers links here, also the one that launched the app (before 'ready', so it waits in pendingMessages).
app.on('open-url', (event, url) => {
  event.preventDefault();
  openDeepLink(url);
});

app.on('second-instance', (_event, argv, workingDirectory) => {
  // Elsewhere a link arrives as an argument to a second instance, and so does the shell command's folder.
  const link = linkFromArgv(argv);
  if (link) return openDeepLink(link);
  if (openFolderArgument(argv, workingDirectory)) return;
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

app.on('will-quit', () => {
  keepAwake.dispose();
  sessionsAwake.dispose();
});
