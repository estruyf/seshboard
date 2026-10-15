/** What the toggle does: open the panel, bring it in front of the other tabs, or close it. */
export function agentsToggleStep(open: boolean, front: boolean, othersOpen: boolean): 'open' | 'front' | 'close' {
  if (!open) return 'open';
  return !front && othersOpen ? 'front' : 'close';
}
