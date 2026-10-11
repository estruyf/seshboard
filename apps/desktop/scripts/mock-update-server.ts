/**
 * A local update feed for testing Switchboard's updater without publishing anything.
 *
 *   node scripts/mock-update-server.ts --dir dist            # serve a real build (latest-mac.yml + .zip, latest.yml + .exe)
 *   node scripts/mock-update-server.ts --fake 0.0.9          # serve a made-up feed offering v0.0.9
 *   node scripts/mock-update-server.ts --fake 0.0.9-nightly.20261006.1
 *
 * Then start Switchboard with SWITCHBOARD_MOCK_UPDATES=1 (and SWITCHBOARD_MOCK_UPDATES_URL if you
 * changed --port). A fake feed is enough to see a check find an update and its release notes; the
 * download then fails, since there is no build behind it. See docs/building-and-signing.md.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    fake: { type: 'string' },
    port: { type: 'string', default: '8484' },
  },
});
const port = Number(values.port);
const dir = values.dir ? resolve(values.dir) : null;
if (!dir && !values.fake) {
  console.error('Pass --dir <folder with latest-mac.yml or latest.yml> or --fake <version>.');
  process.exit(1);
}

/**
 * The feeds for `version`, named the way electron-builder names them: latest-mac.yml with a .zip for macOS, latest.yml
 * with a setup .exe for Windows (nightly-mac.yml and nightly.yml for nightlies).
 */
function fakeFeeds(version: string): Map<string, string> {
  const channel = /-nightly\./.test(version) ? 'nightly' : 'latest';
  return new Map([
    [`${channel}-mac.yml`, fakeFeed(version, `Switchboard-${version}-arm64-mac.zip`)],
    [`${channel}.yml`, fakeFeed(version, `Switchboard-${version}-setup.exe`)],
  ]);
}

function fakeFeed(version: string, file: string): string {
  const sha512 = Buffer.alloc(64).toString('base64');
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    '    size: 1024',
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    'releaseNotes: |',
    '  ### Updates',
    '',
    '  - A made-up release from the mock update server.',
    '  - **Restart to update** installs it (a fake feed has no build, so downloading fails).',
    '',
  ].join('\n');
}

const fake = values.fake ? fakeFeeds(values.fake) : null;

/** The file `path` names inside `dir`, or null if it points anywhere else (`..`, an encoded `/`, a sibling folder). */
function fileIn(dir: string, path: string): string | null {
  const file = resolve(dir, path);
  return file === dir || file.startsWith(dir + sep) ? file : null;
}

createServer((request, response) => {
  let path: string;
  try {
    // Decoded before resolving, so %2e%2e and %2f are checked like the characters they stand for.
    path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '');
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  console.log(`${request.method} /${path}`);
  const feed = fake?.get(path);
  if (feed) {
    response.writeHead(200, { 'content-type': 'text/yaml' });
    response.end(feed);
    return;
  }
  const file = dir ? fileIn(dir, path) : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-length': statSync(file).size });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Mock update feed on http://localhost:${port} (${fake ? `fake ${[...fake.keys()].join(' and ')} offering ${values.fake}` : dir})`);
  console.log(`Start Switchboard with SWITCHBOARD_MOCK_UPDATES=1${port === 8484 ? '' : ` SWITCHBOARD_MOCK_UPDATES_URL=http://localhost:${port}`}`);
});
