/**
 * Reads the top-level scalars of Copilot CLI's `workspace.yaml` (a session's folder, branch, title and dates).
 * Copilot writes it as flat `key: value` lines, with double- or single-quoted strings and `|`/`>` block scalars for
 * long text. Anything else (nested maps, lists) is skipped: the file is undocumented, so a change degrades to fewer
 * fields rather than an error.
 */
export function parseWorkspaceYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(lines[i]!);
    if (!match) continue;
    const key = match[1]!;
    const raw = (match[2] ?? '').trim();
    const block = /^([|>])([+-]?)$/.exec(raw);
    if (block) {
      // The indented lines that follow, without their common indent.
      const body: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1] === '' || /^\s/.test(lines[i + 1]!))) body.push(lines[++i]!);
      const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
      const kept = body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      while (kept.length && kept[kept.length - 1] === '') kept.pop();
      out[key] = block[1] === '>' ? kept.join(' ').replace(/ {2,}/g, ' ') : kept.join('\n');
      continue;
    }
    if (raw === '' || raw === '~' || raw === 'null') continue;
    if (raw.startsWith('"')) {
      // YAML's double-quoted escapes are close enough to JSON's for what Copilot writes.
      try {
        out[key] = JSON.parse(raw) as string;
      } catch {
        out[key] = raw.slice(1, raw.endsWith('"') ? -1 : undefined);
      }
    } else if (raw.startsWith("'")) {
      out[key] = raw.slice(1, raw.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
    } else {
      out[key] = raw.replace(/\s+#.*$/, '');
    }
  }
  return out;
}
