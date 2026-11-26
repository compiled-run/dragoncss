// The layout plan of a Markless export: what a phone needs to lay a page out again at its own size with Dragon's translated engine
// (harness.ts runMarklessLayout). Per assignment its engine input variant, dashed borders and scroll containers; per ratio the text
// shaping the build measured, recorded at every root width a phone in PLAN_WIDTHS can have, so the device never shapes text.
// The text is recorded at one viewport height: a page whose text changes with the height is refused.
import { pathToFileURL } from 'node:url';
import type { CalcExpr, ControlBox, FontData, FontLengths, FontMetrics, FontSpec, InlineChild, LayoutBox, LayoutInput, LayoutStyle, LineHeightValue, ReplacedLeaf, TextMeasurer } from '@dragon/layout';
import { layout } from '@dragon/layout';
import type { InteractionProgram, NativeProgram, NativeStyleTarget, StateProgram } from 'dragon';
import { interactionProgramAt, programAt } from 'dragon';
import type { DensityResult } from './markless-plan-workers.ts';
import type { SlotField, SlotRefusal, SlotWrite } from './markless-slots.ts';
import { repoPath } from './paths.ts';
import type { MeasurerRecorder } from './system-fonts/measurer.ts';
import { systemFaceData, systemMeasurer } from './system-fonts/measurer.ts';
import type { SystemFonts } from './system-fonts/provider.ts';

// The harness is loaded by path at run time, as cli/paint-vectors.ts does: it is written in the translator subset, outside this package.
const harness = (await import(pathToFileURL(repoPath('packages/translate/harness/harness.ts')).href)) as { checkMarklessPlan(line: string): string; runMarklessLayout(line: string): string };
const host = (await import(pathToFileURL(repoPath('packages/translate/harness/host.ts')).href)) as { bitsHex(x: number): string; hexBits(s: string): number };
export const hexBits = (s: string): number => host.hexBits(s);

export const MARKLESS_PLAN_VERSION = 'dragon.markless-plan/1';

/** The ratios a target's phones draw at, each with its own recorded shaping (glyph positions are rounded to device px). */
export const PLAN_DENSITIES: { readonly [T in NativeStyleTarget]: readonly number[] } = { ios: [2, 3], android: [2, 2.625, 2.75, 3, 3.5] };

/** The root widths in CSS px whose text the plan records: phones and tablets, portrait and landscape. */
export const PLAN_WIDTHS = { min: 320, max: 1400 } as const;
/** The viewport heights in CSS px at which the plan's text must be the text recorded at the export's height. */
export const PLAN_HEIGHTS = { min: 320, max: 1400 } as const;

export type PlanDensity = {
  readonly dpr: number;
  readonly calls: readonly (readonly unknown[])[];
  /** Only when the text falls back: each fallback call [face, text, start, end, script, language] with the face it gave ('' for none). */
  readonly fallbacks?: readonly (readonly unknown[])[];
  /** [family, size] when the engine's own metrics apply, [family, size, ascent, descent, lineGap, normalGapAbove] otherwise. */
  readonly metrics: readonly (readonly unknown[])[];
  readonly lengths: readonly (readonly unknown[])[];
};
export type PlanAssignment = {
  readonly variant: number;
  /** Each box with border-styles and border-colors writes: [id, styles, rgba per side]. */
  readonly dashed: readonly (readonly unknown[])[];
  readonly scroll: readonly string[];
  /** Only when the assignment has one: each themed checkbox (a checkbox write), whose marks the device layout returns. */
  readonly checkboxes?: readonly string[];
  /** Only for an input with slots: the style fields and write numbers that follow them (markless-slots.ts). */
  readonly slotFields?: readonly SlotField[];
  readonly slotWrites?: readonly SlotWrite[];
  readonly slotRefusals?: readonly SlotRefusal[];
};

/** The device's reader of a plan (harness.ts checkMarklessPlan): ["ok"] or the first part it cannot read. */
export const checkPlan = (line: string): string => harness.checkMarklessPlan(line);

