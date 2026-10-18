/**
 * Entry point of the engine utilityProcess. Main forks this once and hands it
 * one MessagePort per window; everything the UI needs goes over those ports.
 */
import { readFileSync } from 'node:fs';
import { createEngine, type DemoUsage, type TrashScope } from '@switchboard/engine';
import { ARCHIVE_AFTER_DAYS, clampDays, DEFAULT_AUTO_MODEL, DELETE_AFTER_DAYS, sanitizeAutoModel } from '@switchboard/protocol/bridge';
import { mainPortTransport } from '../shared/mainPortTransport.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const dataDir = argValue('--data-dir');
if (!dataDir) {
  console.error('[engine] missing --data-dir');
  process.exit(1);
}

/** Moving files to the Trash needs Electron's shell, which lives in the main process. */
let nextTrashId = 1;
const pendingTrash = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
const trash = (paths: string[], scope: TrashScope) =>
  new Promise<void>((resolve, reject) => {
    const id = nextTrashId++;
    pendingTrash.set(id, { resolve, reject });
    process.parentPort.postMessage({ type: 'trash', id, paths, ...scope });
  });

const appVersion = argValue('--app-version') ?? '0.0.0';

/** Remote's keys, from main, which keeps them in the system's keychain (see main/remoteIdentity.ts). */
let nextIdentityId = 1;
const pendingIdentity = new Map<number, (secret: Uint8Array | null) => void>();
const remoteKey = (key: 'identity' | 'device') => () =>
  new Promise<Uint8Array | null>((resolve) => {
    const id = nextIdentityId++;
    pendingIdentity.set(id, resolve);
    process.parentPort.postMessage({ type: 'remote-identity', id, key });
  });

/** The website's screenshots give the demo logins plan numbers (SWITCHBOARD_DEMO_USAGE, a JSON file). */
function demoUsage(): DemoUsage | undefined {
  const file = process.env.SWITCHBOARD_DEMO_USAGE;
  if (!file) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DemoUsage;
  } catch (error) {
    console.error(`[engine] SWITCHBOARD_DEMO_USAGE unreadable: ${(error as Error).message}`);
    return undefined;
  }
}

const engine = createEngine({
  dataDir,
  trash,
  // The VS Code companion connects over a socket; SWITCHBOARD_NO_COMPANION=1 leaves it closed.
  ...(process.env.SWITCHBOARD_NO_COMPANION === '1' ? {} : { companion: { appVersion } }),
  // Remote, for a paired phone. SWITCHBOARD_REMOTE_APP_URL points it at a development build of the remote app
  // (`npm run dev:remote`); SWITCHBOARD_NO_REMOTE=1 leaves it out.
  ...(process.env.SWITCHBOARD_NO_REMOTE === '1'
    ? {}
    : { remote: { appVersion, identity: remoteKey('identity'), deviceKey: remoteKey('device'), ...(process.env.SWITCHBOARD_REMOTE_APP_URL ? { appUrl: process.env.SWITCHBOARD_REMOTE_APP_URL } : {}) } }),
  // The smoke test points the Claude Code check at a mock registry and must never run an update.
  claudeUpdates: { allowUpdate: process.env.SWITCHBOARD_NO_CLAUDE_UPDATE !== '1' },
  onLog: (entry) => console.error(`[engine] ${entry.level}: ${entry.message}`),
  demoUsage: demoUsage(),
  // The smoke test and the screenshots: Auto model picks without calling a model.
  stubRouter: process.env.SWITCHBOARD_STUB_ROUTER === '1',
  stubSideQuestions: process.env.SWITCHBOARD_STUB_BTW === '1',
  stubCatchUp: process.env.SWITCHBOARD_STUB_CATCHUP === '1',
  // The smoke test and the screenshots: Clone from GitHub clones from a folder of local repositories, never the network.
  ...(process.env.SWITCHBOARD_CLONE_SOURCE ? { cloneSource: process.env.SWITCHBOARD_CLONE_SOURCE } : {}),
});

// One misbehaving session must never take the whole engine (and every other session) down.
process.on('uncaughtException', (error) => engine.log('error', `Uncaught: ${error.stack ?? error.message}`));
process.on('unhandledRejection', (reason) =>
  engine.log('error', `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`),
);

process.parentPort.on('message', (event) => {
  const data = event.data as { type?: unknown; id?: number; error?: string; archiveAfterDays?: unknown; deleteArchived?: { enabled?: unknown; afterDays?: unknown }; prefs?: unknown } | null;
  // Settings › Conversation › Auto model, from main's preferences.
  if (data?.type === 'autoModel') {
    engine.setAutoModel(sanitizeAutoModel(data.prefs) ?? DEFAULT_AUTO_MODEL);
    return;
  }
  // Settings › Conversation › Catch-up's "Write catch-up summaries with Haiku".
  if (data?.type === 'catchUp') {
    engine.setCatchUpSummaries((data as { summaries?: unknown }).summaries !== false);
    return;
  }
  // The smoke run's mods step.
  if (data?.type === 'smokeMods') {
    void engine.startModsSmoke();
    return;
  }
  // Whether a window has focus: running pull request checks are read less often without one.
  if (data?.type === 'foreground') {
    engine.setForeground((data as { foreground?: unknown }).foreground !== false);
    return;
  }
  // Settings › Mods › Show mods.
  if (data?.type === 'mods') {
    engine.setShowMods((data as { show?: unknown }).show !== false);
    return;
  }
  // Settings › General › Use Claude in Chrome.
  if (data?.type === 'chrome') {
    engine.setChrome((data as { enabled?: unknown }).enabled === true);
    return;
  }
  // Settings › Conversation › Resume after a usage limit resets.
  if (data?.type === 'limits') {
    engine.setResumeAtLimit((data as { resume?: unknown }).resume === 'always' ? 'always' : 'ask');
    return;
  }
  // Settings › Sessions, from main's preferences (sent at start and after each change).
  if (data?.type === 'retention') {
    const archiveAfterDays = clampDays(data.archiveAfterDays, ARCHIVE_AFTER_DAYS) ?? ARCHIVE_AFTER_DAYS.default;
    const afterDays = clampDays(data.deleteArchived?.afterDays, DELETE_AFTER_DAYS) ?? DELETE_AFTER_DAYS.default;
    engine.setRetention({ archiveAfterDays, deleteArchived: { enabled: data.deleteArchived?.enabled === true, afterDays } });
    return;
  }
  if (data?.type === 'remote-identity-result' && typeof data.id === 'number') {
    const secret = (data as { secret?: unknown }).secret;
    const bytes = typeof secret === 'string' ? new Uint8Array(Buffer.from(secret, 'base64')) : null;
    pendingIdentity.get(data.id)?.(bytes?.length === 32 ? bytes : null);
    pendingIdentity.delete(data.id);
    return;
  }
  if (data?.type === 'trash-result' && typeof data.id === 'number') {
    const pending = pendingTrash.get(data.id);
    pendingTrash.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve();
    return;
  }
  const port = event.ports[0];
  if ((event.data as { type?: unknown } | null)?.type !== 'connect' || !port) return;
  const detach = engine.attach(mainPortTransport(port));
  port.on('close', detach);
});

engine.log('info', `Engine started (pid ${process.pid})`);
