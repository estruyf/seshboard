import { composite, parseColor, toHex, type Rgba } from '@seshboard/protocol/color';

/**
 * Mermaid's `themeVariables` from the app's theme tokens, so a diagram looks like the rest of the conversation in every
 * theme, light and dark. Pure, for testing: `read` gives a CSS variable's value where the diagram goes
 * (`getComputedStyle(document.documentElement)`), so it follows the active theme and the colour scheme.
 *
 * Mermaid works the colours out with a parser that knows hex, `rgb()` and `hsl()` but not `oklch()` (a theme may use it),
 * and it can't mix with transparency, so every colour here is a plain `#rrggbb`: a tint is the colour drawn over the page.
 * A token the theme lacks falls back to a neutral grey (the theme validator keeps that from happening in practice).
 */
export function mermaidThemeVariables(read: (variable: string) => string): Record<string, unknown> {
  const rgba = (name: string): Rgba => parseColor(read(`--sb-${name}`)) ?? { r: 0.5, g: 0.5, b: 0.5, a: 1 };
  const bgColour = rgba('bg');
  // Opaque, so a translucent page colour doesn't leak into the tints.
  const page = composite(bgColour, { r: 1, g: 1, b: 1, a: 1 });
  const solid = (name: string) => toHex(composite(rgba(name), page));
  /** `percent` of a token over the page: a fill that is the colour's, but quiet. */
  const tint = (name: string, percent: number) => toHex(composite({ ...rgba(name), a: (rgba(name).a * percent) / 100 }, page));

  const bg = toHex(page);
  const text = solid('text');
  const muted = solid('muted');
  const border = solid('border');
  const accent = solid('accent-ink');
  const link = solid('link');
  const caution = solid('caution');
  const error = solid('error');
  const ok = solid('ok');
  // The Usage view's series are checked for colour blindness in this order, so slices and bars take them in it.
  const series = ['chart-output', 'chart-cache-write', 'chart-cache-read', 'chart-input', 'chart-shipped', 'accent-ink', 'memory', 'pipeline', 'ok', 'warn', 'caution', 'link'].map(solid);
  const font = read('--font-sans').trim();

  const variables: Record<string, unknown> = {
    darkMode: luminanceOf(page) < 0.5,
    background: bg,
    ...(font && { fontFamily: font }),
    fontSize: '14px',
    // Nodes: a tint of the accent with its ink for the edge, which stays readable on both pages.
    primaryColor: tint('accent-ink', 16),
    primaryBorderColor: accent,
    primaryTextColor: text,
    secondaryColor: tint('link', 14),
    secondaryBorderColor: link,
    secondaryTextColor: text,
    tertiaryColor: tint('text', 6),
    tertiaryBorderColor: border,
    tertiaryTextColor: text,
    mainBkg: tint('accent-ink', 16),
    nodeBorder: accent,
    nodeTextColor: text,
    textColor: text,
    titleColor: text,
    lineColor: muted,
    arrowheadColor: muted,
    edgeLabelBackground: bg,
    clusterBkg: solid('code-bg'),
    clusterBorder: border,
    noteBkgColor: tint('caution', 15),
    noteBorderColor: caution,
    noteTextColor: text,
    errorBkgColor: tint('error', 15),
    errorTextColor: error,
    // Sequence diagrams.
    actorBkg: tint('accent-ink', 16),
    actorBorder: accent,
    actorTextColor: text,
    actorLineColor: muted,
    signalColor: text,
    signalTextColor: text,
    labelBoxBkgColor: tint('text', 6),
    labelBoxBorderColor: border,
    labelTextColor: text,
    loopTextColor: text,
    activationBkgColor: tint('link', 14),
    activationBorderColor: link,
    sequenceNumberColor: bg,
    // State, class and ER diagrams read their own names for the same roles.
    altBackground: tint('text', 6),
    compositeBackground: tint('text', 6),
    compositeBorder: border,
    classText: text,
    labelColor: text,
    attributeBackgroundColorOdd: bg,
    attributeBackgroundColorEven: tint('text', 6),
    // Pie charts: a label sits on its slice, whose colour is picked to contrast with the page, so the page's colour is the ink.
    pieTitleTextColor: text,
    pieSectionTextColor: bg,
    pieLegendTextColor: text,
    pieStrokeColor: bg,
    pieOuterStrokeColor: border,
    pieOpacity: '1',
    // Gantt and journey.
    gridColor: border,
    todayLineColor: error,
    doneTaskBkgColor: tint('ok', 30),
    doneTaskBorderColor: ok,
    activeTaskBkgColor: tint('accent-ink', 30),
    activeTaskBorderColor: accent,
    taskBkgColor: tint('link', 18),
    taskBorderColor: link,
    taskTextColor: text,
    taskTextDarkColor: text,
    taskTextOutsideColor: text,
    critBkgColor: tint('error', 25),
    critBorderColor: error,
    sectionBkgColor: tint('text', 6),
    altSectionBkgColor: bg,
    sectionBkgColor2: tint('text', 10),
    // Bar and line charts (`xychart-beta`).
    xyChart: {
      backgroundColor: bg,
      titleColor: text,
      xAxisLabelColor: text,
      xAxisTitleColor: text,
      xAxisTickColor: muted,
      xAxisLineColor: muted,
      yAxisLabelColor: text,
      yAxisTitleColor: text,
      yAxisTickColor: muted,
      yAxisLineColor: muted,
      plotColorPalette: series.join(','),
    },
  };
  series.forEach((colour, i) => {
    variables[`pie${i + 1}`] = colour;
  });
  return variables;
}

/** Relative luminance of an opaque colour, only to tell a dark page from a light one. */
function luminanceOf({ r, g, b }: Rgba): number {
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
