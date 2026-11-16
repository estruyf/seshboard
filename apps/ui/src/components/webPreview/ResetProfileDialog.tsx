import { useState } from 'react';
import { RESET_EVERYTHING, type BrowserProfileReset } from '@seshboard/protocol/client';
import { browserProfileName, deleteBrowserProfile, resetBrowserProfile } from '../../state/browserProfilesStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { tabsOfProfile } from './browserTabs.ts';

/** What Reset can forget, in the order the dialog lists it, with a line on each. */
const PARTS: ReadonlyArray<{ key: keyof BrowserProfileReset; label: string; detail: string }> = [
  { key: 'cookies', label: 'Logins and cookies', detail: 'Signs you out of every site in this profile.' },
  { key: 'siteData', label: 'Site data', detail: 'Local storage, IndexedDB, service workers and other data sites keep.' },
  { key: 'cache', label: 'Cache', detail: 'Copies of pages and files kept to load them faster.' },
  { key: 'history', label: 'History', detail: 'The pages the address bar suggests.' },
];

/**
 * Reset profile… (a tab's menu, Settings › Browser): forgets what you tick of a browser profile (null: the Default
 * one), all ticked to start with. Its tabs stay and load again.
 */
export function ResetProfileDialog({ profileId, onClose }: { profileId: string | null; onClose(): void }) {
  const [parts, setParts] = useState<BrowserProfileReset>(RESET_EVERYTHING);
  const name = browserProfileName(profileId);
  const tabs = useWebPreview((s) => tabsOfProfile(s, profileId).length);
  const none = !PARTS.some((part) => parts[part.key]);
  return (
    <ConfirmDialog
      title={`Reset ${name}?`}
      danger
      confirmLabel="Reset"
      body={`Seshboard forgets what you tick below.${tabs ? ' Its tabs reload.' : ''}`}
      blockedReason={none ? 'Tick what to forget.' : null}
      blockedTone="info"
      data={{ 'data-reset-browser-profile-dialog': profileId ?? 'default' }}
      details={
        <div className="grid gap-2.5" role="group" aria-label="What to forget">
          {PARTS.map((part) => (
            <Checkbox key={part.key} checked={parts[part.key]} onChange={(on) => setParts((p) => ({ ...p, [part.key]: on }))} dataAttrs={{ 'data-reset-part': part.key }}>
              <span className="block text-ui text-text">{part.label}</span>
              <span className="block text-meta text-muted">{part.detail}</span>
            </Checkbox>
          ))}
        </div>
      }
      onConfirm={() => resetBrowserProfile(profileId, parts)}
      onClose={onClose}
    />
  );
}

/** Delete profile…: its tabs close and everything it kept goes; asks first. */
export function DeleteProfileDialog({ profileId, onClose }: { profileId: string; onClose(): void }) {
  const name = browserProfileName(profileId);
  const tabs = useWebPreview((s) => tabsOfProfile(s, profileId).length);
  return (
    <ConfirmDialog
      title={`Delete ${name}?`}
      danger
      confirmLabel="Delete profile"
      body={`Seshboard forgets its logins, site data, cache and history.${tabs ? ` Its ${tabs === 1 ? 'tab closes' : `${tabs} tabs close`}.` : ''}`}
      data={{ 'data-delete-browser-profile-dialog': profileId }}
      onConfirm={() => deleteBrowserProfile(profileId)}
      onClose={onClose}
    />
  );
}
