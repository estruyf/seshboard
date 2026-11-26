/**
 * Monaco, loaded only when a file is edited (FileEditor imports this module dynamically). Only the editor core and the
 * features a light editor needs are imported, not `monaco-editor`'s index (every language and feature). Colours come
 * from Shiki, with the grammars and syntax themes the source view uses, and the surfaces from the app's tokens.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/codicon/register';
// No `features/find`: the viewer's own find bar searches the editor too (`highlightFind`), as in the read-only view.
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/comment/register';
import 'monaco-editor/features/cursorUndo/register';
import 'monaco-editor/features/hover/register';
import 'monaco-editor/features/indentation/register';
import 'monaco-editor/features/linesOperations/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/suggest/register';
import 'monaco-editor/features/wordHighlighter/register';
import 'monaco-editor/features/wordOperations/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { EncodedTokenMetadata, INITIAL, type StateStack } from 'shiki/textmate';
import { editorHighlighter, grammarFor } from '../../../lib/highlight.ts';
import { currentPlatform } from '../../../lib/platform.ts';
import { RENDER_COUNTS } from '../../../lib/renderCounts.ts';
import { matches, SHORTCUTS, type ShortcutId } from '../../../lib/shortcuts.ts';
import { appEditorKeys, appEditorShortcuts, clashingBindings, editorTheme, tokenName, TOKEN_VARS, type EditorTokens } from './editorModel.ts';

// Workers come from Vite's `?worker` imports: a file of their own next to the page, which the window's policy allows
// (`script-src 'self'`). Without this Monaco makes a blob: worker, which that policy refuses.
self.MonacoEnvironment = {
  // Only the editor's own worker: no language service (TypeScript's would add 7.6 MB to mark syntax errors only).
  getWorker: () => new EditorWorker(),
};

const shiki = editorHighlighter();
const providers = new Map<string, monaco.IDisposable>();

/** The colour of each index in the Shiki theme in use, refreshed on every theme change. */
let colorMap: string[] = [];

class ShikiState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return new ShikiState(this.stack);
  }
  equals(other: monaco.languages.IState) {
    return other instanceof ShikiState && other.stack === this.stack;
  }
}

/** Shiki's tokens for a Monaco language: each token named by its colour and font style, which the theme has a rule for. */
async function provideTokens(grammar: string, languageId: string) {
  const { shiki: highlighter } = await shiki;
  providers.get(languageId)?.dispose();
  providers.set(
    languageId,
    monaco.languages.setTokensProvider(languageId, {
      getInitialState: () => new ShikiState(INITIAL),
      tokenize(line, state) {
        const current = (state as ShikiState).stack;
        if (line.length > 20_000) return { endState: state, tokens: [{ startIndex: 0, scopes: '' }] };
        const result = highlighter.getLanguage(grammar).tokenizeLine2(line, current, 500);
        const tokens: monaco.languages.IToken[] = [];
        for (let i = 0; i < result.tokens.length; i += 2) {
          const metadata = result.tokens[i + 1]!;
          const color = colorMap[EncodedTokenMetadata.getForeground(metadata)];
          tokens.push({ startIndex: result.tokens[i]!, scopes: color ? tokenName(color, EncodedTokenMetadata.getFontStyle(metadata)) : '' });
        }
        return { endState: new ShikiState(result.ruleStack), tokens };
      },
    }),
  );
}

/** A colour as `#rrggbbaa`, whatever CSS form the token has (`color-mix`, `rgb`, a name): drawn on a pixel and read back. */
const toHex = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return (css: string, fallback: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    ctx.fillStyle = css.trim() || fallback;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r!, g!, b!, a!].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
})();

/** The app's tokens under `el` (which may be inside `.theme-dark`), as hex. */
function readTokens(el: Element): EditorTokens {
  const style = getComputedStyle(el);
  return Object.fromEntries(Object.entries(TOKEN_VARS).map(([key, name]) => [key, toHex(style.getPropertyValue(name), '#808080')])) as unknown as EditorTokens;
}

/** Whether a background is dark, by its luminance: the editor's mode follows its surface, not only the window's. */
const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.5;
};

