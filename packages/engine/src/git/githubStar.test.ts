import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubStarStatus, starStatusOf, starSeshboard, StarFailure } from './githubStar.ts';
import type { GhCommand } from './pullRequest.ts';

describe('star status', () => {
  it('reads what gh api answered', () => {
    expect(starStatusOf({ code: 0, stdout: '', stderr: '', missing: false })).toBe('starred');
    expect(starStatusOf({ code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n', missing: false })).toBe('not-starred');
    expect(starStatusOf({ code: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)\n', missing: false })).toBe('unavailable');
    expect(starStatusOf({ code: null, stdout: '', stderr: 'spawn gh ENOENT', missing: true })).toBe('unavailable');
  });
});

describe('starring through gh', () => {
  let scratch: string;
  let gh: GhCommand;
  const env = (mode = 'ok') => ({ PATH: process.env.PATH ?? '', FAKE_GH_LOG: join(scratch, 'gh.json'), FAKE_GH_MODE: mode });
  const ghLog = () => JSON.parse(readFileSync(join(scratch, 'gh.json'), 'utf8')) as { argv: string[] };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'sb-star-'));
    const script = join(scratch, 'fake-gh.mjs');
    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
writeFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ argv }));
const mode = process.env.FAKE_GH_MODE;
if (mode === 'not-starred') { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
if (mode === 'signed-out') { process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\\n'); process.exit(4); }
if (mode === 'offline') { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
`,
    );
    gh = { file: process.execPath, args: [script] };
  });

  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('asks GitHub whether Seshboard is starred', async () => {
    expect(await githubStarStatus(gh, scratch, env())).toBe('starred');
    expect(ghLog().argv).toEqual(['api', '--silent', '/user/starred/estruyf/switchboard']);
    expect(await githubStarStatus(gh, scratch, env('not-starred'))).toBe('not-starred');
    expect(await githubStarStatus(gh, scratch, env('offline'))).toBe('unavailable');
  });

  it('stars it with a PUT', async () => {
    await starSeshboard(gh, scratch, env());
    expect(ghLog().argv).toEqual(['api', '--silent', '--method', 'PUT', '/user/starred/estruyf/switchboard']);
  });

  it('says why starring failed', async () => {
    const code = (mode: string, command = gh) => starSeshboard(command, scratch, env(mode)).then(() => null, (error: StarFailure) => error.code);
    expect(await code('signed-out')).toBe('GH_AUTH');
    expect(await code('offline')).toBe('GH_FAILED');
    expect(await code('ok', { file: join(scratch, 'no-such-gh'), args: [] })).toBe('GH_MISSING');
  });
});
