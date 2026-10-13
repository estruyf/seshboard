import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ENGINE_PORT_MESSAGE, IpcChannel, type AppInfo, type DeepLinkMessage, type PickedPath, type Preferences, type RendererReadyReport, type SaveImageRequest, type SoundList, type SwitchboardBridge, type ThemeCommand, type UpdateState } from '@switchboard/protocol/bridge';
import type { ThemeFileCheck, ThemeState } from '@switchboard/protocol/theme-format';

// MessagePorts can't cross contextBridge, so forward them to the page with window.postMessage.
ipcRenderer.on(IpcChannel.enginePort, (event) => {
  window.postMessage(ENGINE_PORT_MESSAGE, '*', event.ports);
});

const theme = (command: ThemeCommand) => ipcRenderer.invoke(IpcChannel.themeCommand, command);

const bridge: SwitchboardBridge = {
  platform: process.platform,
  requestEnginePort: () => ipcRenderer.send(IpcChannel.requestEnginePort),
  onEngineRestarted(listener) {
    const handler = () => listener();
    ipcRenderer.on(IpcChannel.engineRestarted, handler);
    return () => ipcRenderer.off(IpcChannel.engineRestarted, handler);
  },
  reportReady: (report: RendererReadyReport) => ipcRenderer.send(IpcChannel.rendererReady, report),
  pickFolder: (defaultPath?: string) => ipcRenderer.invoke(IpcChannel.pickFolder, defaultPath) as Promise<string | null>,
  pickImage: (defaultPath?: string) => ipcRenderer.invoke(IpcChannel.pickImage, defaultPath) as Promise<string | null>,
  pickContextFiles: (defaultPath?: string) => ipcRenderer.invoke(IpcChannel.pickContextFiles, defaultPath) as Promise<PickedPath[]>,
  chooseExportFile: (defaultName: string) => ipcRenderer.invoke(IpcChannel.chooseExportFile, defaultName) as Promise<string | null>,
  chooseImportFile: () => ipcRenderer.invoke(IpcChannel.chooseImportFile) as Promise<string | null>,
  chooseMemoryExport: () => ipcRenderer.invoke(IpcChannel.chooseMemoryExport) as Promise<string[]>,
  saveImage: (request: SaveImageRequest) => ipcRenderer.invoke(IpcChannel.saveImage, request) as Promise<string | null>,
  showSavedImage: (path: string) => ipcRenderer.send(IpcChannel.showSavedImage, path),
  // File.path is gone from Electron; webUtils is how a sandboxed page learns where a dropped file lives.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  reportFocus: (sessionId: string | null) => ipcRenderer.send(IpcChannel.focusSession, sessionId),
  focusWindow: () => ipcRenderer.send(IpcChannel.focusWindow),
  onSelectSession(listener) {
    const handler = (_event: unknown, sessionId: string) => listener(sessionId);
    ipcRenderer.on(IpcChannel.selectSession, handler);
    return () => ipcRenderer.off(IpcChannel.selectSession, handler);
  },
  onQuitRequested(listener) {
    const handler = () => listener();
    ipcRenderer.on(IpcChannel.quitRequested, handler);
    return () => ipcRenderer.off(IpcChannel.quitRequested, handler);
  },
  answerQuit: (answer) => ipcRenderer.send(IpcChannel.quitAnswer, answer),
  // Tiny and read once at startup; synchronous so the first paint has the right layout.
  preferences: ipcRenderer.sendSync(IpcChannel.getPreferences) as Preferences,
  setPreferences: (patch) => ipcRenderer.send(IpcChannel.setPreferences, patch),
  onPreferencesChanged(listener) {
    const handler = (_event: unknown, preferences: Preferences) => listener(preferences);
    ipcRenderer.on(IpcChannel.preferencesChanged, handler);
    return () => ipcRenderer.off(IpcChannel.preferencesChanged, handler);
  },
  onOpenSettings(listener) {
    const handler = (_event: unknown, section: unknown) => listener(section === 'about' ? 'about' : null);
    ipcRenderer.on(IpcChannel.openSettings, handler);
    return () => ipcRenderer.off(IpcChannel.openSettings, handler);
  },
  onToggleShortcuts(listener) {
    const handler = () => listener();
    ipcRenderer.on(IpcChannel.toggleShortcuts, handler);
    return () => ipcRenderer.off(IpcChannel.toggleShortcuts, handler);
  },
  appInfo: ipcRenderer.sendSync(IpcChannel.getAppInfo) as AppInfo,
  updateState: ipcRenderer.sendSync(IpcChannel.getUpdateState) as UpdateState,
  onUpdateState(listener) {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on(IpcChannel.updateState, handler);
    return () => ipcRenderer.off(IpcChannel.updateState, handler);
  },
  update: (command) => ipcRenderer.send(IpcChannel.updateCommand, command),
  // The channel is a preference; main checks again as soon as it changes.
  setUpdateChannel: (channel) => ipcRenderer.send(IpcChannel.setPreferences, { updateChannel: channel }),
  setWindowButtons: (position) => ipcRenderer.send(IpcChannel.windowButtons, position),
  onDeepLink(listener) {
    const handler = (_event: unknown, message: DeepLinkMessage) => listener(message);
    ipcRenderer.on(IpcChannel.deepLink, handler);
    return () => ipcRenderer.off(IpcChannel.deepLink, handler);
  },
  // With the preferences, so the first paint already has the theme's colours.
  themes: ipcRenderer.sendSync(IpcChannel.getThemes) as ThemeState,
  onThemesChanged(listener) {
    const handler = (_event: unknown, state: ThemeState) => listener(state);
    ipcRenderer.on(IpcChannel.themesChanged, handler);
    return () => ipcRenderer.off(IpcChannel.themesChanged, handler);
  },
  chooseThemeFile: () => theme({ kind: 'choose-file' }) as Promise<string | null>,
  checkThemeFile: (path) => theme({ kind: 'check-file', path }) as Promise<ThemeFileCheck>,
  addTheme: (raw, how) => theme({ kind: 'add', raw, how }) as Promise<string>,
  removeTheme: (id) => theme({ kind: 'remove', id }) as Promise<void>,
  duplicateTheme: (id) => theme({ kind: 'duplicate', id }) as Promise<string>,
  exportTheme: (fileName, content) => theme({ kind: 'export', fileName, content }) as Promise<string | null>,
  openThemesFolder: () => void theme({ kind: 'open-folder' }),
  showThemeFile: (id) => void theme({ kind: 'show-file', id }),
  listSounds: () => ipcRenderer.invoke(IpcChannel.listSounds) as Promise<SoundList>,
  playSound: (id, volume) => ipcRenderer.send(IpcChannel.playSound, id, volume),
};

contextBridge.exposeInMainWorld('switchboard', bridge);
