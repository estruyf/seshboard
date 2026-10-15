import type { RemoteStatus, RemoteTunnel } from '@switchboard/protocol/client';

/** The tunnels Settings › Remote offers, with what each needs. Pure, so the wording is easy to check. */
export const TUNNELS: Array<{ id: RemoteTunnel; label: string; detail: string; tool: string; install: string | null; note: string | null }> = [
  {
    id: 'cloudflare',
    label: 'Cloudflare quick tunnel',
    detail: 'No account needed. The address changes each time it starts.',
    tool: 'cloudflared',
    install: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    note: 'When the address changes, show it to your paired phones again. They don’t have to pair again.',
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    detail: 'Only your own devices on your tailnet can reach it. Turn on HTTPS certificates for your tailnet first.',
    tool: 'Tailscale',
    install: 'https://tailscale.com/download',
    note: null,
  },
  {
    id: 'ngrok',
    label: 'ngrok',
    detail: 'Needs an ngrok account. Add your ngrok domain for an address that stays the same.',
    tool: 'ngrok',
    install: 'https://ngrok.com/download',
    note: 'ngrok’s free plan may show phones a warning page that stops the connection.',
  },
  {
    id: 'custom',
    label: 'My own address',
    detail: 'A tunnel or proxy you run yourself that forwards an https:// address to this computer.',
    tool: '',
    install: null,
    note: null,
  },
];

/** The one line that says how Remote is doing. */
export function tunnelLine(status: RemoteStatus): string {
  const name = TUNNELS.find((t) => t.id === status.settings.tunnel)?.label ?? 'The tunnel';
  switch (status.tunnel.state) {
    case 'running':
      return status.connections.length ? `Running. ${status.connections.map((c) => c.name).join(', ')} connected.` : 'Running. No phone connected.';
    case 'starting':
      return `Starting ${name}…`;
    case 'failed':
      return status.settings.tunnel === 'custom' ? 'Add the address that forwards to Remote.' : `${name} isn't running. Switchboard tries again shortly.`;
    case 'off':
      return 'Off';
  }
}

/** "5 minutes ago", "yesterday", or a date. */
export function remoteAge(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}