let themeSeq = 0;
/** Builds the theme from the tokens under `el` and the syntax theme of that mode, and uses it (Monaco's theme is global). */
export async function applyTheme(el: Element): Promise<void> {
  const mine = ++themeSeq;
  const { shiki: highlighter, themes, ensure } = await shiki;
  // Loads the syntax theme of the active app theme the first time it is used.
  await ensure();
  // A newer change (dark, then light at once) wins; the tokens are read only now, after the waits.
  if (mine !== themeSeq) return;
  const tokens = readTokens(el);
  const dark = isDark(tokens.code);
  const syntax = themes()[dark ? 'dark' : 'light'];
  const { colorMap: colors } = highlighter.setTheme(syntax);
  colorMap = colors.map((c) => c.replace('#', '').slice(0, 6).toLowerCase());
  const id = `seshboard-${mine}`;
  monaco.editor.defineTheme(id, editorTheme(tokens, colorMap, dark) as monaco.editor.IStandaloneThemeData);
  monaco.editor.setTheme(id);
  // The colours of the tokens changed with the theme: a new provider makes Monaco tokenize again.
  for (const [grammar, languageId] of grammarsByLanguage) await provideTokens(grammar, languageId);
}
/** Each grammar loaded, and the Monaco language it colours. */
const grammarsByLanguage = new Map<string, string>();

/** The Monaco language for a file's extension: Shiki's grammar, registered once with Shiki's tokens. */
async function languageFor(extension: string | undefined): Promise<string> {
  const grammar = grammarFor(extension);
  if (!grammar) return 'plaintext';
  // Each grammar is a language of its own (Shiki's name), so `ts` and `tsx` keep their own colours.
  const languageId = grammar;
  if (!monaco.languages.getLanguages().some((l) => l.id === languageId)) monaco.languages.register({ id: languageId });
  if (!grammarsByLanguage.has(grammar)) {
    const { ensure } = await shiki;
    await ensure(grammar);
    grammarsByLanguage.set(grammar, languageId);
    await provideTokens(grammar, languageId);
  }
  return languageId;
}

/**
 * Monaco keys that stay Monaco's in the editor though the app uses them elsewhere: select all, undo, paste… Find (⌘F,
 * ⌘G) is not one of them: it goes to the viewer's find bar, which searches the editor as it does the read-only view.
 */
const KEEP_KEYS = new Set(['cmd+a', 'ctrl+a', 'cmd+z', 'ctrl+z', 'cmd+v', 'ctrl+v', 'cmd+d', 'ctrl+d', 'cmd+l', 'ctrl+l', 'cmd+e', 'ctrl+e']);
let appShortcuts: ShortcutId[] | null = null;

/**
 * The app's shortcuts keep working in the editor. A key press that is one of them is stopped on the editor's host, in
 * the capture phase, before Monaco sees it, and sent again from outside the editor, where the app's listeners (on
 * window, and React's) get it. Monaco never starts its ⌘K chords, and nothing depends on its keybinding internals: the
 * features it loads later (the TypeScript support brings folding and formatting) register keys of their own.
 */
function passAppKeys(host: HTMLElement): () => void {
  appShortcuts ??= appEditorShortcuts(SHORTCUTS, currentPlatform() === 'darwin', KEEP_KEYS) as ShortcutId[];
  const onKey = (event: KeyboardEvent) => {
    if (!event.isTrusted || !appShortcuts!.some((id) => matches(event, id))) return;
    event.stopPropagation();
    const copy = new KeyboardEvent('keydown', { key: event.key, code: event.code, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, bubbles: true, cancelable: true, composed: true });
    (host.parentElement ?? document.body).dispatchEvent(copy);
    if (copy.defaultPrevented) event.preventDefault();
  };
  host.addEventListener('keydown', onKey, true);
  return () => host.removeEventListener('keydown', onKey, true);
}

