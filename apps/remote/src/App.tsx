import { useEffect, useState } from 'react';
import { Connected } from './components/Connected.tsx';
import { Message } from './components/ui.tsx';
import { PairScreen } from './components/PairScreen.tsx';
import { startFrom, type Paired, type Start } from './lib/link.ts';
import { forgetPaired, loadPaired, savePaired } from './lib/storage.ts';

type Screen = { kind: 'loading' } | Start;

/** Read once, before anything takes it out of the address bar: StrictMode runs the effect twice in development, and the second run would see no link. */
const openedWith = window.location.hash;

/**
 * The remote app: reads the link it was opened with (then takes it out of the address bar, so a pairing secret
 * doesn't linger in the history), pairs or connects, and shows the sessions once connected.
 */
export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  useEffect(() => {
    const hash = openedWith;
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    void loadPaired()
      .catch(() => null)
      .then(async (paired) => {
        const start = startFrom(hash, paired);
        // A connect link moved the computer to a new address: keep it for next time.
        if (start.kind === 'connect' && paired && start.paired.address !== paired.address) await savePaired(start.paired);
        setScreen(start);
      });
  }, []);

  const connect = async (paired: Paired) => {
    await savePaired(paired);
    setScreen({ kind: 'connect', paired });
  };

  const forget = async () => {
    await forgetPaired();
    setScreen({ kind: 'welcome' });
  };

  switch (screen.kind) {
    case 'loading':
      return null;
    case 'welcome':
      return (
        <Message title="Switchboard Remote">
          Follow and steer your Claude Code sessions from your phone or another computer. On your computer, open Switchboard, go to Settings › Remote, turn on <b>Allow access from my phone</b>, click <b>Pair a phone</b> and scan the QR code with your phone's camera. On another computer, click <b>Copy link</b> under the code and open the link here.
        </Message>
      );
    case 'bad-link':
      return <Message title="This link doesn't work">Scan the QR code in Settings › Remote on your computer again.</Message>;
    case 'other-computer':
      return <Message title="Pair this phone first">This link is for a computer this phone isn't paired with. Click Pair a phone in Settings › Remote on that computer and scan its QR code.</Message>;
    case 'pair':
      return <PairScreen link={screen.link} replaces={screen.replaces} onPaired={(paired) => void connect(paired)} />;
    case 'connect':
      return <Connected paired={screen.paired} onForget={() => void forget()} />;
  }
}
