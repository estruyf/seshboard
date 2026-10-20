import { useRef, useState } from 'react';
import { useReadMode } from '../../state/readModeStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Popover } from '../ui/Popover.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { READ_SIZES, type ReadFont, type ReadSize, type ReadWidth } from './readPrefs.ts';

const FONTS = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
] as const satisfies readonly { value: ReadFont; label: string }[];

const SIZES = READ_SIZES.map((_, index) => ({ value: String(index), label: ['Small', 'Medium', 'Large', 'Huge'][index]!, ariaLabel: `Text size ${index + 1} of ${READ_SIZES.length}` }));

const WIDTHS = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
] as const satisfies readonly { value: ReadWidth; label: string }[];

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-1.5">
    <div className="text-meta font-semibold text-muted">{label}</div>
    {children}
  </div>
);

/**
 * The Aa button in the top bar and what it opens: the font, the text size, the column width and whether tool calls
 * show. Changes apply at once and are kept (`setPrefs`, saved in localStorage).
 */
export function ReadSettings() {
  const prefs = useReadMode((s) => s.prefs);
  const setPrefs = useReadMode((s) => s.setPrefs);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        variant="quiet"
        size="sm"
        selected={!!at}
        aria-haspopup="dialog"
        aria-expanded={!!at}
        aria-label="Text settings"
        data-tooltip="Text settings"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: box.right - 280, y: box.bottom + 6 });
        }}
        data-read-settings-button
      >
        <span className="font-semibold">Aa</span>
      </Button>
      {at && (
        <Popover x={at.x} y={at.y} width={280} onClose={() => setAt(null)} anchor={anchor} role="dialog" aria-label="Text settings" className="grid gap-3.5 px-4 py-3.5" data-read-settings>
          <Row label="Font">
            <SegmentedControl mode="radio" label="Font" size="sm" fill segments={FONTS} value={prefs.font} onChange={(font) => setPrefs({ font })} data-read-font />
          </Row>
          <Row label="Size">
            <SegmentedControl mode="radio" label="Size" size="sm" fill segments={SIZES} value={String(prefs.size)} onChange={(size) => setPrefs({ size: Number(size) as ReadSize })} data-read-size />
          </Row>
          <Row label="Width">
            <SegmentedControl mode="radio" label="Width" size="sm" fill segments={WIDTHS} value={prefs.width} onChange={(width) => setPrefs({ width })} data-read-width />
          </Row>
          <Checkbox checked={prefs.showTools} onChange={(showTools) => setPrefs({ showTools })} dataAttrs={{ 'data-read-show-tools': true }}>
            Show tool calls
          </Checkbox>
          <p className="text-meta text-muted">Kept for next time.</p>
        </Popover>
      )}
    </>
  );
}
