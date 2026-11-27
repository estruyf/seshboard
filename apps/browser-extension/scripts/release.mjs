// Builds the extension for the stores and packs it, into releases/:
// - seshboard-extension-v<version>-chromium.zip: the Chrome Web Store and Edge Add-ons. The manifest's `key` (which
//   pins the id of a build loaded unpacked) is left out: the store refuses it and gives the extension its own id.
// - seshboard-extension-v<version>-firefox.zip: addons.mozilla.org.
// - seshboard-extension-v<version>-source.zip: AMO asks for the source of bundled code. It holds what a reviewer
//   needs to build it again: this folder, packages/protocol and the root's package files (README-SOURCE.md says how).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = resolve(import.meta.dirname, '..');
const repo = resolve(here, '..', '..');
const releases = join(here, 'releases');
mkdirSync(releases, { recursive: true });

const run = (command, args, cwd = here) => execFileSync(command, args, { cwd, stdio: 'inherit' });
rmSync(join(here, 'dist', 'chrome'), { recursive: true, force: true });
rmSync(join(here, 'dist', 'firefox'), { recursive: true, force: true });
run('npx', ['extension', 'build', '--browser', 'chrome']);
run('npx', ['extension', 'build', '--browser', 'firefox']);

const version = JSON.parse(readFileSync(join(here, 'dist', 'chrome', 'manifest.json'), 'utf8')).version;
const name = (target) => join(releases, `seshboard-extension-v${version}-${target}.zip`);

// Chromium: a copy without `key`.
const store = join(here, 'dist', 'chromium-store');
rmSync(store, { recursive: true, force: true });
cpSync(join(here, 'dist', 'chrome'), store, { recursive: true });
const manifest = JSON.parse(readFileSync(join(store, 'manifest.json'), 'utf8'));
delete manifest.key;
writeFileSync(join(store, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const [target, folder] of [['chromium', store], ['firefox', join(here, 'dist', 'firefox')]]) {
  rmSync(name(target), { force: true });
  run('zip', ['-qr', name(target), '.', '-x', '*.DS_Store'], folder);
  console.log(`Created ${name(target)}`);
}

// The source, from git (only what is committed), with a note on how to build it.
rmSync(name('source'), { force: true });
const paths = ['package.json', 'package-lock.json', 'tsconfig.base.json', 'apps/browser-extension', 'packages/protocol'].filter((path) => existsSync(join(repo, path)));
run('git', ['archive', '--format=zip', '-o', name('source'), 'HEAD', ...paths], repo);
const note = join(releases, 'README-SOURCE.md');
writeFileSync(
  note,
  [
    '# Building the Seshboard extension from source',
    '',
    `Node ${process.versions.node} and npm. From the root of this archive:`,
    '',
    '```bash',
    'npm install --workspace @seshboard/browser-extension --include-workspace-root',
    'cd apps/browser-extension',
    'npx extension build --browser firefox',
    '```',
    '',
    'The add-on is then in apps/browser-extension/dist/firefox.',
    '',
  ].join('\n'),
);
run('zip', ['-qj', name('source'), note]);
rmSync(note);
console.log(`Created ${name('source')}`);
