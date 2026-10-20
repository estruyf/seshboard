import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { remoteLinkFragment, type RemoteLink } from '@switchboard/protocol/remote-client';
import { Connected, type OpenRequest } from './components/Connected.tsx';
import { LinkEntry } from './components/LinkEntry.tsx';
import { Button, Message } from './components/ui.tsx';
import { PairScreen } from './components/PairScreen.tsx';
import { Computers, keepDisconnected, pushComputers, pushTarget } from './lib/computers.ts';
import { computerId, currentComputer, startFrom, type Paired } from './lib/link.ts';
import { STANDALONE } from './lib/platform.ts';
import { forgetPush, resync } from './lib/push.ts';
import { forgetComputer, lastComputer, loadComputers, rememberComputer, saveComputer } from './lib/storage.ts';

type Screen =
  | { kind: 'loading' }
  | { kind: 'welcome' }
  | { kind: 'bad-link' }
  | { kind: 'other-computer' }
  | { kind: 'pair'; link: Extract<RemoteLink, { kind: 'pair' }>; again: boolean }
  /** Pair another computer, from the computer's menu: how, and a field for its link. */
  | { kind: 'add' }
  | { kind: 'connected' };

/** Read once, before anything takes it out of the address bar: StrictMode runs the effect twice in development, and the second run would see no link. */
const openedWith = window.location.hash;
/** A notification opens the app at its session (`?s=<id>`, public/sw.js), on the computer it came from (`&d=<device id>`). */
const params = new URLSearchParams(window.location.search);
const openSession = params.get('s');
const openDevice = params.get('d');

const same = (a: Paired, b: Paired) => computerId(a) === computerId(b);

/**
 * The remote app: reads the link it was opened with (then takes it out of the address bar, so a pairing secret
 * doesn't linger in the history), pairs or connects, and once connected shows the sessions of every paired computer
 * in one list. Every paired computer stays connected (`Computers`), and a notification from any of them opens its
 * session there. The computer looked at last (`currentId`) is where the app opens again.
 */