/** The phone's layout of a plan's assignment at these slot values (harness.ts runMarklessLayout), parsed. */
export function slottedLayout(plan: MarklessPlan, assignment: number, viewport: { readonly width: number; readonly height: number }, dpr: number, slots: readonly number[]): readonly unknown[] {
  const line = { assignment, dpr, viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan, slots: slots.map((v) => host.bitsHex(v)) };
  return JSON.parse(harness.runMarklessLayout(JSON.stringify(line))) as readonly unknown[];
}
export type MarklessPlan = {
  readonly version: typeof MARKLESS_PLAN_VERSION;
  readonly faces: readonly { readonly id: string; readonly data: FontData }[];
  readonly densities: readonly PlanDensity[];
  readonly variants: StateProgram['variants'];
  readonly assignments: readonly PlanAssignment[];
  /** Only for an input with slots: each slot's id and type, in the order the line gives their values; the phone refuses a fraction for an integer slot. */
  readonly slots?: readonly (readonly [id: string, type: 'number' | 'integer'])[];
  /** The text leaves the build lays out with a text-transform; the phone refuses a page text for one (harness.ts withPageTexts). */
  readonly transformed?: readonly string[];
};

type Write = { readonly kind: string } & Readonly<Record<string, unknown>>;

/** The root widths a phone of ratio dpr in PLAN_WIDTHS can have: every whole device px, and every whole CSS px (Chrome on Android). */
export function planWidths(dpr: number): number[] {
  const out = new Set<number>();
  for (let px = Math.ceil(PLAN_WIDTHS.min * dpr); px <= Math.floor(PLAN_WIDTHS.max * dpr); px++) out.add(px / dpr);
  for (let w = PLAN_WIDTHS.min; w <= PLAN_WIDTHS.max; w++) out.add(w);
  return [...out].sort((a, b) => a - b);
}

/** The media features whose value changes with the viewport's height. */
export const HEIGHT_FEATURES: ReadonlySet<string> = new Set(['height', 'orientation', 'aspect-ratio']);

/** Whether a calculation reads the viewport's height: vh, vmin or vmax of any size, directly or through a font size it reads. */
function readsHeight(e: CalcExpr): boolean {
  switch (e.kind) {
    case 'viewport':
      return e.axis !== 'width';
    case 'em':
      return readsHeight(e.fontSize);
    case 'font-metric':
      return readsHeight(e.font.specifiedSize);
    case 'lh':
      return readsHeight(e.font.specifiedSize) || (e.lineHeight.kind === 'calc' && readsHeight(e.lineHeight.expr));
    case 'font-percent':
      return readsHeight(e.parent);
    case 'font-calc':
      return readsHeight(e.expr) || readsHeight(e.parent);
    case 'invert':
      return readsHeight(e.term);
    case 'clamp':
      return readsHeight(e.min) || readsHeight(e.value) || readsHeight(e.max);
    case 'sum':
    case 'product':
    case 'min':
    case 'max':
      return e.terms.some(readsHeight);
    case 'px':
    case 'percent':
    case 'number':
    case 'rem':
    case 'env':
    case 'pixels-and-percent':
      return false;
  }
}

const heightIn = (v: { readonly kind: string; readonly expr?: CalcExpr }): boolean => v.kind === 'calc' && v.expr !== undefined && readsHeight(v.expr);

/**
 * Why a page's text may change with the viewport height, or null when Dragon's analysis of its program proves it cannot. The
 * height reaches layout as the initial containing block's height, as vh, vmin and vmax, and through height media features. A
 * block size reaches an inline size, which is all that decides the text shaped, only through an aspect-ratio, a replaced
 * element's ratio, a multi-line column flex container, column-flow or auto-repeated grid rows, multi-column layout or anchor
 * positioning; a page with none of them and no vh, vmin or vmax in an inline-axis length or a font cannot shape other text at
 * another height.
 */
