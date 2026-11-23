// The layout plan of a Markless export: what a phone needs to lay a page out again at its own size with Dragon's translated engine
// (harness.ts runMarklessLayout). Per assignment its engine input variant, dashed borders and scroll containers; per ratio the text
// shaping the build measured, recorded at every root width a phone in PLAN_WIDTHS can have, so the device never shapes text.
// The text is recorded at one viewport height: a page whose text changes with the height is refused.
import { pathToFileURL } from 'node:url';
import type { FontData, FontLengths, FontMetrics, LayoutInput, TextMeasurer } from '@dragon/layout';
import { layout } from '@dragon/layout';
import type { NativeStyleTarget, StateProgram } from 'dragon';
import { programAt } from 'dragon';
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
  /** [family, size] when the engine's own metrics apply, [family, size, ascent, descent, lineGap, normalGapAbove] otherwise. */
  readonly metrics: readonly (readonly unknown[])[];
  readonly lengths: readonly (readonly unknown[])[];
};
export type PlanAssignment = {
  readonly variant: number;
  /** Each box with border-styles and border-colors writes: [id, styles, rgba per side]. */
  readonly dashed: readonly (readonly unknown[])[];
  readonly scroll: readonly string[];
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

function recordDensity(t: NativeStyleTarget, sp: StateProgram, system: SystemFonts, bundled: readonly string[], authorFiles: ReadonlyMap<string, Uint8Array>, dpr: number, height: number): PlanDensity {
  const calls = new Map<string, readonly unknown[]>();
  const metrics = new Map<string, readonly unknown[]>();
  const lengths = new Map<string, readonly unknown[]>();
  const recorder: MeasurerRecorder = {
    shape(call, glyphs) {
      calls.set(JSON.stringify(call), [...call, [...glyphs]]);
    },
    metrics(family, size, m: FontMetrics | null) {
      metrics.set(`${family}@${size}`, m === null ? [family, size] : [family, size, m.ascent, m.descent, m.lineGap, m.normalGapAbove]);
    },
    lengths(family, size, l: FontLengths) {
      lengths.set(`${family}@${size}`, [family, size, l.xHeight, l.capHeight, l.zeroWidth, l.xWidth]);
    },
  };
  const lay = (m: TextMeasurer, vi: number, width: number, h: number): void => {
    const v = sp.variants[vi] as StateProgram['variants'][number];
    const viewport = { width, height: h };
    const input: LayoutInput = { viewport, devicePixelRatio: dpr, viewportUnits: { small: viewport, large: viewport, dynamic: viewport }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: v.rootFontSize, root: v.root };
    const r = layout(input, m);
    if (r.kind !== 'ok') throw new Error(`${t}: the engine refused variant ${vi} at ${width} x ${h} css px and ${dpr}x: ${r.unsupported.code} at ${r.unsupported.nodeId}`);
  };
  const m = systemMeasurer(system, sp, bundled, dpr, authorFiles, recorder);
  const widths = planWidths(dpr);
  sp.variants.forEach((_, vi) => {
    for (const width of widths) lay(m, vi, width, height);
  });
  const unrecorded: string[] = [];
  const check: MeasurerRecorder = {
    shape(call) {
      if (!calls.has(JSON.stringify(call))) unrecorded.push(`shapes ${JSON.stringify(call[2])} in ${String(call[0])} at ${String(call[1])} css px`);
    },
    metrics(family, size) {
      if (!metrics.has(`${family}@${size}`)) unrecorded.push(`reads the metrics of ${family} at ${size} css px`);
    },
    lengths(family, size) {
      if (!lengths.has(`${family}@${size}`)) unrecorded.push(`reads the lengths of ${family} at ${size} css px`);
    },
  };
  const strict = systemMeasurer(system, sp, bundled, dpr, authorFiles, check);
  sp.variants.forEach((_, vi) => {
    for (const h of [PLAN_HEIGHTS.min, PLAN_HEIGHTS.max]) for (const width of widths) {
      lay(strict, vi, width, h);
      if (unrecorded.length > 0) throw new Error(`${t}: variant ${vi} at ${width} x ${h} css px and ${dpr}x ${unrecorded[0]}, which it does not at height ${height}; the plan records text at one viewport height, so a page whose text depends on the height (a font size in vh, vmin or vmax, a text box sized by the height) has none`);
    }
  });
  return { dpr, calls: [...calls.values()], metrics: [...metrics.values()], lengths: [...lengths.values()] };
}

/**
 * The plan of one target. `system(dpr)` is the target's system fonts at a ratio; `bundled` the face ids the measurer reads from
 * bundled files; `height` the height every recorded layout uses. A page whose text at PLAN_HEIGHTS' heights is not the text
 * recorded at `height` is refused, and so is a plan the device's reader (harness.ts checkMarklessPlan) cannot read all of, by field.
 */
export function marklessPlan(t: NativeStyleTarget, sp: StateProgram, system: (dpr: number) => SystemFonts, bundled: readonly string[], authorFiles: ReadonlyMap<string, Uint8Array>, height: number): MarklessPlan {
  const densities = PLAN_DENSITIES[t].map((dpr) => recordDensity(t, sp, system(dpr), bundled, authorFiles, dpr, height));
  const faces = systemFaceData(system(PLAN_DENSITIES[t][0] as number), sp, bundled);
  const assignments = sp.assignments.map((_, i): PlanAssignment => {
    const program = programAt(sp, i);
    const dashed: (readonly unknown[])[] = [];
    const scroll: string[] = [];
    for (const n of program.nodes) {
      const writes = n.writes as readonly Write[];
      const styles = writes.find((w) => w.kind === 'border-styles')?.['styles'] as readonly string[] | undefined;
      const colors = writes.find((w) => w.kind === 'border-colors')?.['colors'] as readonly { r: number; g: number; b: number; alpha: number }[] | undefined;
      if (styles !== undefined && colors !== undefined) dashed.push([n.id, styles, colors.flatMap((c) => [c.r, c.g, c.b, c.alpha])]);
      if (writes.some((w) => w.kind === 'scroll-container')) scroll.push(n.id);
    }
    return { variant: (sp.deltas[i] as { readonly variant: number }).variant, dashed, scroll };
  });
  const plan: MarklessPlan = { version: MARKLESS_PLAN_VERSION, faces: [...faces].map(([id, data]) => ({ id, data })), densities, variants: sp.variants, assignments };
  const read = JSON.parse(harness.checkMarklessPlan(JSON.stringify(plan))) as readonly unknown[];
  if (read[0] !== 'ok') throw new Error(`${t}: the device cannot read this page's layout plan: ${read[0] === 'harness-error' ? String(read[1]) : 'its reader threw'}`);
  return plan;
}