/** For the smoke test's report: Monaco's keybindings (all features loaded so far) that clash with the app's. */
function clashes(editor: monaco.editor.IStandaloneCodeEditor) {
  // Not public API, so only the smoke build reads it.
  const service = (editor as unknown as { _standaloneKeybindingService: { getKeybindings(): Array<{ command: string | null; resolvedKeybinding?: { getUserSettingsLabel(): string | null } }> } })._standaloneKeybindingService;
  const bindings = service.getKeybindings().flatMap((b) => (b.command && !b.command.startsWith('-') && b.resolvedKeybinding?.getUserSettingsLabel() ? [{ command: b.command, label: b.resolvedKeybinding.getUserSettingsLabel()! }] : []));
  const mac = currentPlatform() === 'darwin';
  return clashingBindings(bindings, appEditorKeys(SHORTCUTS.filter((s) => appShortcuts?.includes(s.id)), mac), KEEP_KEYS, mac);
}
let lastEditor: monaco.editor.IStandaloneCodeEditor | null = null;

/** What the Files viewer holds of an open editor. */
export interface FileEditorHandle {
  getValue(): string;
  /** Marks the current text as saved (the dirty marker goes). */
  markSaved(): void;
  setWrap(wrap: boolean): void;
  revealLine(line: number): void;
  /** The text picked in the editor, to start a find with. */
  selectedText(): string;
  /** Marks every match of `query` (any case) and the `current` one (wrapping); returns how many there are. Empty clears. */
  highlightFind(query: string, current: number): number;
  /** Brings the `current` match of `query` into view and picks it. */
  revealFind(query: string, current: number): void;
  focus(): void;
  /**
   * Closes the editor. `keep`: the file stays in edit mode (another tab in front, the panel closed), so its model (text,
   * undo, saved point) and where you were stay for the next editor of the same `key`; otherwise they go too.
   */
  dispose(keep: boolean): void;
}

export interface FileEditorOptions {
  /** The file in edit mode this editor shows (a session and a path): a model kept for it is used again. */
  key: string;
  /** Goes up when the editor starts again from `value` (a new text from disk): a model kept from before is dropped. */
  seq: number;
  /** The text on disk, for a new model. */
  value: string;
  path: string;
  extension: string | undefined;
  wrap: boolean;
  onDirty(dirty: boolean): void;
  onSave(): void;
}

let editorCount = 0;

/** A file's model while it is in edit mode with no editor showing it (another tab in front, the panel closed). */
interface Kept {
  model: monaco.editor.ITextModel;
  seq: number;
  savedVersion: number;
  view: monaco.editor.ICodeEditorViewState | null;
}
const kept = new Map<string, Kept>();
/** The models of the editors on screen, by key: what a save of a tab reads, whether or not its editor shows. */
const live = new Map<string, { model: monaco.editor.ITextModel; markSaved(): void }>();

/** The text of a file in edit mode (by its key), on screen or kept; null when there is none. */
export function fileEditText(key: string): string | null {
  return (live.get(key)?.model ?? kept.get(key)?.model)?.getValue() ?? null;
}

/** Marks a file in edit mode as saved at its current text, on screen or kept. */
export function markFileEditSaved(key: string): void {
  const shown = live.get(key);
  if (shown) return shown.markSaved();
  const k = kept.get(key);
  if (!k) return;
  k.model.pushStackElement();
  k.savedVersion = k.model.getAlternativeVersionId();
}

/** Drops what is kept of a file that left edit mode with no editor showing it (its tab closed). */
export function dropFileEdit(key: string): void {
  kept.get(key)?.model.dispose();
  kept.delete(key);
}

