// The native style export (docs/markless-native-styles.md "The export"), generalised from the Markless counter's
// dragon.native-style-export/0: from compileNativeStyles' state programs, per target and per reachable state assignment, every
// node's lowered writes and the frame the reference engine lays it out at for the proof device, in device px.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { BorderOp, LayoutBox, LU, ScrollRange, TextMeasurer } from '@dragon/layout';
import { absoluteRects, borderNeedsSidePainter, borderPaintOps, LU_PER_PX, NO_DASH_FAULTS, NO_ENGINE_FAULTS, pieceGlyphs, resolveBorder, scrollRanges, snapRect } from '@dragon/layout';
import type { Assignment, NativeProgram, NativeStyles, NativeStyleTarget, Scalar } from 'dragon';
import { animTablesOf, borderDevicePx, isScalar, programAt, programInput, replacedContents } from 'dragon';
import type { AnimTables } from '@dragon/layout';
import { scrollMetricsWithFaults } from '../../layout/src/overflow.ts';
import { snapEdge } from '../../layout/src/units.ts';
import { cssFontSizes } from './ahem-lines.ts';
import type { EngineText } from './line-breaks.ts';
import { engineTextLines } from './line-breaks.ts';
import { engineBoxes, expectedEngine, referenceMeasurer } from './native-host.ts';
import { viewportDirectionOf } from './scroll-metrics.ts';
import { registerFace } from './text-shaper-host.ts';
import { repoPath } from './paths.ts';
import { systemMeasurer } from './system-fonts/measurer.ts';
import type { MarklessPlan } from './markless-plan.ts';
import { marklessPlan, PLAN_DENSITIES } from './markless-plan.ts';
import type { DensityJob, DensityResult } from './markless-plan-workers.ts';
import { planWorkers, recordDensitiesInWorkers } from './markless-plan-workers.ts';
import type { SystemFaceDescriptor, SystemFonts } from './system-fonts/provider.ts';
import { systemFontsFor, systemRequestOf } from './system-fonts/provider.ts';

export const NATIVE_STYLE_EXPORT_SCHEMA = 'dragon.native-style-export/1';

export type ExportDevice = { readonly viewport: { readonly width: number; readonly height: number }; readonly dpr: number };

/** The proof devices of the counter export: the iPhone 17 simulator's safe-area size in points at 3x, the Pixel 7 emulator in whole dp at 420 dpi. */
export const EXPORT_DEVICES: { readonly [T in NativeStyleTarget]: ExportDevice } = {
  ios: { viewport: { width: 402, height: 778 }, dpr: 3 },
  android: { viewport: { width: 411, height: 818 }, dpr: 2.625 },
};

