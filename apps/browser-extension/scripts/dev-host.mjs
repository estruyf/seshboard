// Chrome looks for a user's native messaging hosts in its profile folder, and `extension dev` runs Chrome with a
// profile of its own (extension.config.js). This copies the host manifest Seshboard wrote (Settings › Browser
// extension › Connect browsers) into that profile, so the extension reaches Seshboard in development too.
// Firefox and Windows read the manifest from one place for every profile: nothing to do there.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const browser = process.argv[2] ?? 'chrome';
const HOST_NAME = 'app.seshboard.companion';
if (process.platform === 'win32') process.exit(0);

const appData = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.config');
// A development build's host first: that is the app running next to this.
const source = ['Seshboard Dev', 'Seshboard'].map((name) => join(appData, name, 'browser-extension', 'chromium.json')).find((file) => existsSync(file));
if (!source) {
  console.warn('Seshboard has not connected the browsers yet: open Settings › Browser extension and press Connect browsers, then run this again.');
  process.exit(0);
}
const target = resolve(import.meta.dirname, '..', 'dist', `extension-profile-${browser}`, 'NativeMessagingHosts');
mkdirSync(target, { recursive: true });
copyFileSync(source, join(target, `${HOST_NAME}.json`));
console.log(`Native messaging host for the ${browser} dev profile: ${source}`);