export function heightDependence(sp: StateProgram, bandFeatures: Iterable<string>): string | null {
  for (const f of bandFeatures) if (HEIGHT_FEATURES.has(f)) return `a media query on ${f}`;
  const font = (f: FontSpec, lineHeight: LineHeightValue): boolean => readsHeight(f.specifiedSize) || heightIn(lineHeight);
  const style = (id: string, st: LayoutStyle): string | null => {
    if (st.aspectRatio.kind !== 'auto') return `${id} has an aspect-ratio`;
    if (st.multicol !== null) return `${id} is a multi-column container`;
    if (st.anchor !== null) return `${id} is anchor-positioned`;
    if ((st.display === 'flex' || st.display === 'inline-flex') && (st.flexDirection === 'column' || st.flexDirection === 'column-reverse') && st.flexWrap !== 'nowrap') return `${id} is a multi-line column flex container`;
    if (st.grid !== null && (st.grid.autoFlow === 'column' || st.grid.autoRepeatRows !== null)) return `${id} places grid items by its rows`;
    const inlineAxis = [st.width, st.minWidth, st.maxWidth, st.left, st.right, st.marginLeft, st.marginRight, st.paddingLeft, st.paddingRight, st.borderLeftWidth, st.borderRightWidth, st.flexBasis, st.columnGap, st.textIndent];
    if (inlineAxis.some(heightIn)) return `${id} has an inline-axis length in vh, vmin or vmax`;
    if (st.grid !== null) {
      const tracks = [...st.grid.templateColumns.flatMap((r) => r.sizes), ...st.grid.autoColumns, ...(st.grid.autoRepeatColumns?.sizes ?? [])];
      for (const t of tracks) if ((t.kind === 'breadth' && heightIn(t.breadth)) || (t.kind === 'minmax' && (heightIn(t.min) || heightIn(t.max))) || (t.kind === 'fit-content' && heightIn(t.limit))) return `${id} has a grid column in vh, vmin or vmax`;
    }
    return null;
  };
  const inline = (c: InlineChild): string | null => {
    if (font(c.font, c.lineHeight)) return `${c.id} has a font size or line height in vh, vmin or vmax`;
    if (c.kind === 'text') return readsHeight(c.letterSpacing) || readsHeight(c.wordSpacing) ? `${c.id} has spacing in vh, vmin or vmax` : null;
    if (c.kind === 'br') return null;
    return style(c.id, c.style) ?? c.children.map(inline).find((r) => r !== null) ?? null;
  };
  const box = (b: LayoutBox | ControlBox | ReplacedLeaf): string | null => {
    if (b.kind === 'replaced') return `${b.id} is a replaced element, whose size follows its ratio`;
    const own = style(b.id, b.style);
    if (own !== null) return own;
    if (b.strut !== null && font(b.strut.font, b.strut.lineHeight)) return `${b.id} has a font size or line height in vh, vmin or vmax`;
    if (b.kind === 'box' && b.marker !== null && font(b.marker.font, b.marker.lineHeight)) return `${b.id}'s marker has a font size in vh, vmin or vmax`;
    if (b.kind === 'control' && 'font' in b.control && font(b.control.font, b.control.lineHeight)) return `${b.id} has a font size or line height in vh, vmin or vmax`;
    // A select is as wide as its widest option, whose text is not among its children.
    if (b.kind === 'control' && b.control.kind === 'select-menulist') for (const o of b.control.options) {
      const r = inline(o);
      if (r !== null) return r;
    }
    for (const c of b.children) {
      const r = c.kind === 'box' || c.kind === 'control' || c.kind === 'replaced' ? box(c) : inline(c);
      if (r !== null) return r;
    }
    return null;
  };
  for (const v of sp.variants) {
    const r = box(v.root as LayoutBox);
    if (r !== null) return r;
  }
  return null;
}

/** Told of every layout a recording makes; a plan worker counts them, so its pool tells a stopped worker from a slow one. */
export const recordingProgress: { onLayout: () => void } = { onLayout: () => {} };

