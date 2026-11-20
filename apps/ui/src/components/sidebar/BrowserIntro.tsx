import { Globe } from 'lucide-react';
import { openBrowserView } from '../../state/browserViewStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { BROWSER_DETAIL } from '../general/visualsCopy.ts';
import { Button } from '../ui/Button.tsx';

/**
 * Once, after the update that brought the browser (on by default): a card above the sidebar's footer that says what it
 * does, with Open browser and Got it. Either answer is final (`browserIntro: 'done'`); Settings › General › Browser
 * turns it off.
 */
export function BrowserIntro() {
  const shown = usePreferences((s) => s.prefs.browserIntro === 'ask' && s.prefs.browserEnabled);
  if (!shown) return null;
  const done = () => usePreferences.getState().update({ browserIntro: 'done' });
  const open = () => {
    done();
    openBrowserView();
  };
  return (
    <section aria-label="New: a browser in Seshboard" className="mx-3 grid gap-2 rounded-lg bg-text/6 p-3" data-browser-intro>
      <h2 className="flex items-center gap-2 text-ui font-semibold text-text">
        <Globe size={14} aria-hidden className="shrink-0 text-accent-ink" />
        New: a browser in Seshboard
      </h2>
      <p className="text-meta text-muted">{BROWSER_DETAIL}</p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={open} data-browser-intro-open>
          Open browser
        </Button>
        <Button size="sm" onClick={done} data-browser-intro-later>
          Got it
        </Button>
      </div>
    </section>
  );
}
