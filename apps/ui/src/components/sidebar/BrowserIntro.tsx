import { Globe } from 'lucide-react';
import { openBrowserView } from '../../state/browserViewStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { toast } from '../../state/toastStore.ts';
import { BROWSER_DETAIL } from '../general/visualsCopy.ts';
import { Button } from '../ui/Button.tsx';

/**
 * Once, after the update that brought the browser: a card above the sidebar's footer that says what it does, with Turn
 * on and Not now. Either answer is final (`browserIntro: 'done'`); Settings › General › Browser changes it later.
 */
export function BrowserIntro() {
  const shown = usePreferences((s) => s.prefs.browserIntro === 'ask' && !s.prefs.browserEnabled);
  if (!shown) return null;
  const update = usePreferences.getState().update;
  const turnOn = () => {
    update({ browserEnabled: true, browserIntro: 'done' });
    openBrowserView();
    toast('The browser is on. Find it under the globe above the search.', { icon: 'browser' });
  };
  const notNow = () => {
    update({ browserIntro: 'done' });
    toast('You can turn it on in Settings › General › Browser.');
  };
  return (
    <section aria-label="New: a browser in Seshboard" className="mx-3 grid gap-2 rounded-lg bg-text/6 p-3" data-browser-intro>
      <h2 className="flex items-center gap-2 text-ui font-semibold text-text">
        <Globe size={14} aria-hidden className="shrink-0 text-accent-ink" />
        New: a browser in Seshboard
      </h2>
      <p className="text-meta text-muted">{BROWSER_DETAIL}</p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={turnOn} data-browser-intro-on>
          Turn on
        </Button>
        <Button size="sm" onClick={notNow} data-browser-intro-later>
          Not now
        </Button>
      </div>
    </section>
  );
}