/** One ratio's recording: every variant at every PLAN_WIDTHS root width, then checked at PLAN_HEIGHTS' heights. */
export function recordDensity(t: NativeStyleTarget, sp: StateProgram, system: SystemFonts, bundled: readonly string[], authorFiles: ReadonlyMap<string, Uint8Array>, dpr: number, height: number, checkHeights = true, familyFallbacks: Readonly<Record<string, string>> = {}): PlanDensity {
  const calls = new Map<string, readonly unknown[]>();
  const fallbacks = new Map<string, readonly unknown[]>();
  const metrics = new Map<string, readonly unknown[]>();
  const lengths = new Map<string, readonly unknown[]>();
  const recorder: MeasurerRecorder = {
    shape(call, glyphs) {
      calls.set(JSON.stringify(call), [...call, [...glyphs]]);
    },
    fallback(call, face) {
      fallbacks.set(JSON.stringify(call), [...call, face]);
    },
    metrics(family, size, m: FontMetrics | null) {
      metrics.set(`${family}@${size}`, m === null ? [family, size] : [family, size, m.ascent, m.descent, m.lineGap, m.normalGapAbove]);
    },
    lengths(family, size, l: FontLengths) {
      lengths.set(`${family}@${size}`, [family, size, l.xHeight, l.capHeight, l.zeroWidth]);
    },
  };
  const lay = (m: TextMeasurer, vi: number, width: number, h: number): void => {
    const v = sp.variants[vi] as StateProgram['variants'][number];
    const viewport = { width, height: h };
    const input: LayoutInput = { viewport, devicePixelRatio: dpr, viewportUnits: { small: viewport, large: viewport, dynamic: viewport }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: v.rootFontSize, root: v.root };
    const r = layout(input, m);
    recordingProgress.onLayout();
    if (r.kind !== 'ok') throw new Error(`${t}: the engine refused variant ${vi} at ${width} x ${h} css px and ${dpr}x: ${r.unsupported.code} at ${r.unsupported.nodeId}`);
  };
  const m = systemMeasurer(system, sp, bundled, dpr, authorFiles, recorder, familyFallbacks);
  const widths = planWidths(dpr);
  sp.variants.forEach((_, vi) => {
    for (const width of widths) lay(m, vi, width, height);
  });
  if (!checkHeights) return { dpr, calls: [...calls.values()], ...(fallbacks.size === 0 ? {} : { fallbacks: [...fallbacks.values()] }), metrics: [...metrics.values()], lengths: [...lengths.values()] };
  const unrecorded: string[] = [];
  const check: MeasurerRecorder = {
    shape(call) {
      if (!calls.has(JSON.stringify(call))) unrecorded.push(`shapes ${JSON.stringify(call[2])} in ${String(call[0])} at ${String(call[1])} css px`);
    },
    fallback(call) {
      if (!fallbacks.has(JSON.stringify(call))) unrecorded.push(`falls back from ${String(call[0])} for ${JSON.stringify(call[1])}`);
    },
    metrics(family, size) {
      if (!metrics.has(`${family}@${size}`)) unrecorded.push(`reads the metrics of ${family} at ${size} css px`);
    },
    lengths(family, size) {
      if (!lengths.has(`${family}@${size}`)) unrecorded.push(`reads the lengths of ${family} at ${size} css px`);
    },
  };
  const strict = systemMeasurer(system, sp, bundled, dpr, authorFiles, check, familyFallbacks);
  sp.variants.forEach((_, vi) => {
    for (const h of [PLAN_HEIGHTS.min, PLAN_HEIGHTS.max]) for (const width of widths) {
      lay(strict, vi, width, h);
      if (unrecorded.length > 0) throw new Error(`${t}: variant ${vi} at ${width} x ${h} css px and ${dpr}x ${unrecorded[0]}, which it does not at height ${height}; the plan records text at one viewport height, so a page whose text depends on the height (a font size in vh, vmin or vmax, a text box sized by the height) has none`);
    }
  });
  return { dpr, calls: [...calls.values()], ...(fallbacks.size === 0 ? {} : { fallbacks: [...fallbacks.values()] }), metrics: [...metrics.values()], lengths: [...lengths.values()] };
}

