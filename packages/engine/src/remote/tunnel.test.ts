import { afterEach, describe, expect, it } from 'vitest';
import { findTool, Tunnel, tunnelAddress, tunnelArgs, tunnelError } from './tunnel.ts';

const tunnels: Tunnel[] = [];
afterEach(() => tunnels.splice(0).forEach((t) => t.stop()));

/** A stand-in for a tool: Node printing what the tool would, then staying up (or not). */
const fake = (script: string) => ({ file: process.execPath, args: ['-e', script] });

describe('tunnel tools', () => {
  it('point at Remote on this computer only', () => {
    expect(tunnelArgs('cloudflare', 47615)).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:47615']);
    expect(tunnelArgs('ngrok', 47615, { ngrokDomain: 'me.ngrok-free.app' })).toEqual(['http', 'http://127.0.0.1:47615', '--log', 'stdout', '--log-format', 'json', '--url', 'https://me.ngrok-free.app']);
    expect(tunnelArgs('tailscale', 47615)).toEqual(['serve', '--https=443', 'http://127.0.0.1:47615']);
  });

  it('read the address each tool prints', () => {
    expect(tunnelAddress('cloudflare', '2026 INF |  https://quiet-river-a1b2.trycloudflare.com  |\n')).toBe('https://quiet-river-a1b2.trycloudflare.com');
    expect(tunnelAddress('cloudflare', 'INF Starting tunnel')).toBeNull();
    expect(tunnelAddress('ngrok', '{"lvl":"info","msg":"started tunnel","obj":"tunnels","url":"https://me.ngrok-free.app"}\n')).toBe('https://me.ngrok-free.app');
    expect(tunnelAddress('tailscale', 'Available within your tailnet:\n\nhttps://mystic.tail1234.ts.net/\n|-- proxy http://127.0.0.1:47615\n')).toBe('https://mystic.tail1234.ts.net');
    // Only what the tool says about itself: another site in its output is not the address.
    expect(tunnelAddress('cloudflare', 'see https://developers.cloudflare.com/docs')).toBeNull();
  });

  it('say why a tool stopped in its own words', () => {
    expect(tunnelError('{"lvl":"eror","msg":"session closing","err":"authentication failed: Your account is not authorized"}\n')).toBe('authentication failed: Your account is not authorized');
    expect(tunnelError('Serve is not enabled on your tailnet.\nTo enable, visit:\n  https://login.tailscale.com/f/serve\n')).toBe('Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve');
    expect(tunnelError('')).toBe('It stopped without saying why.');
  });

  it('are found where they are usually installed, then on the PATH', () => {
    const at = (...paths: string[]) => (path: string) => paths.includes(path);
    expect(findTool('cloudflare', 'darwin', { PATH: '/usr/bin' }, at('/opt/homebrew/bin/cloudflared'))).toBe('/opt/homebrew/bin/cloudflared');
    expect(findTool('tailscale', 'darwin', { PATH: '' }, at('/Applications/Tailscale.app/Contents/MacOS/Tailscale'))).toBe('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
    expect(findTool('ngrok', 'darwin', { PATH: '/x/bin:/y/bin' }, at('/y/bin/ngrok'))).toBe('/y/bin/ngrok');
    expect(findTool('ngrok', 'win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: '' }, at('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\ngrok.exe'))).toBe('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\ngrok.exe');
    expect(findTool('cloudflare', 'darwin', { PATH: '' }, at())).toBeNull();
  });
});

describe('a running tunnel', () => {
  it('gives its address, and says when it stops by itself', async () => {
    const tunnel = new Tunnel({ tool: 'cloudflare', port: 1, binary: '', command: fake("console.error('|  https://a-b.trycloudflare.com  |'); setTimeout(() => { console.error('ERR connection lost'); process.exit(1) }, 200)") });
    tunnels.push(tunnel);
    const stopped = new Promise<string>((resolve) => tunnel.onExit(resolve));
    expect(await tunnel.start()).toBe('https://a-b.trycloudflare.com');
    expect(await stopped).toContain('ERR connection lost');
  });

  it('fails with the tool\'s words when it stops before giving an address', async () => {
    const tunnel = new Tunnel({ tool: 'ngrok', port: 1, binary: '', command: fake(`console.log(JSON.stringify({ lvl: 'crit', msg: 'command failed', err: 'authentication failed: no authtoken' })); process.exit(1)`) });
    tunnels.push(tunnel);
    await expect(tunnel.start()).rejects.toThrow('authentication failed: no authtoken');
  });

  it('gives up when no address comes', async () => {
    const tunnel = new Tunnel({ tool: 'tailscale', port: 1, binary: '', timeoutMs: 200, command: fake('setInterval(() => {}, 1000)') });
    tunnels.push(tunnel);
    await expect(tunnel.start()).rejects.toThrow("tailscale didn't give an address in time");
  });

  it('is quiet when Switchboard stops it', async () => {
    const tunnel = new Tunnel({ tool: 'cloudflare', port: 1, binary: '', command: fake("console.error('https://a-b.trycloudflare.com'); setInterval(() => {}, 1000)") });
    let heard = false;
    tunnel.onExit(() => (heard = true));
    await tunnel.start();
    tunnel.stop();
    await new Promise((r) => setTimeout(r, 200));
    expect(heard).toBe(false);
  });
});
