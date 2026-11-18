// The native style export (docs/markless-native-styles.md "The export"), generalised from the Markless counter's
// dragon.native-style-export/0: from compileNativeStyles' state programs, per target and per reachable state assignment, every
// node's lowered writes and the frame the reference engine lays it out at for the proof device, in device px.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { BorderOp, LayoutBox, LU, ScrollRange, TextMeasurer } from '@dragon/layout';
import { absoluteRects, borderNeedsSidePainter, borderPaintOps, LU_PER_PX, NO_DASH_FAULTS, NO_ENGINE_FAULTS, pieceGlyphs, resolveBorder, scrollRanges, snapRect } from '@dragon/layout';
import type { Assignment, NativeProgram, NativeStyles, NativeStyleTarget, Scalar } from 'dragon';
import { borderDevicePx, programAt, programInput } from 'dragon';
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
import type { SystemFaceDescriptor, SystemFonts } from './system-fonts/provider.ts';
import { systemRequestOf } from './system-fonts/provider.ts';

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

/** The viewport's and every scroll container's offset range for one assignment's layout; a range the engine does not decide throws, naming it. */
function scrollOffsets(component: string, program: NativeProgram, viewport: ExportDevice['viewport'], dpr: number, measurer: () => TextMeasurer): { readonly page: ScrollOffsets | { readonly undecided: string; readonly nodeId: string; readonly detail: string }; readonly containers: ReadonlyMap<string, ScrollOffsets> } {
  const input = programInput(program, viewport, dpr);
  const ranges = scrollRanges(input, measurer());
  if (ranges.kind === 'refused') throw new Error(`${component}: the engine refused the scroll ranges at ${ranges.nodeId}: ${ranges.detail}`);
  if (ranges.refused.length > 0) throw new Error(`${component}: no scroll range for ${ranges.refused.map((r) => `${r.id} (at ${r.nodeId}: ${r.detail})`).join('; ')}`);
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

const valuesOf = (a: Assignment): Record<string, Scalar> => Object.fromEntries(a.map((x) => [`${x.state.instance}#${x.state.state}`, x.value]));

/** The export of every emitted target; a blocked target throws, naming its reason, since an export without it would drop styles. */
export function nativeStyleExport(styles: NativeStyles, component: string, source: string, devices: { readonly [T in NativeStyleTarget]: ExportDevice } = EXPORT_DEVICES, inputFonts: readonly { readonly id: string; readonly file: string; readonly bytes: Uint8Array }[] = [], systemFonts: ((t: NativeStyleTarget, dpr: number) => SystemFonts) | null = null): NativeStyleExport {
  const inputFaces = new Map(inputFonts.map((f) => [registerFace(f.bytes), f.file]));
  const systemUsed = new Map<string, Record<string, unknown>>();
  if (!styles.ok) throw new Error(`${component}: no export: ${Object.entries(styles.targets).map(([t, o]) => `${t} ${o.kind === 'blocked' ? o.reason : 'emitted'}`).join('; ')}`);
  const faces = new Set<string>();
  const undecided = new Set<string>();
  const targets: { [T in NativeStyleTarget]?: ExportTarget } = {};
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
      const deviceBorders = borderDevicePx(expectedEngine(), programInput(program, d.viewport, d.dpr));
      const style = boxStyles(program.root);
      const scroll = scrollOffsets(component, program, d.viewport, d.dpr, measurer);
      const px = (v: number): number => v / LU_PER_PX;
      const input = programInput(program, d.viewport, d.dpr);
      const texts = new Map([...cssFontSizes(input.root)].map(([id, f]) => [id, f.text] as const));
      const origins = new Map([...absolute].map(([id, r]) => [id, { x: px(r.x), y: px(r.y) }] as const));
      const lines = textLines(engineTextLines(input, measurer()), texts, origins, measurer());
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
          writes: n.writes.map(({ css: _css, detail: _detail, technique: _technique, ...w }) => w),
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
    targets[t] = { backend: o.backend, viewport: d.viewport, dpr: d.dpr, readiness, states: sp.states.map((s) => ({ key: s.key, domain: s.domain })), initial: sp.initial, assignments, next: sp.next, ...(o.bands === null ? {} : { bands: { atoms: o.bands.table.atoms, bands: o.bands.table.bands, conditions: o.bands.conditions } }) };
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
