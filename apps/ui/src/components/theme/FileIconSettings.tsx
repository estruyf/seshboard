import { useEffect, useState } from 'react';
import type { FileIconThemeInfo } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Select } from '../ui/Select.tsx';
import { FIELD } from '../ui/fieldStyles.ts';
import { FILE_ICONS_DETAIL } from './minimalCopy.ts';

/** Settings › Theme › File icons: None, or one of the icon themes the editors have installed. */
export function FileIconSettings() {
  const value = usePreferences((s) => s.prefs.fileIconTheme);
  const update = usePreferences((s) => s.update);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [themes, setThemes] = useState<FileIconThemeInfo[] | null>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
    client.call('fileIcons.themes', {}).then(
      ({ themes }) => live && setThemes(themes),
      () => live && setThemes([]),
    );
    return () => {
      live = false;
    };
  }, [client]);

  const options = [
    { value: '', label: 'None' },
    ...(themes ?? []).map((t) => ({ value: t.id, label: t.label, hint: t.editor })),
    // A theme that was uninstalled still shows what is saved.
    ...(value && themes && !themes.some((t) => t.id === value) ? [{ value, label: `${value.split('/').pop()} (not installed)` }] : []),
  ];
  const detail = themes && themes.length === 0 ? `${FILE_ICONS_DETAIL} None is installed.` : FILE_ICONS_DETAIL;

  return (
    <div className="flex items-center justify-between gap-4" data-setting-row>
      <span>
        <span className="block text-ui">File icons</span>
        <span className="block text-meta text-muted">{detail}</span>
      </span>
      <Select<string>
        label="File icons"
        value={value}
        onChange={(fileIconTheme) => update({ fileIconTheme })}
        options={options}
        menuWidth={240}
        className={`${FIELD} h-7 shrink-0 px-2.5 text-ui`}
        dataAttrs={{ 'data-file-icon-theme': true }}
      />
    </div>
  );
}