type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
/** A scroll offset range in whole device px, in CSS scroll-offset terms: 0 is the start position, and the user scrolls between min and max. */
export type ScrollOffsets = { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
/** Consecutive glyphs of a line in one face at one instance size (device px), each x its pen origin. */
export type GlyphRun = { readonly face: string; readonly size: number; readonly glyphs: readonly number[]; readonly xs: readonly number[] };
/** One engine line of a text node: its line box top and baseline, in device px from the node's frame. */
export type TextLine = { readonly top: number; readonly baseline: number; readonly runs: readonly GlyphRun[] };
export type ExportNode = {
  readonly id: string;
  readonly parent: string | null;
  readonly kind: string;
  readonly native: string;
  readonly text: string | null;
  readonly frame: Frame | null;
  readonly borderWidths: Readonly<Record<string, number>> | null;
  readonly writes: readonly Readonly<Record<string, unknown>>[];
  /**
   * Only for a box with a visible dashed or dotted side: the drawing operations Dragon's own native paint runs for its border
   * (paint-dash.ts, Blink 145's side painter, judged against Chrome's pixels by p6a-dash-oracle), in device px with the snapped
   * border box's top-left at `origin`, which is relative to this node's frame; `size` is that box and `widths` its sides (top,
   * right, bottom, left) in whole device px.
   */
  readonly borderOps?: { readonly origin: { readonly x: number; readonly y: number }; readonly size: { readonly width: number; readonly height: number }; readonly widths: readonly number[]; readonly ops: readonly BorderOp[] };
  /** Only on a node with a scroll-container write: the offset range its scroll view scrolls over. */
  readonly scrollRange?: ScrollOffsets;
  /** Only on a text node with a frame: its lines as Dragon's native text views draw them (DragonLineSpec), glyph for glyph. */
  readonly lines?: readonly TextLine[];
};
/**
 * pageScroll: the offset range of the viewport, the page's own scroll view, at the target's viewport; null when the engine does not
 * decide it (a form control on the page), with the reason in the export's warnings.
 */
export type ExportAssignment = {
  readonly values: Readonly<Record<string, Scalar>>;
  readonly pageScroll: ScrollOffsets | null;
  /** Only when pageScroll is null: the node the engine stopped at and why, for a build error that names the element. */
  readonly pageScrollUndecided?: { readonly nodeId: string; readonly detail: string };
  readonly nodes: readonly ExportNode[];
};
export type ExportTarget = {
  readonly backend: string;
  readonly viewport: ExportDevice['viewport'];
  readonly dpr: number;
  /** 'ready' only when every committed device lane of the target passes; otherwise not a shipping output, and why. */
  readonly readiness: { readonly kind: 'ready' } | { readonly kind: 'analysis-only'; readonly reason: string };
  /** "<instance>#<state>" with its domain, in the order the setters index them. */
  readonly states: readonly { readonly key: string; readonly domain: readonly Scalar[] }[];
  readonly initial: number;
  readonly assignments: readonly ExportAssignment[];
  /** next[a][s][v]: the assignment reached from a by setting state s to its v-th domain value, or -1. */
  readonly next: readonly (readonly (readonly number[])[])[];
  /**
   * Only for a sheet with @media: each atom is one media feature the host evaluates on the device, each band the truth vector of
   * every atom (in band order), each condition the band's media text. The state `@env#band` (domain 0..n-1) selects the band.
   */
  readonly bands?: { readonly atoms: readonly unknown[]; readonly bands: readonly (readonly boolean[])[]; readonly conditions: readonly string[] };
  /** Only when asked for: what a phone needs to lay every assignment out again at its own size (markless-plan.ts). */
  readonly plan?: MarklessPlan;
  /** With a plan, from a Markless input, per assignment: each Dragon id the plan's geometry names, with the input's id for it. */
  readonly planNames?: readonly (readonly (readonly [string, string])[])[];
  /**
   * With a plan, when the sheet has transitions or animations: Dragon's animator tables (layout/src/rt-animator.ts) over the
   * program's assignments, by Dragon id, which a phone runs with the plan's layout as the page moves between assignments.
   */
  readonly anim?: AnimTables;
  /** With a plan: each list's parent box and the ids of a row's top boxes, which a phone copies once per row. */
  readonly planRepeats?: readonly { readonly id: string; readonly parent: string; readonly template: readonly string[] }[];
};
export type NativeStyleExport = {
  readonly schema: typeof NATIVE_STYLE_EXPORT_SCHEMA;
  readonly units: string;
  readonly compiler: string;
  readonly component: string;
  readonly source: string;
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  /** Each face by id; `file` is relative to the Dragon checkout, or with `from: 'input'` to the style input's directory. */
  readonly fonts: readonly { readonly id: string; readonly file: string; readonly from?: 'input' }[];
  /**
   * Only when a text is drawn in a system face (dragon fonts/system-faces.ts): each such face id with how each target's host
   * rebuilds the platform's own font (system-fonts/provider.ts SystemFaceDescriptor). Nothing of it is bundled.
   */
  readonly systemFonts?: readonly SystemFontEntry[];
  readonly targets: { readonly [T in NativeStyleTarget]?: ExportTarget };
};

/** A system face of the export: its id, and per target the platform font a host draws it with. */
export type SystemFontEntry = { readonly id: string } & { readonly [T in NativeStyleTarget]?: Omit<Extract<SystemFaceDescriptor, { platform: T }>, 'platform'> };

let vendored: ReadonlyMap<string, string> | null = null;

/** Every vendored face by the id native programs name it with: the SHA-256 of the file, or the family for Ahem. */
function vendoredFaces(): ReadonlyMap<string, string> {
  if (vendored !== null) return vendored;
  const out = new Map<string, string>([['Ahem', 'vendor/fonts/Ahem.ttf']]);
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(repoPath(dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`, `${rel}${e.name}/`);
      else if (/\.(ttf|otf)$/.test(e.name)) out.set(`sha256:${createHash('sha256').update(readFileSync(repoPath(`${dir}/${e.name}`))).digest('hex')}`, `vendor/fonts/${rel}${e.name}`);
    }
  };
  walk('vendor/fonts', '');
  vendored = out;
  return out;
}

function boxStyles(root: LayoutBox): Map<string, LayoutBox['style']> {
  const out = new Map<string, LayoutBox['style']>();
  const visit = (b: LayoutBox): void => {
    out.set(b.id, b.style);
    for (const c of (b as { children?: readonly unknown[] }).children ?? []) if (c !== null && typeof c === 'object' && 'style' in c && 'id' in c) visit(c as LayoutBox);
  };
  visit(root);
  return out;
}

type Write = { readonly kind: string };

/**
 * The border operations of a box with a visible dashed or dotted side, as Dragon's native paint computes them from the box's
 * absolute snapped edges and its whole device px widths. Dragon's compile refuses such a side on a rounded box (PNT1b).
 */
function dashedBorder(id: string, writes: readonly Write[], rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined, widths: readonly number[] | undefined): Pick<ExportNode, 'borderOps'> {
  const field = (kind: string, key: string): unknown => (writes.find((w) => w.kind === kind) as Readonly<Record<string, unknown>> | undefined)?.[key];
  const styles = field('border-styles', 'styles') as readonly string[] | undefined;
  const colors = field('border-colors', 'colors') as readonly { r: number; g: number; b: number; alpha: number }[] | undefined;
  if (styles === undefined || colors === undefined || rect === undefined || widths === undefined) return {};
  const rgba = colors.flatMap((c) => [c.r, c.g, c.b, c.alpha]);
  const dashed = styles.some((st, k) => (st === 'dashed' || st === 'dotted') && (widths[k] ?? 0) > 0 && (colors[k]?.alpha ?? 0) > 0);
  if (!dashed || !borderNeedsSidePainter([...widths], styles, rgba)) return {};
  const b = snapRect({ ...rect, id } as Parameters<typeof snapRect>[0]);
  const ops = borderPaintOps(b.left, b.top, b.right, b.bottom, [...widths], styles, rgba, NO_DASH_FAULTS).map((o) => ({
    ...o,
    points: o.op === 'dot' ? [(o.points[0] as number) - b.left, (o.points[1] as number) - b.top, o.points[2] as number] : o.points.map((v, i) => v - (i % 2 === 0 ? b.left : b.top)),
  }));
  return { borderOps: { origin: { x: b.left - rect.x / LU_PER_PX, y: b.top - rect.y / LU_PER_PX }, size: { width: b.width, height: b.height }, widths: [...widths], ops } };
}

/** The refused ranges of nodes with a scroll-container write: a clipping box that is none (a select's inner element) never scrolls on a phone. */
export function scrollerRefusals<R extends { readonly id: string }>(program: Pick<NativeProgram, 'nodes'>, refused: readonly R[]): R[] {
  const scrollers = new Set(program.nodes.filter((n) => n.writes.some((w) => w.kind === 'scroll-container')).map((n) => n.id));
  return refused.filter((r) => scrollers.has(r.id));
}

/** The viewport's and every scroll container's offset range for one assignment's layout; a range the engine does not decide throws, naming it. */
function scrollOffsets(component: string, program: NativeProgram, viewport: ExportDevice['viewport'], dpr: number, measurer: () => TextMeasurer): { readonly page: ScrollOffsets | { readonly undecided: string; readonly nodeId: string; readonly detail: string }; readonly containers: ReadonlyMap<string, ScrollOffsets> } {
  const input = programInput(program, viewport, dpr);
  const ranges = scrollRanges(input, measurer());
  if (ranges.kind === 'refused') throw new Error(`${component}: the engine refused the scroll ranges at ${ranges.nodeId}: ${ranges.detail}`);
  const refused = scrollerRefusals(program, ranges.refused);
  if (refused.length > 0) throw new Error(`${component}: no scroll range for ${refused.map((r) => `${r.id} (at ${r.nodeId}: ${r.detail})`).join('; ')}`);
  const metrics = scrollMetricsWithFaults(input, measurer(), viewportDirectionOf(input), NO_ENGINE_FAULTS);
  const containers = new Map(ranges.ranges.map((r) => [r.id, offsetsOf(r)]));
  if (metrics.kind === 'refused') return { page: { undecided: `the page's scroll range is not decided at ${metrics.nodeId}: ${metrics.detail}`, nodeId: metrics.nodeId, detail: metrics.detail }, containers };
  const v = metrics.viewport;
  // As overflow.ts rangeOf does for an element scroll container.
  const ox = Math.floor((v.paddingX - v.scrollRect.x) / LU_PER_PX);
  const oy = Math.floor((v.paddingY - v.scrollRect.y) / LU_PER_PX);
  const page = { minX: 0 - ox, maxX: snapEdge(v.scrollRect.width) - snapEdge(v.clientWidth) - ox, minY: 0 - oy, maxY: snapEdge(v.scrollRect.height) - snapEdge(v.clientHeight) - oy };
  return { page, containers };
}

/** Splits a line's glyphs into runs where the instance size changes (small caps). */
function runsOf(face: string, glyphs: readonly number[], xs: readonly number[], sizes: readonly number[]): GlyphRun[] {
  const out: { face: string; size: number; glyphs: number[]; xs: number[] }[] = [];
  for (const [j, g] of glyphs.entries()) {
    const size = sizes[j] as number;
    const last = out[out.length - 1];
    if (last === undefined || last.size !== size) out.push({ face, size, glyphs: [g], xs: [xs[j] as number] });
    else {
      last.glyphs.push(g);
      last.xs.push(xs[j] as number);
    }
  }
  return out;
}

/** Each text node's lines as native-support.ts builds its DragonLineSpecs: engine breaks, pieceGlyphs, snapped top and baseline. */
function textLines(texts: readonly EngineText[], leafText: ReadonlyMap<string, string>, origin: ReadonlyMap<string, { readonly x: number; readonly y: number }>, m: TextMeasurer): Map<string, TextLine[]> {
  const out = new Map<string, TextLine[]>();
  for (const t of texts) {
    const text = leafText.get(t.id);
    const at = origin.get(t.id);
    if (text === undefined || at === undefined) continue;
    const ascent = m.metrics(t.textFont).ascent / LU_PER_PX;
    out.set(t.id, t.lines.map((line, k): TextLine => {
      const start = [...text.slice(0, line.start)].length;
      const g = pieceGlyphs(m, text, t.textFont, start, start + line.cps.length);
      if (!g.ok) throw new Error(`${t.id} line ${k}: the shaped measurer refused its text: ${g.reason}`);
      const x0 = line.rect.x / LU_PER_PX - at.x;
      const xs = g.xs.map((x, j) => x0 + x + (line.shifts.length === 0 ? 0 : (line.shifts[g.chars[j] as number] as number)));
      const runs = runsOf(t.textFont.family, g.glyphs, xs, g.sizes);
      const e = line.ellipsis;
      if (e !== null) {
        const d = pieceGlyphs(m, String.fromCodePoint(...e.cps), e.font, 0, e.cps.length);
        if (!d.ok) throw new Error(`${t.id} line ${k} ellipsis: the shaped measurer refused its text: ${d.reason}`);
        runs.push(...runsOf(e.font.family, d.glyphs, d.xs.map((x) => e.x / LU_PER_PX - at.x + x), d.sizes));
      }
      return { top: snapEdge((line.rect.y - line.halfLeading) as LU) - at.y, baseline: line.snapped.top + ascent - at.y, runs };
    }));
  }
  return out;
}

const offsetsOf = ({ minX, maxX, minY, maxY }: ScrollRange): ScrollOffsets => ({ minX, maxX, minY, maxY });

/** An assignment's values keyed "<instance>#<state>", as the export writes them. */
export const valuesOf = (a: Assignment): Record<string, Scalar> => Object.fromEntries(a.map((x) => [`${x.state.instance}#${x.state.state}`, x.value]));

/** A target's bands as the export writes them; absent for a sheet without @media. */
export const exportBands = (o: { readonly bands: { readonly table: { readonly atoms: readonly unknown[]; readonly bands: readonly (readonly boolean[])[] }; readonly conditions: readonly string[] } | null }): Pick<ExportTarget, 'bands'> =>
  o.bands === null ? {} : { bands: { atoms: o.bands.table.atoms, bands: o.bands.table.bands, conditions: o.bands.conditions } };

/** The export of every emitted target; a blocked target throws, naming its reason, since an export without it would drop styles. */
export function nativeStyleExport(styles: NativeStyles, component: string, source: string, devices: { readonly [T in NativeStyleTarget]: ExportDevice } = EXPORT_DEVICES, inputFonts: readonly { readonly id: string; readonly file: string; readonly bytes: Uint8Array }[] = [], systemFonts: ((t: NativeStyleTarget, dpr: number) => SystemFonts) | null = null, plan = false): NativeStyleExport {
  const inputFaces = new Map(inputFonts.map((f) => [registerFace(f.bytes), f.file]));
  const systemUsed = new Map<string, Record<string, unknown>>();
  if (!styles.ok) throw new Error(`${component}: no export: ${Object.entries(styles.targets).map(([t, o]) => `${t} ${o.kind === 'blocked' ? o.reason : 'emitted'}`).join('; ')}`);
  const faces = new Set<string>();
  const undecided = new Set<string>();
  const targets: { [T in NativeStyleTarget]?: ExportTarget } = {};
  // The plan's recordings with systemFontsFor's fonts run in worker threads first, every target's ratios at once; each is used,
  // or its error thrown, where the target's plan is made.
  const recorded = new Map<NativeStyleTarget, readonly DensityResult[]>();
  const workers = planWorkers();
  if (plan && systemFonts === systemFontsFor && workers > 1) {
    const authorFiles = inputFonts.map((f) => [registerFace(f.bytes), f.bytes] as const);
    const jobs = (['ios', 'android'] as const).flatMap((t) => {
      const o = styles.targets[t];
      return o?.kind !== 'emitted' ? [] : PLAN_DENSITIES[t].map((dpr): DensityJob => ({ t, sp: o.program, bundled: [...inputFaces.keys()], authorFiles, dpr, height: devices[t].viewport.height }));
    });
    const results = recordDensitiesInWorkers(jobs, workers);
    for (const t of ['ios', 'android'] as const) recorded.set(t, results.filter((_, i) => jobs[i]?.t === t));
  }
  for (const t of ['ios', 'android'] as const) {
    const o = styles.targets[t];
    if (o === undefined) continue;
    if (o.kind !== 'emitted') throw new Error(`${component}: ${t} is blocked: ${o.reason}`);
    const d = devices[t];
    const sp = o.program;
    // A target measures its system faces with its own platform's fonts; the lowered program is shared.
    const system = systemFonts === null ? null : systemFonts(t, d.dpr);
    const shared = system === null ? null : systemMeasurer(system, sp, [...inputFaces.keys()], d.dpr, new Map(inputFonts.map((f) => [registerFace(f.bytes), f.bytes])));
    const measurer = (): TextMeasurer => shared ?? referenceMeasurer([...inputFaces.keys()]);
    const assignments = sp.assignments.map((a, i): ExportAssignment => {
      const program = programAt(sp, i);
      const laid = engineBoxes(program, d.viewport, d.dpr, measurer());
      const boxes = new Map(laid.map((b) => [b.id, b]));
      const absolute = absoluteRects(laid);
      const deviceBorders = borderDevicePx(expectedEngine(), programInput(program, d.viewport, d.dpr), measurer());
      const style = boxStyles(program.root);
      const scroll = scrollOffsets(component, program, d.viewport, d.dpr, measurer);
      const px = (v: number): number => v / LU_PER_PX;
      const input = programInput(program, d.viewport, d.dpr);
      const texts = new Map([...cssFontSizes(input.root)].map(([id, f]) => [id, f.text] as const));
      const origins = new Map([...absolute].map(([id, r]) => [id, { x: px(r.x), y: px(r.y) }] as const));
      const lines = textLines(engineTextLines(input, measurer()), texts, origins, measurer());
      // REPL-r1: a runtime-image write carries the img's content box in absolute LU, from this assignment's layout, for the host's paint.
      const contents = replacedContents(expectedEngine(), input, laid, measurer());
      const nodes = program.nodes.map((n): ExportNode => {
        const box = boxes.get(n.id);
        const s = style.get(n.id);
        for (const w of n.writes) {
          if (w.kind !== 'font') continue;
          if (systemRequestOf(w.font.family) === null) faces.add(w.font.family);
          else if (system === null) throw new Error(`${component}: ${t} node ${n.id} is drawn in the system face ${w.font.family}, and the export was given no system fonts`);
          else {
            const { platform: _platform, ...descriptor } = system.descriptor(w.font.family);
            systemUsed.set(w.font.family, { ...(systemUsed.get(w.font.family) ?? { id: w.font.family }), [t]: descriptor });
          }
        }
        const scrolls = n.writes.some((w) => w.kind === 'scroll-container');
        const range = scroll.containers.get(n.id);
        if (scrolls && range === undefined) throw new Error(`${component}: ${t} node ${n.id} is a scroll container with no scroll range`);
        const own = n.kind === 'text' && box !== undefined ? lines.get(n.id) : undefined;
        if (n.kind === 'text' && box !== undefined && own === undefined) throw new Error(`${component}: ${t} text node ${n.id} has a frame but no engine lines`);
        return {
          id: n.id, parent: n.parent, kind: n.kind, native: n.native, text: n.text,
          frame: box === undefined ? null : { x: px(box.x), y: px(box.y), width: px(box.width), height: px(box.height) },
          borderWidths: s === undefined ? null : Object.fromEntries(Object.entries(resolveBorder(s, d.dpr)).map(([k, v]) => [k, px(v) * d.dpr])),
          writes: n.writes.map(({ css: _css, detail: _detail, technique: _technique, ...w }) => (w.kind === 'runtime-image' ? { ...w, content: contents.get(n.id)?.content ?? null } : w)),
          ...dashedBorder(n.id, n.writes, absolute.get(n.id), deviceBorders.get(n.id)),
          ...(scrolls && range !== undefined ? { scrollRange: range } : {}),
          ...(own === undefined ? {} : { lines: own }),
        };
      });
      if ('undecided' in scroll.page) undecided.add(`${t}: ${scroll.page.undecided}`);
      if ('undecided' in scroll.page) return { values: valuesOf(a.assignment), pageScroll: null, pageScrollUndecided: { nodeId: scroll.page.nodeId, detail: scroll.page.detail }, nodes };
      return { values: valuesOf(a.assignment), pageScroll: scroll.page, nodes };
    });
    const r = o.readiness;
    if (r.kind === 'blocked') throw new Error(`${component}: ${t} is emitted but its output state is blocked`);
    const readiness = r.kind === 'ready' ? { kind: 'ready' as const } : { kind: 'analysis-only' as const, reason: r.reason };
    if (plan && systemFonts === null) throw new Error(`${component}: a layout plan records the text a target's system fonts shape, and the export was given no system fonts`);
    if (o.anim !== undefined && !plan) throw new Error(`${component}: ${t} has transitions or animations, which a phone runs only with a layout plan`);
    const animated = plan && o.anim !== undefined ? { anim: animTablesOf(o.anim) } : {};
    const laidOut = plan && systemFonts !== null ? { plan: marklessPlan(t, sp, (dpr) => systemFonts(t, dpr), [...inputFaces.keys()], new Map(inputFonts.map((f) => [registerFace(f.bytes), f.bytes])), d.viewport.height, recorded.get(t)) } : {};
    targets[t] = { backend: o.backend, viewport: d.viewport, dpr: d.dpr, readiness, states: sp.states.map((s) => ({ key: s.key, domain: s.domain })), initial: sp.initial, assignments, next: sp.next, ...exportBands(o), ...laidOut, ...animated };
  }
  const files = vendoredFaces();
  return {
    schema: NATIVE_STYLE_EXPORT_SCHEMA,
    units: 'device px; frames relative to the parent box',
    compiler: styles.digest,
    component,
    source,
    warnings: [
      ...styles.diagnostics.filter((x) => x.severity !== 'error').map((x) => ({ code: x.code, message: x.message })),
      ...[...undecided].map((message) => ({ code: 'DRAGON_PAGE_SCROLL_UNDECIDED', message })),
    ],
    fonts: [...faces].sort().map((id) => {
      const file = inputFaces.get(id);
      if (file !== undefined) return { id, file, from: 'input' as const };
      const vendored = files.get(id);
      if (vendored === undefined) throw new Error(`${component}: face ${id} is not a vendored font`);
      return { id, file: vendored };
    }),
    ...(systemUsed.size === 0 ? {} : { systemFonts: [...systemUsed.values()].sort((a, b) => (String(a['id']) < String(b['id']) ? -1 : 1)) as unknown as SystemFontEntry[] }),
    targets,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** An export read from a file, with every field a comparison reads checked; anything malformed is refused, naming where. */
export function parseNativeStyleExport(text: string): NativeStyleExport {
  const fail = (what: string): never => {
    throw new Error(`native style export: ${what}`);
  };
  const v: unknown = JSON.parse(text);
  if (!isRecord(v) || v['schema'] !== NATIVE_STYLE_EXPORT_SCHEMA) fail(`not ${NATIVE_STYLE_EXPORT_SCHEMA}`);
  const o = v as Record<string, unknown>;
  if (typeof o['component'] !== 'string') fail('component is not a string');
  if (!Array.isArray(o['fonts']) || !o['fonts'].every((f) => isRecord(f) && typeof f['id'] === 'string' && typeof f['file'] === 'string' && (f['from'] === undefined || f['from'] === 'input'))) fail('fonts is not a list of { id, file, from? "input" }');
  if (o['systemFonts'] !== undefined) {
    if (!Array.isArray(o['systemFonts'])) fail('systemFonts is not a list');
    for (const e of o['systemFonts'] as unknown[]) {
      if (!isRecord(e) || typeof e['id'] !== 'string') fail(`a systemFonts entry has no id: ${JSON.stringify(e)}`);
      const entry = e as Record<string, unknown>;
      const ios = entry['ios'];
      const face = isRecord(ios) ? ios['face'] : undefined;
      const faceOk = isRecord(face) && ((face['kind'] === 'system' && isNumber(face['weight']) && ['default', 'serif', 'monospaced'].includes(face['design'] as string)) || (face['kind'] === 'name' && typeof face['postScriptName'] === 'string') || (face['kind'] === 'data' && typeof face['sha256'] === 'string'));
      if (ios !== undefined && !faceOk) fail(`systemFonts ${String(entry['id'])}: ios is not a Core Text face`);
      const android = entry['android'];
      if (android !== undefined && !(isRecord(android) && typeof android['file'] === 'string' && Number.isInteger(android['index']) && typeof android['sha256'] === 'string')) fail(`systemFonts ${String(entry['id'])}: android is not a file, index and sha256`);
    }
  }
  if (!isRecord(o['targets'])) fail('targets is not an object');
  for (const [t, x] of Object.entries(o['targets'] as Record<string, unknown>)) {
    if (!(t in EXPORT_DEVICES)) fail(`target ${t} is neither ios nor android`);
    if (!isRecord(x)) fail(`${t} is not an object`);
    const target = x as Record<string, unknown>;
    if (!isNumber(target['dpr']) || target['dpr'] <= 0) fail(`${t}: dpr is not a positive number`);
    const viewport = target['viewport'];
    if (!isRecord(viewport) || !isNumber(viewport['width']) || !isNumber(viewport['height']) || viewport['width'] <= 0 || viewport['height'] <= 0) fail(`${t}: viewport is not a positive size`);
    if (!Array.isArray(target['states']) || !target['states'].every((s) => isRecord(s) && typeof s['key'] === 'string' && Array.isArray(s['domain']))) fail(`${t}: states is not a list of keys and domains`);
    const bands = target['bands'];
    if (bands !== undefined) {
      if (!isRecord(bands) || !Array.isArray(bands['atoms']) || !bands['atoms'].every(isRecord) || !Array.isArray(bands['bands']) || !Array.isArray(bands['conditions'])) fail(`${t}: bands is not atoms, bands and conditions`);
      const b = bands as { atoms: unknown[]; bands: unknown[]; conditions: unknown[] };
      if (b.bands.length === 0 || !b.bands.every((r) => Array.isArray(r) && r.length === b.atoms.length && r.every((x) => typeof x === 'boolean'))) fail(`${t}: a band is not one truth value per atom`);
      if (b.conditions.length !== b.bands.length || !b.conditions.every((c) => typeof c === 'string')) fail(`${t}: conditions are not one string per band`);
    }
    if (!Array.isArray(target['assignments'])) fail(`${t}: assignments is not a list`);
    (target['assignments'] as unknown[]).forEach((a, i) => {
      if (!isRecord(a) || !isRecord(a['values']) || !Array.isArray(a['nodes'])) fail(`${t}: assignment ${i} is not values and nodes`);
      const { values, nodes } = a as { values: Record<string, unknown>; nodes: unknown[] };
      for (const [k, x] of Object.entries(values)) if (!isScalar(x)) fail(`${t}: assignment ${i} gives ${k} a value that is not a scalar`);
      const ids = new Set<string>();
      for (const n of nodes) {
        if (!isRecord(n) || typeof n['id'] !== 'string' || !(n['parent'] === null || typeof n['parent'] === 'string') || typeof n['kind'] !== 'string') fail(`${t}: assignment ${i} has a node without an id, parent and kind: ${JSON.stringify(n)}`);
        const node = n as Record<string, unknown>;
        const frame = node['frame'];
        if (frame !== null && !(isRecord(frame) && (['x', 'y', 'width', 'height'] as const).every((k) => isNumber(frame[k])))) fail(`${t}: assignment ${i} node ${String(node['id'])} has a frame that is not null or x, y, width and height`);
        if (ids.has(node['id'] as string)) fail(`${t}: assignment ${i} lists node ${String(node['id'])} twice`);
        ids.add(node['id'] as string);
      }
      for (const n of nodes as { id: string; parent: string | null }[]) if (n.parent !== null && !ids.has(n.parent)) fail(`${t}: assignment ${i} node ${n.id} has parent ${n.parent}, which is not one of its nodes`);
    });
  }
  return v as NativeStyleExport;
}
