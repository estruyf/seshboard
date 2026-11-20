import { useState } from 'react';

// What was opened survives scrolling out of the virtualised list and back.
const openKeys = new Set<string>();

/** Open or closed by key, for this window's life: rows outside the viewport aren't mounted, so their state can't be theirs. */
export function useOpenKey(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => openKeys.has(key));
  return [
    open,
    () => {
      if (open) openKeys.delete(key);
      else openKeys.add(key);
      setOpen(!open);
    },
  ];
}
