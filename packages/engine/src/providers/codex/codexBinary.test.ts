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
  const codex = `${npm}\\node_modules\\@openai\\codex`;
  const nested = `${codex}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
  const hoisted = `${npm}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
  const vendored = `${codex}\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
  const files = (present: string[]) => ({ exists: (path: string) => present.includes(path) });
  const PATH = `C:\\Program Files\\nodejs;${npm}`;

  it("runs the native codex.exe from the platform package, not npm's node script", () => {
    expect(npmCodex({ PATH }, 'win32', files([`${npm}\\codex.cmd`, nested, vendored]), 'x64')).toEqual({ path: nested, args: [] });
    expect(npmCodex({ PATH }, 'win32', files([`${npm}\\codex.cmd`, hoisted, vendored]), 'x64')).toEqual({ path: hoisted, args: [] });
  });

  it("falls back to Codex's own vendor folder, and picks the architecture's", () => {
    expect(npmCodex({ PATH }, 'win32', files([`${npm}\\codex.cmd`, vendored]), 'x64')).toEqual({ path: vendored, args: [] });
    const arm = `${codex}\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\bin\\codex.exe`;
    expect(npmCodex({ PATH }, 'win32', files([`${npm}\\codex.cmd`, nested, arm]), 'arm64')).toEqual({ path: arm, args: [] });
  });

  it("finds npm's default global folder when it isn't on PATH", () => {
    expect(npmCodex({ PATH: 'C:\\Windows', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', files([`${npm}\\codex.cmd`, nested]), 'x64')).toEqual({ path: nested, args: [] });
  });

  it('is null without the .cmd or the exe, on an architecture Codex has no build for, and elsewhere than Windows', () => {
    expect(npmCodex({ PATH }, 'win32', files([nested]), 'x64')).toBeNull();
    expect(npmCodex({ PATH }, 'win32', files([`${npm}\\codex.cmd`]), 'x64')).toBeNull();
    expect(npmCodex({ PATH }, 'win32', files([`${npm}\\codex.cmd`, nested]), 'ia32')).toBeNull();
    expect(npmCodex({ PATH }, 'darwin', files([`${npm}\\codex.cmd`, nested]), 'x64')).toBeNull();
  });
});
