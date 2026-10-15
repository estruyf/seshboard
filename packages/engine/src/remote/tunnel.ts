import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { engineAddress } from '@switchboard/protocol';

/**
 * The tunnel that makes Remote reachable from a phone anywhere: one of the tools people already have, started by
 * Switchboard and pointed at Remote's port on `127.0.0.1`. Each gives an `https://` address, read from what the tool
 * prints. See docs/remote-access.md.
 */

export type TunnelTool = 'cloudflare' | 'ngrok' | 'tailscale';

/** How long a tool may take to say its address. */
const START_TIMEOUT_MS = 30_000;

/** The command line for a tool. */
export function tunnelArgs(tool: TunnelTool, port: number, options: { ngrokDomain?: string | null } = {}): string[] {
  const target = `http://127.0.0.1:${port}`;
  switch (tool) {
    case 'cloudflare':
      // A quick tunnel: no account, a new `*.trycloudflare.com` address each time.
      return ['tunnel', '--no-autoupdate', '--url', target];
    case 'ngrok':
      return ['http', target, '--log', 'stdout', '--log-format', 'json', ...(options.ngrokDomain ? ['--url', `https://${options.ngrokDomain}`] : [])];
    case 'tailscale':
      // In the foreground, so the address goes away when Switchboard stops it.
      return ['serve', '--https=443', target];
  }
}

/** The public address in what a tool printed so far, or null while it hasn't said it yet. */
export function tunnelAddress(tool: TunnelTool, output: string): string | null {
  let match: string | null = null;
  if (tool === 'cloudflare') match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(output)?.[0] ?? null;
  if (tool === 'tailscale') match = /https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net\b/i.exec(output)?.[0] ?? null;
  if (tool === 'ngrok') {
    for (const line of output.split('\n')) {
      try {
        const record = JSON.parse(line) as { msg?: unknown; url?: unknown };
        if (typeof record.url === 'string' && record.url.startsWith('https://')) {
          match = record.url;
          break;
        }
      } catch {
        // Not a JSON line.
      }
    }
  }
  return match ? engineAddress(match.toLowerCase()) : null;
}

/** Why a tool stopped, in its own words: the last lines it printed (JSON logs give their `err` or `msg`). */
export function tunnelError(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => {
      try {
        const record = JSON.parse(line) as { err?: unknown; msg?: unknown; lvl?: unknown };
        if (record.lvl !== 'eror' && record.lvl !== 'crit' && typeof record.err !== 'string') return '';
        return typeof record.err === 'string' ? record.err : typeof record.msg === 'string' ? record.msg : '';
      } catch {
        return line;
      }
    })
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.slice(-3).join(' ').replace(/\s+/g, ' ');
  return text.length > 300 ? `${text.slice(0, 297)}...` : text || 'It stopped without saying why.';
}

const NAMES: Record<TunnelTool, string> = { cloudflare: 'cloudflared', ngrok: 'ngrok', tailscale: 'tailscale' };

/** Where a tool is: its usual install places first (an app started from the Dock doesn't get the shell's PATH), then PATH. */
export function findTool(tool: TunnelTool, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const windows = platform === 'win32';
  const file = windows ? `${NAMES[tool]}.exe` : NAMES[tool];
  const places: string[] = [];
  if (windows) {
    const programFiles = [env.ProgramFiles ?? 'C:\\Program Files', env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'];
    if (tool === 'tailscale') places.push(...programFiles.map((dir) => `${dir}\\Tailscale\\tailscale.exe`));
    if (tool === 'cloudflare') places.push(...programFiles.map((dir) => `${dir}\\cloudflared\\cloudflared.exe`));
    if (env.LOCALAPPDATA) places.push(`${env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\${file}`);
  } else {
    if (tool === 'tailscale' && platform === 'darwin') places.push('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
    places.push(`/opt/homebrew/bin/${file}`, `/usr/local/bin/${file}`, `/usr/bin/${file}`, join(homedir(), '.local', 'bin', file));
  }
  for (const dir of (env.PATH ?? env.Path ?? '').split(windows ? ';' : delimiter)) if (dir) places.push(windows ? `${dir}\\${file}` : join(dir, file));
  return places.find((path) => exists(path)) ?? null;
}

export interface TunnelOptions {
  tool: TunnelTool;
  port: number;
  ngrokDomain?: string | null;
  /** The tool's binary (`findTool`). */
  binary: string;
  /** Tests: run this instead of the tool. */
  command?: { file: string; args: string[] };
  timeoutMs?: number;
}

/** One running tunnel: `start` resolves with its address; `onExit` hears when it stops by itself. */
export class Tunnel {
  private child: ChildProcess | null = null;
  private stopped = false;
  private exitListener: ((message: string) => void) | null = null;

  constructor(private readonly options: TunnelOptions) {}

  start(): Promise<string> {
    const { tool, port, binary } = this.options;
    const file = this.options.command?.file ?? binary;
    const args = this.options.command?.args ?? tunnelArgs(tool, port, { ngrokDomain: this.options.ngrokDomain ?? null });
    return new Promise((resolve, reject) => {
      let output = '';
      let address: string | null = null;
      const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      const timer = setTimeout(() => {
        reject(new Error(`${NAMES[tool]} didn't give an address in time. ${tunnelError(output)}`));
        this.stop();
      }, this.options.timeoutMs ?? START_TIMEOUT_MS);
      const read = (chunk: Buffer) => {
        // Only the tail matters, for the address and for an error.
        output = (output + chunk.toString('utf8')).slice(-20_000);
        if (address) return;
        address = tunnelAddress(tool, output);
        if (address) {
          clearTimeout(timer);
          resolve(address);
        }
      };
      child.stdout?.on('data', read);
      child.stderr?.on('data', read);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`${NAMES[tool]} couldn't start: ${error.message}`));
      });
      child.on('exit', () => {
        clearTimeout(timer);
        this.child = null;
        if (this.stopped) return;
        if (!address) reject(new Error(tunnelError(output)));
        else this.exitListener?.(tunnelError(output));
      });
    });
  }

  /** Called once if the tool stops by itself after it gave its address. */
  onExit(listener: (message: string) => void): void {
    this.exitListener = listener;
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }
}
