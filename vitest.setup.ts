import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Windows may name the temp folder by its short 8.3 name (C:\Users\RUNNER~1\…, as GitHub's runners do), while git,
// PowerShell and the shell report the same folder by its long name. Tests compare the folders they make with what
// those print, so every test, and every process it starts, uses the long name.
if (process.platform === 'win32') {
  const temp = realpathSync.native(tmpdir());
  process.env.TEMP = temp;
  process.env.TMP = temp;
}