export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [pairings, setPairings] = useState<Paired[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const requests = useRef(0);
  const [computers] = useState(
    () =>
      new Computers({
        // Each computer gets the subscription again when it connects: the browser may have changed it.
        onConnected: (computer) => {
          const target = pushTarget(computer);
          if (target) void resync(target, pushComputers(computers.list()));
        },
        // Its name, from its hello: kept, so the offline help and the menu can name it after a reload.
        onPaired: (paired) => {
          void saveComputer(paired).catch(() => {});
          setPairings((list) => list.map((p) => (same(p, paired) ? paired : p)));
        },
      }),
  );
  const list = useSyncExternalStore(computers.subscribe, computers.list);

  const choose = useCallback((id: string) => {
    rememberComputer(id);
    setCurrentId(id);
  }, []);
  const currentRef = useRef(currentId);
  currentRef.current = currentId;

  /** Pairs or connects from a link: the one the page was opened with, or one pasted in. */
  const open = useCallback(
    async (hash: string, first = false) => {
      const kept = await loadComputers().catch(() => [] as Paired[]);
      const fromPush = first && openDevice ? kept.find((p) => p.deviceId === openDevice) : undefined;
      const current = fromPush ?? kept.find((p) => computerId(p) === currentRef.current) ?? currentComputer(kept, lastComputer());
      const start = startFrom(hash, kept, current);
      if (start.kind !== 'connect') {
        setPairings(kept);
        setScreen(start);
        return;
      }
      // A connect link moved the computer to a new address: keep it for next time.
      const moved = kept.map((p) => (same(p, start.paired) ? start.paired : p));
      if (kept.some((p) => same(p, start.paired) && p.address !== start.paired.address)) await saveComputer(start.paired);
      setPairings(moved);
      const id = computerId(start.paired);
      choose(id);
      if (first && openSession) setRequest({ id: ++requests.current, computer: id, sessionId: openSession, launch: true });
      setScreen({ kind: 'connected' });
    },
    [choose],
  );

  useEffect(() => {
    if (window.location.hash || window.location.search) history.replaceState(null, '', window.location.pathname);
    void open(openedWith, true);
  }, [open]);

  // One connection per paired computer; closed when the app goes (StrictMode runs this twice, and the sync below connects again).
  useEffect(() => () => computers.stop(), [computers]);
  useEffect(() => computers.sync(pairings), [computers, pairings]);

  // A tap on a notification while the app is open comes from the service worker as a message, with the device id of
  // the computer it came from; an answer from its Deny or Allow too, once this page asks for it.
  const connected = screen.kind === 'connected';
  useEffect(() => {
    if (!connected) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; sessionId?: unknown; requestId?: unknown; behavior?: unknown; deviceId?: unknown } | null;
      const from = typeof data?.deviceId === 'string' ? computers.byDevice(data.deviceId) : undefined;
      const computer = from?.id ?? currentRef.current;
      if (!computer || typeof data?.sessionId !== 'string') return;
      if (data.type === 'open-session') setRequest({ id: ++requests.current, computer, sessionId: data.sessionId });
      // Deny or Allow on a notification: answered once connected, if nobody answered first.
      else if (data.type === 'answer' && typeof data.requestId === 'string' && (data.behavior === 'allow' || data.behavior === 'deny'))
        setRequest({ id: ++requests.current, computer, answer: { sessionId: data.sessionId, requestId: data.requestId, behavior: data.behavior } });
      else return;
      if (computer !== currentRef.current) choose(computer);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    // Opened by a notification's button: the service worker holds the answer until this page asks for it.
    navigator.serviceWorker?.controller?.postMessage({ type: 'take-answer' });
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [connected, computers, choose]);

  const paired = async (next: Paired) => {
    await saveComputer(next);
    setPairings((all) => [...all.filter((p) => !same(p, next)), next]);
    choose(computerId(next));
    setScreen({ kind: 'connected' });
  };

  /** Forgets a computer: its pairing, and its part in the notifications. The phone shows the others, or the welcome. */
  const forget = async (id: string) => {
    const computer = list.find((c) => c.id === id);
    if (!computer) return;
    const rest = list.filter((c) => c.id !== computer.id);
    await forgetPush(pushTarget(computer), pushComputers(rest)).catch(() => {});
    keepDisconnected(computer.id, false);
    await forgetComputer(computer.paired).catch(() => {});
    const remaining = pairings.filter((p) => !same(p, computer.paired));
    setPairings(remaining);
    const next = currentComputer(remaining, null);
    if (next) choose(computerId(next));
    else setScreen({ kind: 'welcome' });
  };

  /** Back to the sessions, from a screen that pairs or explains, when there is a computer to go back to. */
  const back = pairings.length ? () => setScreen({ kind: 'connected' }) : null;
  const backButton = back && (
    <Button variant="quiet" onClick={back}>
      Back to your sessions
    </Button>
  );
  const linkEntry = (
    <div className="flex w-full flex-col gap-2">
      <LinkEntry onLink={(fragment) => void open(fragment)} />
      {backButton}
    </div>
  );

  switch (screen.kind) {
    case 'loading':
      return null;
    case 'welcome':
      return (
        <Message title="Switchboard Remote" actions={<LinkEntry onLink={(fragment) => void open(fragment)} />}>
          {STANDALONE ? (
            <>
              Follow and steer your Claude Code sessions from your phone. On your computer, open Switchboard, go to Settings › Remote, turn on <b>Allow access from my phone</b> and click <b>Pair a device</b>. Scan the QR code with your phone's camera, tap <b>Copy link</b> on the page that opens, and paste the link here.
            </>
          ) : (
            <>
              Follow and steer your Claude Code sessions from your phone or another computer. On your computer, open Switchboard, go to Settings › Remote, turn on <b>Allow access from my phone</b>, click <b>Pair a device</b> and scan the QR code with your phone's camera. On another computer, click <b>Copy link</b> under the code and paste the link here.
            </>
          )}
        </Message>
      );
    case 'add':
      return (
        <Message title="Pair another computer" actions={linkEntry}>
          {STANDALONE ? (
            <>
              On the other computer, open Switchboard, go to Settings › Remote, turn on <b>Allow access from my phone</b> and click <b>Pair a device</b>. Scan the QR code with your phone's camera, tap <b>Copy link</b> on the page that opens, and paste the link here. Your other computers stay paired.
            </>
          ) : (
            <>
              On the other computer, open Switchboard, go to Settings › Remote, turn on <b>Allow access from my phone</b> and click <b>Pair a device</b>. Scan the QR code with your phone's camera, or click <b>Copy link</b> under the code and paste the link here. Your other computers stay paired.
            </>
          )}
        </Message>
      );
    case 'bad-link':
      return (
        <Message title="This link doesn't work" actions={linkEntry}>
          Scan the QR code in Settings › Remote on your computer again, or paste its link here.
        </Message>
      );
    case 'other-computer':
      return (
        <Message title="Pair this phone first" actions={linkEntry}>
          This link is for a computer this phone isn't paired with. Click Pair a device in Settings › Remote on that computer and scan its QR code, or paste its link here.
        </Message>
      );
    case 'pair':
      return (
        // A new link starts over, from the name.
        <PairScreen key={remoteLinkFragment(screen.link)} link={screen.link} again={screen.again} onPaired={(next) => void paired(next)} onLink={(fragment) => void open(fragment)} onCancel={back} />
      );
    case 'connected': {
      const computer = list.find((c) => c.id === currentId) ?? list[0];
      // Until the connections are made, just after the pairings were read.
      if (!computer) return null;
      return (
        <Connected
          computers={list}
          focus={computer.id}
          onFocus={(id) => list.some((c) => c.id === id) && choose(id)}
          onSessions={(id, sessions) => computers.setSessions(id, sessions)}
          request={request}
          onAdd={() => setScreen({ kind: 'add' })}
          onForget={(id) => void forget(id)}
        />
      );
    }
  }
}
