import { describe, expect, it } from 'vitest';
import { codexCandidates, npmCodex, parseCodexVersion } from './codexBinary.ts';

describe('parseCodexVersion', () => {
  it('reads the version codex --version prints', () => {
    expect(parseCodexVersion('codex-cli 0.167.0\n')).toBe('0.167.0');
    expect(parseCodexVersion('codex-cli 0.168.0-alpha.2')).toBe('0.168.0-alpha.2');
    expect(parseCodexVersion('something else')).toBeNull();
  });
});

describe('codexCandidates', () => {
  it('looks on PATH first, then the installer, Homebrew and npm on macOS and Linux', () => {
    expect(codexCandidates({ PATH: '/usr/bin:/home/me/.local/bin', npm_config_prefix: '/home/me/.npm' }, '/home/me', 'darwin')).toEqual([
      '/usr/bin/codex',
      '/home/me/.local/bin/codex',
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      '/home/me/.npm/bin/codex',
      '/home/me/.npm-global/bin/codex',
    ]);
  });

  it('looks for codex.exe on Windows', () => {
    expect(codexCandidates({ PATH: 'C:\\Windows;C:\\Tools' }, 'C:\\Users\\me', 'win32')).toEqual(['C:\\Windows\\codex.exe', 'C:\\Tools\\codex.exe', 'C:\\Users\\me\\.local\\bin\\codex.exe']);
  });
});

describe('npmCodex', () => {
  const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const script = `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`;
  const files = (present: string[]) => ({
    exists: (path: string) => present.includes(path),
    readJson: (path: string) => (path === `${npm}\\node_modules\\@openai\\codex\\package.json` ? { bin: { codex: 'bin/codex.js' } } : null),
  });
  const all = [node, `${npm}\\codex.cmd`, script];

  it("runs npm's script with the user's node on Windows", () => {
    expect(npmCodex({ PATH: `C:\\Program Files\\nodejs;${npm}` }, 'win32', files(all))).toEqual({ path: node, args: [script] });
  });

  it("finds npm's default global folder when it isn't on PATH", () => {
    expect(npmCodex({ PATH: 'C:\\Program Files\\nodejs', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', files(all))).toEqual({ path: node, args: [script] });
  });

  it('is null without node, the .cmd or the script, and elsewhere than Windows', () => {
    const PATH = `C:\\Program Files\\nodejs;${npm}`;
    expect(npmCodex({ PATH }, 'win32', files(all.slice(1)))).toBeNull();
    expect(npmCodex({ PATH }, 'win32', files([all[0]!, all[2]!]))).toBeNull();
    expect(npmCodex({ PATH }, 'win32', files(all.slice(0, 2)))).toBeNull();
    expect(npmCodex({ PATH }, 'darwin', files(all))).toBeNull();
  });
});