/**
 * The plan of one target. `system(dpr)` is the target's system fonts at a ratio; `bundled` the face ids the measurer reads from
 * bundled files; `height` the height every recorded layout uses. A page whose text at PLAN_HEIGHTS' heights is not the text
 * recorded at `height` is refused, and so is a plan the device's reader (harness.ts checkMarklessPlan) cannot read all of, by field.
 */
/** The program a target's plan records: its own, or with interaction states every variant one of them lays out too. */
export const planStateProgram = (sp: StateProgram, interaction?: InteractionProgram): StateProgram => (interaction === undefined ? sp : { ...sp, variants: interaction.variants });

export function marklessPlan(t: NativeStyleTarget, sp: StateProgram, system: (dpr: number) => SystemFonts, bundled: readonly string[], authorFiles: ReadonlyMap<string, Uint8Array>, height: number, interaction?: InteractionProgram, recorded?: readonly DensityResult[], checkHeights = true, fallbacks: Readonly<Record<string, string>> = {}): MarklessPlan {
  // With interaction states each state is one more plan assignment, after the program's, in level then state order.
  const all = planStateProgram(sp, interaction);
  const densities = PLAN_DENSITIES[t].map((dpr, i) => {
    const r = recorded?.[i];
    if (r === undefined) return recordDensity(t, all, system(dpr), bundled, authorFiles, dpr, height, checkHeights, fallbacks);
    if ('error' in r) throw new Error(r.error);
    return r.density;
  });
  const faces = systemFaceData(system(PLAN_DENSITIES[t][0] as number), all, bundled);
  const entry = (program: NativeProgram, variant: number): PlanAssignment => {
    const dashed: (readonly unknown[])[] = [];
    const scroll: string[] = [];
    const checkboxes: string[] = [];
    for (const n of program.nodes) {
      const writes = n.writes as readonly Write[];
      const styles = writes.find((w) => w.kind === 'border-styles')?.['styles'] as readonly string[] | undefined;
      const colors = writes.find((w) => w.kind === 'border-colors')?.['colors'] as readonly { r: number; g: number; b: number; alpha: number }[] | undefined;
      if (styles !== undefined && colors !== undefined) dashed.push([n.id, styles, colors.flatMap((c) => [c.r, c.g, c.b, c.alpha])]);
      if (writes.some((w) => w.kind === 'scroll-container')) scroll.push(n.id);
      if (writes.some((w) => w.kind === 'checkbox')) checkboxes.push(n.id);
    }
    return checkboxes.length === 0 ? { variant, dashed, scroll } : { variant, dashed, scroll, checkboxes };
  };
  const assignments = [
    ...sp.assignments.map((_, i) => entry(programAt(sp, i), (sp.deltas[i] as { readonly variant: number }).variant)),
    ...(interaction?.levels.flatMap((l, i) => l.deltas.map((d, k) => entry(interactionProgramAt(interaction, i, k), d.variant))) ?? []),
  ];
  const plan: MarklessPlan = { version: MARKLESS_PLAN_VERSION, faces: [...faces].map(([id, data]) => ({ id, data })), densities, variants: all.variants, assignments };
  const read = JSON.parse(harness.checkMarklessPlan(JSON.stringify(plan))) as readonly unknown[];
  if (read[0] !== 'ok') throw new Error(`${t}: the device cannot read this page's layout plan: ${read[0] === 'harness-error' ? String(read[1]) : 'its reader threw'}`);
  return plan;
}

/** The plan assignment of each interaction state, per level: after the program's own, in level then state order. */
export function planInteractionAssignments(sp: StateProgram, interaction: InteractionProgram): number[][] {
  let next = sp.assignments.length;
  return interaction.levels.map((l) => l.deltas.map(() => next++));
}
