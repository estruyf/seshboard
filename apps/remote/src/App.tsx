import { useCallback, useEffect, useState } from 'react';
import { remoteLinkFragment } from '@switchboard/protocol/remote-client';
import { Connected } from './components/Connected.tsx';
import { LinkEntry } from './components/LinkEntry.tsx';
import { Message } from './components/ui.tsx';
import { PairScreen } from './components/PairScreen.tsx';
import { startFrom, type Paired, type Start } from './lib/link.ts';
import { STANDALONE } from './lib/platform.ts';
import { forgetPaired, loadPaired, savePaired } from './lib/storage.ts';

type Screen = { kind: 'loading' } | Start;

/** Read once, before anything takes it out of the address bar: StrictMode runs the effect twice in development, and the second run would see no link. */
const openedWith = window.location.hash;
/** A notification opens the app at its session (`?s=<id>`, public/sw.js). */
const openSession = new URLSearchParams(window.location.search).get('s');

/**
 * The remote app: reads the link it was opened with (then takes it out of the address bar, so a pairing secret
 * doesn't linger in the history), pairs or connects, and shows the sessions once connected.
 */
export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  /** Pairs or connects from a link: the one the page was opened with, or one pasted in. */
  const open = useCallback(async (hash: string) => {
    const paired = await loadPaired().catch(() => null);
    const start = startFrom(hash, paired);
    // A connect link moved the computer to a new address: keep it for next time.
    if (start.kind === 'connect' && paired && start.paired.address !== paired.address) await savePaired(start.paired);
    setScreen(start);
  }, []);

  useEffect(() => {
    if (window.location.hash || window.location.search) history.replaceState(null, '', window.location.pathname);
    void open(openedWith);
  }, [open]);

  const connect = async (paired: Paired) => {
    await savePaired(paired);
    setScreen({ kind: 'connect', paired });
  };

  /** The same pairing with something new to keep (the computer's name): saved, without reconnecting. */
  const keep = useCallback((paired: Paired) => {
    void savePaired(paired).catch(() => {});
    setScreen({ kind: 'connect', paired });
  }, []);

  const forget = async () => {
    await forgetPaired();
    setScreen({ kind: 'welcome' });
  };

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
    case 'bad-link':
      return (
        <Message title="This link doesn't work" actions={<LinkEntry onLink={(fragment) => void open(fragment)} />}>
          Scan the QR code in Settings › Remote on your computer again, or paste its link here.
        </Message>
      );
    case 'other-computer':
      return (
        <Message title="Pair this phone first" actions={<LinkEntry onLink={(fragment) => void open(fragment)} />}>
          This link is for a computer this phone isn't paired with. Click Pair a device in Settings › Remote on that computer and scan its QR code, or paste its link here.
        </Message>
      );
    case 'pair':
      return (
        // A new link starts over, from the name.
        <PairScreen key={remoteLinkFragment(screen.link)} link={screen.link} replaces={screen.replaces} onPaired={(paired) => void connect(paired)} onLink={(fragment) => void open(fragment)} />
      );
    case 'connect':
      return <Connected paired={screen.paired} openSession={openSession} onForget={() => void forget()} onPaired={keep} />;
  }
}
