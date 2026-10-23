import { Monitor } from 'lucide-react';
import type { Computer } from '@switchboard/protocol/client';
import { thisComputerName } from '../../lib/platform.ts';
import { useComputers } from '../../state/computersStore.ts';
import { offlineStartLine, THIS_COMPUTER } from '../../state/remoteRows.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';

const NONE: Computer[] = [];

const DOT: Record<Computer['state'], string> = { connected: 'bg-ok', connecting: 'bg-faint animate-pulse', offline: 'bg-faint', unpaired: 'bg-faint' };

/**
 * New session's Run on switch, under its heading: This Mac or a paired computer, each with its status dot. A computer
 * that isn't connected stays in the switch, disabled, saying since when. Only shows with a paired computer; the last
 * choice is remembered (the sidebar's + opens there while a prompt typed for it is unsent), and ⌘N always starts on
 * this computer.
 */
export function RunOnSwitch() {
  const computers = useComputers((s) => s.status?.computers ?? NONE);
  const target = useRunOn((s) => s.target);
  if (!computers.length) return null;
  const value = target === THIS_COMPUTER || computers.some((c) => c.id === target && c.state === 'connected') ? target : THIS_COMPUTER;
  return (
    <div className="flex justify-center" data-run-on={value}>
      <SegmentedControl<string>
        mode="radio"
        label="Run on"
        value={value}
        onChange={(next) => useRunOn.getState().setTarget(next)}
        segments={[
          { value: THIS_COMPUTER, label: thisComputerName(), icon: <Monitor size={13} aria-hidden />, data: { 'data-run-on-option': THIS_COMPUTER } },
          ...computers.map((computer) => {
            const away = computer.state !== 'connected';
            return {
              value: computer.id,
              label: away ? `${computer.name} · ${computer.state === 'unpaired' ? 'pair again' : computer.state === 'connecting' ? 'connecting' : 'offline'}` : computer.name,
              icon: <span aria-hidden className={`mx-0.5 size-1.5 shrink-0 rounded-full ${DOT[computer.state]}`} />,
              disabled: away,
              tooltip: away ? (computer.state === 'offline' ? offlineStartLine(computer.name, computer.lastSeen) : `${computer.name}: ${computer.message ?? 'Connecting…'}`) : `Claude runs on ${computer.name}`,
              data: { 'data-run-on-option': computer.id },
            };
          }),
        ]}
      />
    </div>
  );
}
