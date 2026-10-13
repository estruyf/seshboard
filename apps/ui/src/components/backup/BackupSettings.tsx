import { Download, Upload, type LucideIcon } from 'lucide-react';
import { useBackup } from '../../state/backupStore.ts';
import { Button } from '../ui/Button.tsx';

function Row({ label, detail, button, icon: Icon, onClick, attr }: { label: string; detail: string; button: string; icon: LucideIcon; onClick(): void; attr: `data-${string}` }) {
  return (
    <div className="flex items-center justify-between gap-4" data-setting-row>
      <span>
        <span className="block text-[12.5px]">{label}</span>
        <span className="block text-ui text-muted">{detail}</span>
      </span>
      <Button icon={<Icon size={13} />} onClick={onClick} className="shrink-0" {...{ [attr]: true }}>
        {button}
      </Button>
    </div>
  );
}

/** Settings → Backup: export to and import from a settings file. */
export function BackupSettings() {
  const show = useBackup((s) => s.show);
  return (
    <div className="grid gap-4">
      <Row
        label="Export settings"
        detail="Choose what to include and save it to a file."
        button="Export settings…"
        icon={Upload}
        onClick={() => show('export')}
        attr="data-backup-export"
      />
      <Row
        label="Import settings"
        detail="See what a file would change before anything happens. Your current settings are backed up first."
        button="Import settings…"
        icon={Download}
        onClick={() => show('import')}
        attr="data-backup-import"
      />
    </div>
  );
}
