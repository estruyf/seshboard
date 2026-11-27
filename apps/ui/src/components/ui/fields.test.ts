import { describe, expect, it } from 'vitest';

// Every source file of the renderer except tests and these components (they draw the controls), as text (see nativeControls.test.ts).
const SOURCES = import.meta.glob<string>(['../../**/*.tsx', '!./**'], { query: '?raw', import: 'default', eager: true });

/**
 * Controls drawn with an edge on purpose that are not boxed fields, by file (from components/) and kind, with why.
 */
const EXCEPTIONS: Record<string, string> = {
  // The filter at the top of a list in a dialog: a bar with a line under it, not a box.
  'projects/AddProjectDialog.tsx:input': 'a filter bar with a line under it',
  // A transparent text area over a mirror that draws the text and its mentions: its border only keeps them in step.
  'pipelines/editor/MentionPromptField.tsx:textarea': 'sits over its mirror, which draws the field',
  'triggers/TriggerPromptField.tsx:textarea': 'sits over its mirror, which draws the field',
};

/** A border drawn by its own classes (not `bg-border` or `ring-border`, which are fills and rings). */
const OWN_BORDER = /(^|[\s`'"])border(-edge|-border(\/\d+)?|-x|-y)?(?=[\s`'"]|$)/;

/** The opening tags of inputs (not checkboxes, radios or hidden ones), text areas and Selects in a file. */
function controls(source: string): Array<{ kind: string; tag: string }> {
  const found: Array<{ kind: string; tag: string }> = [];
  for (const match of source.matchAll(/<(input|textarea|Select)\b/g)) {
    const chunk = source.slice(match.index, match.index + 2000);
    // `<Select<string>`: skip the type argument.
    let i = match[0].length;
    if (chunk[i] === '<') i = chunk.indexOf('>', i) + 1;
    let depth = 0;
    for (; i < chunk.length; i++) {
      if (chunk[i] === '{') depth++;
      else if (chunk[i] === '}') depth--;
      else if (chunk[i] === '>' && depth === 0) break;
    }
    const tag = chunk.slice(0, i + 1);
    if (/type="(checkbox|radio|hidden|file|range)"/.test(tag)) continue;
    found.push({ kind: match[1]!, tag });
  }
  return found;
}

describe('form fields', () => {
  it('use the field style, not a border of their own', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      const file = path.replace(/^(\.\.\/)+/, '').replace(/^src\//, '');
      for (const { kind, tag } of controls(source)) {
        const className = /className=(\{[\s\S]*?\}(?=\s|\/?>)|"[^"]*")/.exec(tag)?.[1] ?? '';
        if (!OWN_BORDER.test(className) || /\bfield\b|FIELD/.test(className)) continue;
        if (EXCEPTIONS[`${file}:${kind}`]) continue;
        offenders.push(`${file}: <${kind} ${className.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps its exceptions to controls that are still there', () => {
    const files = Object.keys(SOURCES).map((path) => path.replace(/^(\.\.\/)+/, '').replace(/^src\//, ''));
    for (const key of Object.keys(EXCEPTIONS)) expect(files, key).toContain(key.slice(0, key.lastIndexOf(':')));
  });
});
