// Expected native dumps (notes/T013-p3-review-p4-plan.md section 2 item 4): per backend, per case and per device DPR, each laid-out
// node's applied map in backend vocabulary and its native class, projected from the lowered program alone. Values that depend on
// the device scale (border widths, the padding-box clip, the text instance size) come from the TS engine with the same helpers
// the generated code runs on the device through the translated engine. The digest of an expected dump is embedded in the
// generated code, keyed by case and DPR. The compiler core imports the engine for types only, so the host passes the TS engine in.
import type { Edges, EngineFaults, LayoutBox, LayoutInput, LayoutRect, LayoutResult, LayoutStyle, ObjectRect, ReplacedLeaf, ReplacedPaint, ScrollRangesResult, SnappedRect, TextMeasurer } from '@dragon/layout';
import { canonicalJson, sha256Hex } from '../digest.ts';
import type { Longhand } from '../css/properties.ts';
import type { NativeBackend, NativeProgram, ProgramNode, ProgramWrite } from '../lower/native-program.ts';
import { isPaintKind, paintAppliedValue } from './paint/registry.ts';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [k: string]: JsonValue };

export const EXPECTED_SCHEMA = 'dragon.expected-dump/1';

export type ExpectedNode = { readonly id: string; readonly kind: ProgramNode['kind']; readonly native: string; readonly applied: { readonly [key: string]: JsonValue } };

export type ExpectedDump = {
  readonly schema: typeof EXPECTED_SCHEMA;
  readonly backend: NativeBackend;
  readonly programVersion: string;
  readonly caseId: string;
  readonly dpr: number;
  readonly nodes: readonly ExpectedNode[];
};

/**
 * The TS engine as the host supplies it (packages/layout): the same helpers the generated code runs, translated, on the device, and
 * the float a platform stores for a text size (Android Paint.textSize is a float).
 */
export type ExpectedEngine = {
  readonly layout: (input: LayoutInput, measurer: TextMeasurer) => LayoutResult;
  readonly measurer: TextMeasurer;
  readonly snapEdges: (boxes: readonly LayoutRect[]) => SnappedRect[];
  readonly zoomInput: (input: LayoutInput, faults: EngineFaults) => LayoutInput;
  readonly noFaults: EngineFaults;
  readonly resolveBorder: (style: LayoutStyle, devicePixelRatio: number) => Edges;
  /** REPL-a: padding against a containing block's content width, and a replaced box's paint rects (layout paint.ts). */
  readonly resolvePadding: (style: LayoutStyle, cbInline: number) => Edges;
  readonly replacedPaint: (leaf: ReplacedLeaf, content: ObjectRect) => ReplacedPaint;
  readonly luPerPx: number;
  readonly platformFontSize: (px: number) => number;
  readonly zoomFontSize: (px: number, zoom: number) => number;
  readonly float32: (x: number) => number;
  /** OVFL-B: every element scroll container's offset range in device px (layout overflow.ts). */
  readonly scrollRanges: (input: LayoutInput, measurer: TextMeasurer) => ScrollRangesResult;
};

/** A replaced box's paint rects in device px relative to its snapped border box: [x, y, width, height]; drawn null for none. */
export type ReplacedGeometry = { readonly content: readonly number[]; readonly dest: readonly number[]; readonly drawn: readonly number[] | null };

/**
 * The device values of one node at one scale, from the engine: border widths in whole device px, the snapped border box, a text
 * run's computed font size in device px from the resolved input (null for a box), and for a replaced box its paint rects.
 */
export type NodeGeometry = { readonly border: readonly [number, number, number, number]; readonly box: SnappedRect; readonly fontSize: number | null; readonly replaced: ReplacedGeometry | null; readonly scroll: readonly [number, number, number, number] | null };

const rgba = (c: { r: number; g: number; b: number; alpha: number }): number[] => [c.r, c.g, c.b, c.alpha];

/** The engine instance size of a text run at a device scale: the zoomed font size with the platform font-size rule (units.ts). */
export function textInstanceSize(engine: ExpectedEngine, cssSize: number, dpr: number): number {
  return engine.platformFontSize(engine.zoomFontSize(cssSize, dpr));
}

