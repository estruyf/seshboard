import { statSync } from 'node:fs';
import { win32 } from 'node:path';

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/** Found programs, by name and PATH: looking one up costs a check per PATH folder, and git runs often. */
const found = new Map<string, string>();

/** A variable of `env` by its name in any case: Windows calls PATH `Path`, and a copied environment keeps that. */
function variable(env: Record<string, string | undefined>, name: string): string | undefined {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * The file to start for a program named without a folder, such as `git` or `gh`, or null when it isn't on PATH.
 *
 * On Windows, Node (libuv) looks for a bare name in the child's working folder before PATH, the way `cmd.exe` does,
 * so a `git.exe` checked into a repository would run instead of Git whenever git runs in it. There the program is
 * looked up here, in PATH's absolute folders only (a relative one such as `.` is the working folder again), and
 * started by its full path. Elsewhere the name is returned as it is: PATH never includes the working folder there
 * unless the user put it in.
 */
export function programPath(name: string, env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = isFile): string | null {
  if (platform !== 'win32' || win32.isAbsolute(name) || /[\\/]/.test(name)) return name;
  const path = variable(env, 'PATH') ?? '';
  const key = `${name}\0${path}`;
  const cached = found.get(key);
  if (cached && exists(cached)) return cached;
  // Like libuv: a name with an ending is tried as it is, one without gets `.com` and `.exe` (a `.cmd` needs `cmd.exe`).
  const endings = win32.extname(name) ? [''] : ['.com', '.exe'];
  for (const dir of path.split(';')) {
    const folder = dir.trim().replace(/^"(.*)"$/, '$1');
    if (!win32.isAbsolute(folder) || /^[\\/](?![\\/])/.test(folder)) continue;
    for (const ending of endings) {
      const candidate = win32.join(folder, name + ending);
      if (exists(candidate)) {
        found.set(key, candidate);
        return candidate;
      }
    }
  }
  return null;
}
