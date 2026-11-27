/**
 * The panel the right-click menu shows on the page: what goes, where it goes (a search over the sessions and
 * projects, the likely one picked), and Add. It is injected with `scripting.executeScript({ func })`, so the function
 * is copied into the page on its own: it may use nothing from outside its body, only its argument. It talks to the
 * background script with `runtime.sendMessage` (DIALOG_MESSAGE).
 */

/** The message type between the panel and the background script. */
export const DIALOG_MESSAGE = 'seshboard-dialog';

export interface DialogOption {
  value: string;
  label: string;
  detail: string;
  tag: string | null;
  group: 'sessions' | 'new';
}

/** What goes, as the popup offers it. Selection is null without one; Console errors null off local pages. */
export interface DialogChoices {
  selection: boolean | null;
  page: boolean;
  screenshot: boolean;
  console: { on: boolean; count: number } | null;
}

/** What the panel says it sends (a choice left out of a page is false). */
export interface DialogInclude {
  selection: boolean;
  page: boolean;
  screenshot: boolean;
  console: boolean;
}

/** What the panel shows. `ready`: pick and add. The others say why it can't, and what to do. */
export type DialogData =
  | { kind: 'ready'; title: string; preview: string; options: DialogOption[]; selected: string | null; choices: DialogChoices }
  | { kind: 'not-running'; canLaunch: boolean }
  | { kind: 'no-host'; detail: string }
  | { kind: 'error'; message: string };

/** What the panel asks the background script. */
export type DialogRequest = { type: typeof DIALOG_MESSAGE; action: 'add'; value: string; include: DialogInclude } | { type: typeof DIALOG_MESSAGE; action: 'launch' };
export type DialogReply = { ok: true; label: string } | { ok: false; error: string };