/** One write's applied value at a device scale, in the backend's units (Android Paint.textSize is a float); the device computes the same. */
export function appliedValue(engine: ExpectedEngine, backend: NativeBackend, w: ProgramWrite, dpr: number, g: NodeGeometry): JsonValue {
  if (isPaintKind(w.kind)) return paintAppliedValue(engine, backend, w, dpr, g);
  const ios = backend === 'uikit';
  switch (w.kind) {
    case 'text-color':
      return rgba(w.color);
    case 'font': {
      if (g.fontSize === null) throw new Error(`a font write on a node without a resolved font size`);
      const size = engine.platformFontSize(g.fontSize);
      return ios ? { name: w.font.family, pointSize: size / dpr } : { typeface: `dragon:${w.font.family}`, textSize: engine.float32(size) };
    }
  }
  throw new Error(`write kind ${w.kind} has no applied value`);
}

/**
 * The engine input of a program at a device scale, with the environment of the reference case as explicit literals: every
 * viewport unit reads the viewport, no safe area, and the program's root font size at text scale 1.
 */
export function programInput(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): LayoutInput {
  const v = { width: viewport.width, height: viewport.height };
  return { viewport: v, devicePixelRatio: dpr, viewportUnits: { small: v, large: v, dynamic: v }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: p.rootFontSize, root: p.root };
}

/** The computed font size in device px of every text leaf of the resolved input (environment.ts writes it). */
export function resolvedFontSizes(engine: ExpectedEngine, input: LayoutInput): Map<string, number> {
  const zoomed = engine.zoomInput(input, engine.noFaults);
  const out = new Map<string, number>();
  const walk = (b: LayoutBox): void => {
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else if (c.kind === 'text') out.set(c.id, c.font.size);
    }
  };
  walk(zoomed.root);
  return out;
}

/** Border widths of every box of the zoomed input, in whole device px (box.ts resolveBorder at zoomed ratio 1). */
export function borderDevicePx(engine: ExpectedEngine, input: LayoutInput): Map<string, readonly [number, number, number, number]> {
  const zoomed = engine.zoomInput(input, engine.noFaults);
  const lu = engine.luPerPx;
  const out = new Map<string, readonly [number, number, number, number]>();
  const walk = (b: LayoutBox): void => {
    const e = engine.resolveBorder(b.style, zoomed.devicePixelRatio);
    out.set(b.id, [e.top / lu, e.right / lu, e.bottom / lu, e.left / lu]);
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else if (c.kind === 'replaced') {
        const r = engine.resolveBorder(c.style, zoomed.devicePixelRatio);
        out.set(c.id, [r.top / lu, r.right / lu, r.bottom / lu, r.left / lu]);
      }
    }
  };
  walk(zoomed.root);
  return out;
}

const isLine = (r: LayoutRect): boolean => r.parent !== null && r.id.startsWith(`${r.parent}:line`);

/**
 * The paint rects of every replaced leaf of the zoomed input, from its content box in absolute LU: the border box less its
 * borders and its padding against the parent's content width (the viewport's for the root), as the device computes them.
 */
export function replacedGeometries(engine: ExpectedEngine, input: LayoutInput, boxes: readonly LayoutRect[]): Map<string, ReplacedPaint> {
  const zoomed = engine.zoomInput(input, engine.noFaults);
  const abs = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const b of boxes) {
    const p = b.parent === null ? undefined : abs.get(b.parent);
    abs.set(b.id, { x: (p === undefined ? 0 : p.x) + b.x, y: (p === undefined ? 0 : p.y) + b.y, width: b.width, height: b.height });
  }
  const out = new Map<string, ReplacedPaint>();
  const contentWidth = (id: string, style: LayoutStyle, cb: number): number => {
    const r = abs.get(id);
    if (r === undefined) throw new Error(`no laid-out box ${id}`);
    const bor = engine.resolveBorder(style, zoomed.devicePixelRatio);
    const pad = engine.resolvePadding(style, cb);
    return r.width - bor.left - bor.right - pad.left - pad.right;
  };
  const walk = (b: LayoutBox, cb: number): void => {
    const inner = contentWidth(b.id, b.style, cb);
    for (const c of b.children) {
      if (c.kind === 'box') walk(c, inner);
      else if (c.kind === 'replaced') {
        const r = abs.get(c.id);
        if (r === undefined) throw new Error(`no laid-out box ${c.id}`);
        const bor = engine.resolveBorder(c.style, zoomed.devicePixelRatio);
        const pad = engine.resolvePadding(c.style, inner);
        const left = bor.left + pad.left;
        const top = bor.top + pad.top;
        const content = { x: r.x + left, y: r.y + top, width: Math.max(0, r.width - left - bor.right - pad.right), height: Math.max(0, r.height - top - bor.bottom - pad.bottom) } as ObjectRect;
        out.set(c.id, engine.replacedPaint(c, content));
      }
    }
  };
  walk(zoomed.root, zoomed.viewport.width * engine.luPerPx);
  return out;
}

