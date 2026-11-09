/**
 * What `read_me` gives the agent before its first visual: how Seshboard's frame draws one (`main/visualFrame.ts`), in
 * Seshboard's own words. The core always; a module's part when it asks for that module.
 */

export const VISUAL_MODULES = ['diagram', 'mockup', 'interactive', 'chart', 'art'] as const;
export type VisualModule = (typeof VISUAL_MODULES)[number];

const CORE = `# Visuals in the conversation

show_widget draws HTML or an SVG inline in the conversation, where you call it. Use it when a picture explains
better than words: a flow, a structure, a comparison, a chart, a small tool to play with. Write the explanation in
your reply, outside the call. The visual holds only the visual: no headings, titles or paragraphs of prose inside it.

## The frame

- widget_code is a fragment: no <!doctype>, <html>, <head> or <body>. An SVG starts with <svg>.
- The frame is the width of the conversation (about 680px) and grows to the height of what you draw. Nothing scrolls
  inside it, and there is no fullscreen. Do not use position: fixed.
- The background is the conversation's. Leave the outer element transparent.
- Order the code as it should appear: a short <style> first, then the content, then <script> last. Scripts run once
  the whole code is in place, in order. A library loaded with <script src> finishes loading before the next script.
- Scripts, styles and fonts load only from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh and Google Fonts.
  Anything else is blocked. Prefer UMD builds from cdnjs, then use their global in a plain script after them.
- The Tabler outline icon font is there when you use it: <i class="ti ti-chart-bar" aria-hidden="true"></i>. Outline
  icons only; size them with font-size (16px to 24px).
- No comments in the code, no gradients, shadows, blur or glow. Flat fills and thin lines.

## Colours and type

Every colour comes from a variable, so the visual follows light and dark mode and the user's theme:

- Text: --text-primary, --text-secondary (supporting), --text-muted (hints, captions).
- Surfaces: --surface-0 (the page), --surface-1 (a tinted tile), --surface-2 (a raised card).
- Lines: --border (default), --border-strong, --border-stronger.
- Roles, each as --bg-*, --text-* and --border-*: accent, danger, success, warning.
- Type and shape: --font-sans, --font-mono, --font-voice (a serif), --radius (controls; use 12px for cards).
- Spacing: --gap-xs to --gap-xl, --pad-sm to --pad-xl.

Never write a hex colour for text or a background in HTML. Body text is 16px with line-height 1.7, headings h1 22px,
h2 18px, h3 16px, all weight 500. Use only weights 400 and 500, and sentence case everywhere. No text below 11px.

Buttons, text fields, selects and range sliders are styled already: write bare tags. A button that asks you a
question with sendPrompt ends with ↗.

## Talking back

- sendPrompt(text) puts text in the user's message box, for them to send. Use it for a next step that needs you to
  think. Do filtering, sorting and maths in the visual's own script instead.
- openLink(url) opens a link in the browser. <a href="https://…"> does the same.
- Round every number you show (toFixed, Math.round, Intl.NumberFormat).

## SVG

- <svg width="100%" viewBox="0 0 680 H" role="img"> with <title> and <desc> first. Keep 680 as the width so units are
  pixels. Set H to the lowest element plus 40.
- Every <text> takes a class: t (14px, primary), ts (12px, secondary) or th (14px, weight 500).
- box is a neutral rect, node a clickable group, arr a connector line, leader a thin dashed line.
- Colour a node with a ramp class on its <g> or on the shape itself: c-gray, c-blue, c-teal, c-green, c-amber, c-coral,
  c-red, c-pink, c-purple. The class colours the shapes and text directly inside it, in light and dark. Use two or
  three ramps at most, by meaning (all nodes of one kind share one), and gray for neutral steps.
- Connectors are <line> or <path> with fill="none". For an arrow head, add this marker and use marker-end:
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6"
  orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>
- SVG text never wraps: keep labels short (a 14px character is about 8px wide) and check that each fits its box.
- One <svg> per call, no rotated text, and nothing outside the viewBox.
`;

const MODULES: Record<VisualModule, string> = {
  diagram: `## Diagrams

- A flowchart reads top to bottom or left to right, with no more than four boxes in a row (about 140px each).
- Box labels are short: a title, and a subtitle of five words at most. Detail goes in your reply.
- Lines stop at the edge of a box; never draw through a box and hide the line under its fill.
- Group related nodes in a dashed rect with a label, rather than drawing literal shapes (clouds, servers).
- A diagram with colours that mean something gets a one-line legend.
`,
  mockup: `## Mockups

- A small mockup (a phone screen, a card, a dialog) sits on a --surface-1 tile with 12px corners and padding, so it
  doesn't float on the page. A full-width one (a dashboard, a settings page) needs no tile.
- Cards are --surface-2 with a 0.5px --border and 12px corners. A number on its own (a metric) is a --surface-1 tile
  with a 13px label above a 24px number.
- Use CSS grid with repeat(auto-fit, minmax(160px, 1fr)) for columns, and minmax(0, 1fr) so long content can't push
  a column wider.
- For a modal, draw a normal-flow wrapper with a dimmed background and the dialog inside it.
`,
  interactive: `## Interactive explainers

- Show the controls and what they change side by side, and update the result as the control moves (an input event).
- Give each slider a step and show its value next to it, rounded.
- Check input before acting on it: an empty or wrong field shows a short message under it in --text-danger.
- Steppers and tabs are fine once the script runs; keep all content in the flow while the code is written.
`,
  chart: `## Charts

- Use Chart.js from cdnjs (https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js), or D3 for maps
  and custom charts. Give the canvas a parent with a fixed height (for example 280px).
- Read colours from the variables at run time: getComputedStyle(document.documentElement).getPropertyValue(...).
- Axes and grid lines in --text-muted and --border; labels at 12px. One series per colour, from the ramps' 400 stops.
- Pick the chart by the question: a line over time, bars to compare, a stacked bar for parts of a whole.
`,
  art: `## Art

- Art is the one place for colours of your own: write them in a <style> block, with dark variants under
  [data-mode="dark"].
- Keep it flat and calm; SVG or a canvas with a short script both work.
`,
};

/** The guide for the modules asked for (the core alone without any). */
export function visualGuide(modules: readonly string[]): string {
  const picked = VISUAL_MODULES.filter((name) => modules.includes(name));
  return [CORE, ...picked.map((name) => MODULES[name])].join('\n');
}
