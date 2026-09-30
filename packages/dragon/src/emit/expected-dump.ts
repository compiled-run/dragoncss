// Expected native dumps (notes/T013-p3-review-p4-plan.md section 2 item 4): per backend, per case and per device DPR, each laid-out
// node's applied map in backend vocabulary and its native class, projected from the lowered program alone. Values that depend on
// the device scale (border widths, the padding-box clip, the text instance size) come from the TS engine with the same helpers
// the generated code runs on the device through the translated engine. The digest of an expected dump is embedded in the
// generated code, keyed by case and DPR. The compiler core imports the engine for types only, so the host passes the TS engine in.
import type { Edges, EngineFaults, LayoutBox, LayoutInput, LayoutRect, LayoutResult, LayoutStyle, SnappedRect, TextMeasurer } from '@dragon/layout';
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
  readonly luPerPx: number;
  readonly platformFontSize: (px: number) => number;
  readonly zoomFontSize: (px: number, zoom: number) => number;
  readonly float32: (x: number) => number;
};

/** The device values of one node at one scale, from the engine: border widths in whole device px and the snapped border box. */
export type NodeGeometry = { readonly border: readonly [number, number, number, number]; readonly box: SnappedRect };

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
    case 'font':
      return ios ? { name: w.family, pointSize: textInstanceSize(engine, w.size, dpr) / dpr } : { typeface: `dragon:${w.family}`, textSize: engine.float32(textInstanceSize(engine, w.size, dpr)) };
  }
  throw new Error(`write kind ${w.kind} has no applied value`);
}

/** The engine input of a program at a device scale. */
export function programInput(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): LayoutInput {
  return { viewport: { width: viewport.width, height: viewport.height }, devicePixelRatio: dpr, root: p.root };
}

/** Border widths of every box of the zoomed input, in whole device px (box.ts resolveBorder at zoomed ratio 1). */
export function borderDevicePx(engine: ExpectedEngine, input: LayoutInput): Map<string, readonly [number, number, number, number]> {
  const zoomed = engine.zoomInput(input, engine.noFaults);
  const lu = engine.luPerPx;
  const out = new Map<string, readonly [number, number, number, number]>();
  const walk = (b: LayoutBox): void => {
    const e = engine.resolveBorder(b.style, zoomed.devicePixelRatio);
    out.set(b.id, [e.top / lu, e.right / lu, e.bottom / lu, e.left / lu]);
    for (const c of b.children) if (c.kind === 'box') walk(c);
  };
  walk(zoomed.root);
  return out;
}

const isLine = (r: LayoutRect): boolean => r.parent !== null && r.id.startsWith(`${r.parent}:line`);

/** The expected dump of a program at a device DPR: every laid-out node (engine order), its native class and applied map. */
export function expectedDump(p: NativeProgram, caseId: string, viewport: { readonly width: number; readonly height: number }, dpr: number, engine: ExpectedEngine): ExpectedDump {
  const input = programInput(p, viewport, dpr);
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error(`${caseId}@${dpr}: the engine refused the case (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  const snapped = engine.snapEdges(out.boxes);
  const borders = borderDevicePx(engine, input);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const nodes: ExpectedNode[] = [];
  out.boxes.forEach((r, i) => {
    if (isLine(r)) return;
    const n = byId.get(r.id);
    if (n === undefined) throw new Error(`${caseId}@${dpr}: the engine laid out ${r.id}, which the program does not have`);
    const g: NodeGeometry = { border: borders.get(r.id) ?? [0, 0, 0, 0], box: snapped[i] as SnappedRect };
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
