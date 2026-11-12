import { X } from 'lucide-react';
import { useState } from 'react';
import { normaliseSite, siteLabel, withSite } from '@seshboard/protocol/client';
import { Button } from '../ui/Button.tsx';

/**
 * The sites Claude's browser tools may use in a project without asking (docs/browser.md), such as the SharePoint
 * tenant a web part is tested on. Pages on this computer always can. "Always allow" on a site's prompt adds one here.
 */
export function BrowserSitesEditor({ sites, onSave }: { sites: readonly string[]; onSave(sites: string[]): Promise<void> }) {
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
    if (!site) return setError('Type a web address, such as contoso.sharepoint.com.');
    await save(withSite(sites, site));
    setValue('');
  };
  return (
    <div className="grid w-full min-w-0 gap-2" data-browser-sites>
      {sites.length > 0 && (
        <ul className="grid gap-1">
          {sites.map((site) => (
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
          placeholder="contoso.sharepoint.com"
          aria-label="Site to allow"
          spellCheck={false}
          className="h-8 w-72 max-w-full min-w-0 rounded-md border border-border bg-bg px-2.5 font-mono text-ui text-text outline-none focus:border-accent-ink/60"
          data-browser-site-input
        />
        <Button type="submit" size="sm" disabled={busy || !value.trim()} aria-busy={busy || undefined} data-browser-site-add>
          {busy ? 'Saving…' : 'Allow'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-meta text-error">
          {error}
        </p>
      )}
    </div>
  );
}
