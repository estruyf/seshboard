import { X } from 'lucide-react';
import { useState } from 'react';
import { ANY_SITE, normaliseSite, siteLabel, withSite } from '@seshboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';

/**
 * The sites the browser tools may use in a project without asking (docs/browser.md), such as a staging site or a
 * hosted app a dev server plugs into, or where their scripts may run (`inputLabel` names which). Pages on this
 * computer always can. "Always allow" on a site's card adds one here. A site may be a wildcard (`*.example.com`), and
 * with `anySite` a check box allows every site (`ANY_SITE`); the list stays, hidden, for when it is cleared.
 */
export function BrowserSitesEditor({ sites, onSave, inputLabel = 'Site to allow', anySite = false }: { sites: readonly string[]; onSave(sites: string[]): Promise<void>; inputLabel?: string; anySite?: boolean }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const site = normaliseSite(value);
    if (!site) return setError('Type a web address, such as app.example.com or *.example.com.');
    await save(withSite(sites, site));
    setValue('');
  };
  const any = anySite && sites.includes(ANY_SITE);
  const listed = anySite ? sites.filter((site) => site !== ANY_SITE) : sites;
  return (
    <div className="grid w-full min-w-0 gap-2" data-browser-sites>
      {anySite && (
        <Checkbox checked={any} disabled={busy} onChange={(on) => void save(on ? [...listed, ANY_SITE] : [...listed])} className="text-ui text-text" dataAttrs={{ 'data-browser-site-any': true }}>
          Any site
        </Checkbox>
      )}
      {!any && listed.length > 0 && (
        <ul className="grid gap-1">
          {listed.map((site) => (
            <li key={site} className="flex min-w-0 items-center gap-2 rounded-md bg-text/6 py-1 pr-1 pl-2.5 text-ui" data-browser-site={site}>
              <span className="min-w-0 flex-1 truncate font-mono" data-tooltip={site}>
                {siteLabel(site)}
              </span>
              <Button
                variant="quiet"
                size="sm"
                iconOnly
                icon={<X size={12} aria-hidden />}
                aria-label={`Remove ${siteLabel(site)}`}
                disabled={busy}
                onClick={() => void save(sites.filter((s) => s !== site))}
                data-browser-site-remove
              />
            </li>
          ))}
        </ul>
      )}
      {!any && (
        <form
          className="flex min-w-0 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="app.example.com or *.example.com"
            aria-label={inputLabel}
            spellCheck={false}
            className="field h-8 w-72 max-w-full min-w-0 px-2.5 font-mono text-ui outline-none"
            data-browser-site-input
          />
          <Button type="submit" size="sm" disabled={busy || !value.trim()} aria-busy={busy || undefined} data-browser-site-add>
            {busy ? 'Saving…' : 'Allow'}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-meta text-error">
          {error}
        </p>
      )}
    </div>
  );
}