export function showPageDialog(data: DialogData): void {
  const HOST_ID = 'seshboard-page-dialog';
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial !important; position: fixed !important; top: 16px !important; right: 16px !important; z-index: 2147483647 !important;';
  const root = host.attachShadow({ mode: 'open' });
  const runtime = ((globalThis as { browser?: { runtime: unknown } }).browser ?? (globalThis as { chrome?: { runtime: unknown } }).chrome)?.runtime as { sendMessage(message: unknown): Promise<unknown> } | undefined;
  const ask = (message: unknown) => (runtime ? (runtime.sendMessage(message) as Promise<{ ok: boolean; label?: string; error?: string }>) : Promise.resolve({ ok: false, error: 'The extension is not reachable' } as { ok: boolean; label?: string; error?: string }));

  root.innerHTML = `<style>
    :host { all: initial; }
    .card { --bg: #15181f; --card: #202736; --border: #2d3142; --text: #d9dbe1; --muted: #9ba4b7; --faint: #8b94a6; --accent: #ffd43b; --ink: #ffd43b; --on-accent: #15181f; --warn: #ed217c; --error: #ff6b6b; --hover: rgba(217, 219, 225, 0.1);
      box-sizing: border-box; width: 360px; max-width: calc(100vw - 32px); padding: 14px; border-radius: 12px; background: var(--bg); color: var(--text); border: 1px solid #414861;
      box-shadow: 0 4px 10px rgb(0 0 0 / 0.35), 0 16px 40px -6px rgb(0 0 0 / 0.6); font: 12px/1.45 -apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, system-ui, sans-serif; display: grid; gap: 10px; }
    @media (prefers-color-scheme: light) { .card { --bg: #ffffff; --card: #f4f6fa; --border: #e1e4e8; --text: #202736; --muted: #505869; --faint: #687082; --ink: #916c00; --warn: #d1186b; --error: #d73a49; --hover: rgba(32, 39, 54, 0.07); border-color: #d0d4db; box-shadow: 0 4px 10px rgb(0 0 0 / 0.08), 0 16px 40px -6px rgb(0 0 0 / 0.2); } }
    * { box-sizing: border-box; }
    .head { display: flex; align-items: center; gap: 8px; }
    .title { font-size: 14px; font-weight: 600; flex: 1; }
    .x { all: unset; cursor: pointer; color: var(--muted); width: 22px; height: 22px; border-radius: 6px; text-align: center; line-height: 22px; font-size: 16px; }
    .x:hover { background: var(--hover); color: var(--text); }
    .quote { border-left: 2px solid var(--ink); padding-left: 8px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
    .label { font-size: 11px; color: var(--muted); }
    .search { all: unset; box-sizing: border-box; width: 100%; height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 12px; }
    .search:focus { border-color: var(--ink); }
    .list { max-height: 220px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
    .group { font-size: 11px; color: var(--faint); padding: 8px 8px 4px; }
    .option { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: default; }
    .option.active { background: var(--hover); }
    .text { display: grid; min-width: 0; flex: 1; }
    .text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail { font-size: 11px; color: var(--muted); }
    .tag { flex: none; font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--hover); color: var(--ink); }
    .tag.warn { color: var(--warn); }
    .check { flex: none; width: 12px; color: var(--ink); }
    .empty { padding: 12px 8px; text-align: center; color: var(--muted); }
    .add { all: unset; box-sizing: border-box; height: 32px; border-radius: 6px; background: var(--accent); color: var(--on-accent); font-weight: 600; text-align: center; cursor: pointer; font-size: 12px; }
    .add[disabled] { opacity: 0.5; cursor: default; }
    .add:focus-visible, .search:focus-visible, .x:focus-visible { outline: 2px solid rgba(255, 212, 59, 0.55); outline-offset: 1px; }
    .note { color: var(--muted); font-size: 11px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { all: unset; box-sizing: border-box; height: 24px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); font-size: 12px; cursor: pointer; }
    .chip:hover { color: var(--text); }
    .chip[aria-pressed='true'] { border-color: var(--ink); color: var(--text); background: color-mix(in srgb, var(--accent) 15%, transparent); }
    .chip:focus-visible { outline: 2px solid rgba(255, 212, 59, 0.55); outline-offset: 1px; }
    .page { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .error { color: var(--error); font-size: 11px; }
  </style><div class="card" role="dialog" aria-label="Send to Seshboard" data-seshboard-dialog></div>`;
  const card = root.querySelector('.card') as HTMLElement;
  const el = (tag: string, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    clearTimeout(closeTimer);
    host.remove();
    document.removeEventListener('keydown', onPageKey, true);
  };
  // Esc closes the panel wherever the focus is on the page.
  const onPageKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onPageKey, true);

  const head = el('div', 'head');
  head.append(el('span', 'title', 'Send to Seshboard'));
  const x = el('button', 'x', '×') as HTMLButtonElement;
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', close);
  head.append(x);
  card.append(head);

  if (data.kind !== 'ready') {
    const message =
      data.kind === 'not-running'
        ? 'Seshboard is not running.'
        : data.kind === 'no-host'
          ? 'This browser can’t reach Seshboard yet. In Seshboard, open Settings › Browser extension and press Connect browsers.'
          : data.message;
    card.append(el('p', data.kind === 'error' ? 'error' : '', message));
    if (data.kind === 'not-running' && data.canLaunch) {
      const open = el('button', 'add', 'Open Seshboard') as HTMLButtonElement;
      open.addEventListener('click', () => {
        open.disabled = true;
        open.textContent = 'Opening Seshboard…';
        void ask({ type: 'seshboard-dialog', action: 'launch' });
      });
      card.append(open);
    }
    document.documentElement.append(host);
    return;
  }

  // What goes sits above where it goes; it is filled once the list and Add exist (below).
  const sendBox = el('div');
  sendBox.style.cssText = 'display: grid; gap: 8px;';
  card.append(sendBox);
  card.append(el('span', 'label', 'To'));
  const search = el('input', 'search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search sessions and projects';
  search.setAttribute('aria-label', 'Search sessions and projects');
  card.append(search);
  const list = el('ul', 'list');
  list.setAttribute('role', 'listbox');
  card.append(list);
  const add = el('button', 'add', 'Add to Seshboard') as HTMLButtonElement;
  card.append(add);
  const status = el('p', 'note', 'Nothing goes to Claude until you send it in Seshboard.');
  card.append(status);

  let selected = data.selected ?? data.options[0]?.value ?? null;
  // What goes: the same choices as the popup's.
  const include = { selection: data.choices.selection === true, page: data.choices.page, screenshot: data.choices.screenshot, console: data.choices.console?.on ?? false };
  sendBox.append(el('span', 'label', 'Send'));
  const chips = el('div', 'chips');
  sendBox.append(chips);
  const quote = el('div', 'quote', data.preview);
  const pageLine = el('div', 'page', data.title);
  sendBox.append(quote, pageLine);
  const chip = (key: 'selection' | 'page' | 'screenshot' | 'console', label: string) => {
    const button = el('button', 'chip', label) as HTMLButtonElement;
    const sync = () => {
      button.setAttribute('aria-pressed', String(include[key]));
      quote.style.display = include.selection ? '' : 'none';
      pageLine.style.display = include.page && data.title ? '' : 'none';
      add.disabled = !selected || !(include.selection || include.page || include.screenshot || include.console);
    };
    button.addEventListener('click', () => {
      include[key] = !include[key];
      sync();
    });
    chips.append(button);
    return sync;
  };
  const syncs: Array<() => void> = [];
  if (data.choices.selection !== null) syncs.push(chip('selection', 'Selection'));
  syncs.push(chip('page', 'Page address'));
  syncs.push(chip('screenshot', 'Screenshot'));
  if (data.choices.console) syncs.push(chip('console', `Console errors (${data.choices.console.count})`));

  let shown = data.options;
  let active = Math.max(0, shown.findIndex((o) => o.value === selected));

  // The same filter as the popup's (filterTargets in payload.ts), written out: this function is copied on its own.
  const filter = (query: string) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return data.options.filter((o) => {
      const text = `${o.label} ${o.detail} ${o.tag ?? ''} ${o.group === 'new' ? 'new session' : ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  };

  const render = () => {
    list.textContent = '';
    if (shown.length === 0) list.append(el('li', 'empty', 'Nothing matches.'));
    for (const group of ['sessions', 'new'] as const) {
      const items = shown.filter((o) => o.group === group);
      if (items.length === 0) continue;
      list.append(el('li', 'group', group === 'sessions' ? 'Sessions' : 'New session'));
      for (const option of items) {
        const index = shown.indexOf(option);
        const row = el('li', `option${index === active ? ' active' : ''}`);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.value === selected));
        const text = el('span', 'text');
        text.append(el('span', '', option.label));
        if (option.detail) text.append(el('span', 'detail', option.detail));
        row.append(text);
        if (option.tag) row.append(el('span', `tag${option.tag === 'Needs you' ? ' warn' : ''}`, option.tag));
        row.append(el('span', 'check', option.value === selected ? '✓' : ''));
        row.addEventListener('mousemove', () => {
          if (active === index) return;
          active = index;
          render();
        });
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => {
          selected = option.value;
          render();
        });
        list.append(row);
      }
    }
    list.querySelector('.option.active')?.scrollIntoView({ block: 'nearest' });
    for (const sync of syncs) sync();
  };

  const submit = () => {
    if (!selected || add.disabled) return;
    add.disabled = true;
    add.textContent = 'Adding…';
    // A screenshot shows the page without this panel: it hides while the tab is captured.
    if (include.screenshot) host.style.setProperty('visibility', 'hidden', 'important');
    const wait = include.screenshot ? new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))) : Promise.resolve();
    void wait.then(() => ask({ type: 'seshboard-dialog', action: 'add', value: selected, include: { ...include } })).then(
      (reply) => {
        host.style.removeProperty('visibility');
        if (reply?.ok) {
          add.textContent = 'Added';
          status.className = 'note';
          status.textContent = `In ${reply.label}. Nothing goes to Claude until you send it in Seshboard.`;
          closeTimer = setTimeout(close, 2500);
        } else {
          add.disabled = false;
          add.textContent = 'Add to Seshboard';
          status.className = 'error';
          status.textContent = reply?.error ?? 'Seshboard did not take it.';
        }
      },
      (error: unknown) => {
        host.style.removeProperty('visibility');
        add.disabled = false;
        add.textContent = 'Add to Seshboard';
        status.className = 'error';
        status.textContent = error instanceof Error ? error.message : String(error);
      },
    );
  };

  search.addEventListener('input', () => {
    shown = filter(search.value);
    active = 0;
    // Typing picks the first match, so Enter adds what you see first.
    if (search.value.trim()) selected = shown[0]?.value ?? null;
    render();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      active = Math.max(0, Math.min(shown.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
      selected = shown[active]?.value ?? selected;
      render();
    } else if (event.key === 'Enter') submit();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  add.addEventListener('click', submit);

  render();
  document.documentElement.append(host);
  search.focus();
}
