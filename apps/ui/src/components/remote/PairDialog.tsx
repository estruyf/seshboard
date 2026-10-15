import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { Contract, RemoteStatus, RpcClient } from '@switchboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';

type Client = RpcClient<Contract>;

/**
 * A QR code for a link. Always dark on white whatever the theme: phone cameras read that best. It is an image of an
 * SVG `data:` URL, so no markup from the library goes into the page.
 */
function QrImage({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then((svg) => current && setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`));
    return () => {
      current = false;
    };
  }, [url]);
  return <div className="mx-auto size-56 overflow-hidden rounded-lg">{src && <img src={src} alt={label} className="size-full" data-remote-qr />}</div>;
}

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/**
 * Pair a phone: the QR code (one use, two minutes), then "Pair <name>?" with the code the phone shows, and Allow or
 * Deny. Closing the dialog closes pairing: the QR code stops working and a waiting phone is denied.
 */
export function PairDialog({ client, status, onClose }: { client: Client; status: RemoteStatus; onClose: () => void }) {
  const [offer, setOffer] = useState<{ url: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const request = status.pairing.request;
  const devices = status.devices.length;
  const [devicesBefore] = useState(devices);
  const left = useCountdown(offer && !request ? offer.expiresAt : null);

  const start = () => {
    setError(null);
    void client.call('remote.pair.start', {}).then(setOffer, (e: Error) => setError(e.message));
  };
  useEffect(start, [client]);
  useEffect(() => () => void client.call('remote.pair.cancel', {}).catch(() => {}), [client]);

  // A new device in the list: the phone was allowed.
  useEffect(() => {
    if (devices > devicesBefore) setPaired(status.devices.at(-1)?.name ?? 'Your phone');
  }, [devices, devicesBefore, status.devices]);

  const decide = (allow: boolean) => {
    if (!request) return;
    void client.call('remote.pair.decide', { requestId: request.id, allow }).catch((e: Error) => setError(e.message));
  };

  const expired = offer !== null && !request && !paired && (left === 0 || status.pairing.locked);

  return (
    <Dialog
      title={request ? `Pair ${request.name}?` : 'Pair a phone'}
      subtitle={request ? undefined : 'Scan the code with your phone’s camera.'}
      width="sm"
      onClose={onClose}
      role={request ? 'alertdialog' : 'dialog'}
      footer={
        request ? (
          <>
            <Button onClick={() => decide(false)} data-remote-deny>
              Deny
            </Button>
            <Button variant="primary" onClick={() => decide(true)} data-remote-allow>
              Allow
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{paired ? 'Done' : 'Cancel'}</Button>
        )
      }
      data-remote-pair-dialog
    >
      {paired ? (
        <Notice tone="success">{paired} is paired. It can open your sessions now.</Notice>
      ) : request ? (
        <div className="grid gap-3">
          <p className="text-ui text-muted">Allow it only if your phone shows the same code.</p>
          <p className="text-center font-mono text-hero font-semibold tracking-[0.25em] tabular-nums" data-remote-code>
            {request.code}
          </p>
        </div>
      ) : expired ? (
        <div className="grid justify-items-start gap-3">
          <p className="text-ui text-muted">{status.pairing.locked ? 'Too many failed attempts. Pairing is closed.' : 'This code has expired.'}</p>
          <Button variant="primary" onClick={start}>
            New code
          </Button>
        </div>
      ) : offer ? (
        <div className="grid gap-3">
          <QrImage url={offer.url} label="QR code to pair a phone" />
          <p className="text-center text-meta text-muted">
            Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}. Your computer will ask you to allow the phone.
          </p>
        </div>
      ) : null}
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}

/** For phones already paired: the tunnel's new address, without a secret. Scanning it doesn't pair anything. */
export function LinkDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void client.call('remote.connectLink', {}).then(({ url }) => setUrl(url), (e: Error) => setError(e.message));
  }, [client]);
  return (
    <Dialog title="Show the address to paired phones" subtitle="Scan it with a phone that is already paired, after the tunnel’s address changed." width="sm" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {url && <QrImage url={url} label="QR code with this computer's address" />}
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}