/** A pixel rect relative to a snapped box. */
const relative = (r: { x: number; y: number; width: number; height: number }, box: SnappedRect): number[] => [r.x - box.left, r.y - box.top, r.width, r.height];

/** The expected dump of a program at a device DPR: every laid-out node (engine order), its native class and applied map. */
export function expectedDump(p: NativeProgram, caseId: string, viewport: { readonly width: number; readonly height: number }, dpr: number, engine: ExpectedEngine): ExpectedDump {
  const input = programInput(p, viewport, dpr);
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error(`${caseId}@${dpr}: the engine refused the case (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  const snapped = engine.snapEdges(out.boxes);
  const borders = borderDevicePx(engine, input);
  const fontSizes = resolvedFontSizes(engine, input);
  const replaced = replacedGeometries(engine, input, out.boxes);
  const ranges = engine.scrollRanges(input, engine.measurer);
  if (ranges.kind !== 'ok') throw new Error(`${caseId}@${dpr}: the engine refused the scroll ranges at ${ranges.nodeId}: ${ranges.detail}`);
  const scroll = new Map(ranges.ranges.map((r) => [r.id, [r.minX, r.maxX, r.minY, r.maxY] as const]));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const nodes: ExpectedNode[] = [];
  out.boxes.forEach((r, i) => {
    if (isLine(r)) return;
    const n = byId.get(r.id);
    if (n === undefined) throw new Error(`${caseId}@${dpr}: the engine laid out ${r.id}, which the program does not have`);
    const box = snapped[i] as SnappedRect;
    const rp = replaced.get(r.id);
    const g: NodeGeometry = { border: borders.get(r.id) ?? [0, 0, 0, 0], box, fontSize: fontSizes.get(r.id) ?? null, replaced: rp === undefined ? null : { content: relative(rp.content, box), dest: relative(rp.dest, box), drawn: rp.drawn === null ? null : relative(rp.drawn, box) }, scroll: scroll.get(r.id) ?? null };
    const applied: { [key: string]: JsonValue } = {};
    for (const w of n.writes) applied[w.key] = appliedValue(engine, p.backend, w, dpr, g);
    nodes.push({ id: n.id, kind: n.kind, native: n.native, applied });
  });
  return { schema: EXPECTED_SCHEMA, backend: p.backend, programVersion: p.version, caseId, dpr, nodes };
}

/** The digest the generated code embeds and the device dump writes as case.expectedDigest. */
export function expectedDigest(e: ExpectedDump): string {
  return sha256Hex(canonicalJson(e));
}

/** The CSS longhands each node's applied keys realise (the per-backend map, T002 1.2), sorted per node. */
export function cssCoverage(p: NativeProgram): Map<string, readonly Longhand[]> {
  return new Map(p.nodes.map((n) => [n.id, [...new Set(n.writes.flatMap((w) => w.css))].sort()]));
}

/** The applied key to CSS longhands map of a program, over every write it holds. */
export function appliedKeyMap(p: NativeProgram): Map<string, readonly Longhand[]> {
  const out = new Map<string, readonly Longhand[]>();
  for (const n of p.nodes) for (const w of n.writes) out.set(w.key, w.css);
  return out;
}
