const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age for sidebar rows: "now", "5m", "3h", "2d", "Sep 21", "Sep 21, 2025". */
export function shortAge(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** How long ago, for a line of text: "now", "5m ago", "3d ago", "on Sep 21". */
export function agoText(timestamp: number, now = Date.now()): string {
  const age = shortAge(timestamp, now);
  return age === 'now' ? 'now' : /^\d+[mhd]$/.test(age) ? `${age} ago` : `on ${age}`;
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed;
}

/** The folder a path is in: everything before its last `/` or `\` (Windows paths have either). */
export function dirnameOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
}

/** The last `count` parts of a path, joined with its own separator: `memory/profile.md`, or `memory\profile.md` on Windows. */
export function pathTail(path: string, count: number): string {
  const sep = /^[A-Za-z]:\\/.test(path) ? '\\' : '/';
  return path.split(/[\\/]/).slice(-count).join(sep);
}

/** Shows paths under the home folder as `~/…` (`~\…` on Windows, where the drive letter's case may differ). */
export function tildify(path: string, home: string | null): string {
  if (!home) return path;
  const windows = /^[A-Za-z]:\\/.test(home);
  const head = path.slice(0, home.length);
  const same = windows ? head.toLowerCase() === home.toLowerCase() : head === home;
  const rest = path.slice(home.length);
  return same && (rest === '' || rest.startsWith(windows ? '\\' : '/')) ? `~${rest}` : path;
}