/** Opens an editor on `el` for a file's text. */
export async function createFileEditor(el: HTMLElement, options: FileEditorOptions): Promise<FileEditorHandle> {
  const languageId = await languageFor(options.extension);
  await applyTheme(el);
  // The model kept from the last editor of this file, unless the text started again from disk since.
  const before = kept.get(options.key);
  kept.delete(options.key);
  if (before && before.seq !== options.seq) before.model.dispose();
  const reused = before && before.seq === options.seq ? before : null;
  // One model per file in edit mode: the same file can be open in two sessions' panels (split view), each with its own
  // edits.
  const model = reused?.model ?? monaco.editor.createModel(options.value, languageId, monaco.Uri.file(options.path).with({ query: `editor=${++editorCount}` }));
  const style = getComputedStyle(el);
  const editor = monaco.editor.create(el, {
    model,
    automaticLayout: true,
    fontFamily: style.getPropertyValue('--font-mono').trim() || 'monospace',
    fontSize: 12,
    lineHeight: 19.5,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    contextmenu: false,
    fixedOverflowWidgets: true,
    padding: { top: 8, bottom: 8 },
    wordWrap: options.wrap ? 'on' : 'off',
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: false,
    stickyScroll: { enabled: false },
    overviewRulerBorder: false,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    tabSize: 2,
    detectIndentation: true,
    'semanticHighlighting.enabled': false,
    // Type through a hidden <textarea>, not the EditContext API on a <div>. The app's single-letter keys (the
    // catch-up's Space, C, S, D…, the permission card's) skip a focused textarea, input or contenteditable, and an
    // EditContext <div> is none of those, so Space in the editor opened the catch-up's details.
    editContext: false,
  });
  const stopPassing = passAppKeys(el);
  // Edit › Undo and Redo in the app's menu (roles) run the browser's own undo on the focused textarea, which Monaco's
  // text is not in. That arrives as a beforeinput of historyUndo or historyRedo: run Monaco's undo and redo instead.
  const onHistory = (event: InputEvent) => {
    if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
    event.preventDefault();
    editor.trigger('menu', event.inputType === 'historyUndo' ? 'undo' : 'redo', null);
  };
  el.addEventListener('beforeinput', onHistory, true);
  lastEditor = editor;
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => options.onSave());
  // A draft starts unsaved: no version of it is the saved one until a save.
  if (reused?.view) editor.restoreViewState(reused.view);
  let savedVersion = reused?.savedVersion ?? model.getAlternativeVersionId();
  let dirty = model.getAlternativeVersionId() !== savedVersion;
  if (dirty) options.onDirty(true);
  const changes = model.onDidChangeContent(() => {
    const next = model.getAlternativeVersionId() !== savedVersion;
    if (next !== dirty) options.onDirty((dirty = next));
  });
  // The find bar's matches, drawn as decorations (`sb-find-match`, `sb-find-current` in styles.css).
  const findMarks = editor.createDecorationsCollection();
  const matchesOf = (query: string) => (query ? model.findMatches(query, false, false, false, null, false).map((m) => m.range) : []);
  const wrapped = (index: number, length: number) => ((index % length) + length) % length;
  const markSaved = () => {
    // A save ends an undo step, so the next edit undoes back to the saved text (and the file reads as saved again).
    model.pushStackElement();
    savedVersion = model.getAlternativeVersionId();
    if (dirty) options.onDirty((dirty = false));
  };
  live.set(options.key, { model, markSaved });
  return {
    getValue: () => model.getValue(),
    selectedText: () => {
      const selection = editor.getSelection();
      return selection ? model.getValueInRange(selection) : '';
    },
    highlightFind: (query, current) => {
      const ranges = matchesOf(query);
      const at = ranges.length ? wrapped(current, ranges.length) : -1;
      findMarks.set(ranges.map((range, i) => ({ range, options: { inlineClassName: i === at ? 'sb-find-current' : 'sb-find-match' } })));
      return ranges.length;
    },
    revealFind: (query, current) => {
      const ranges = matchesOf(query);
      if (!ranges.length) return;
      const range = ranges[wrapped(current, ranges.length)]!;
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range);
    },
    markSaved,
    setWrap: (wrap) => editor.updateOptions({ wordWrap: wrap ? 'on' : 'off' }),
    revealLine: (line) => {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
    },
    focus: () => editor.focus(),
    dispose: (keep) => {
      stopPassing();
      el.removeEventListener('beforeinput', onHistory, true);
      findMarks.clear();
      if (lastEditor === editor) lastEditor = null;
      if (live.get(options.key)?.model === model) live.delete(options.key);
      changes.dispose();
      if (keep) kept.set(options.key, { model, seq: options.seq, savedVersion, view: editor.saveViewState() });
      editor.dispose();
      if (!keep) model.dispose();
    },
  };
}

// For the smoke test (its build only): the Monaco keys given to the app's shortcuts, and the markers of the open files.
if (RENDER_COUNTS)
  (window as unknown as { __seshboardEditor: unknown }).__seshboardEditor = {
    appShortcuts: () => appShortcuts,
    clashes: () => (lastEditor ? clashes(lastEditor) : []),
    languages: () => [...grammarsByLanguage],
  };
