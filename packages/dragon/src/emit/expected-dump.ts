// Expected native dumps (notes/T013-p3-review-p4-plan.md section 2 item 4): per backend, per case and per device DPR, each laid-out
// node's applied map in backend vocabulary and its native class, projected from the lowered program alone. Values that depend on
// the device scale (border widths, the padding-box clip, the text instance size) come from the TS engine with the same helpers
// the generated code runs on the device through the translated engine. The digest of an expected dump is embedded in the
// generated code, keyed by case and DPR.
import type { LayoutBox, LayoutInput, LayoutRect, SnappedRect, TextMeasurer } from '@dragon/layout';
import { layout, LU_PER_PX, NO_ENGINE_FAULTS, platformFontSize, resolveBorder, snapEdges, zoomFontSize, zoomInput } from '@dragon/layout';
import { canonicalJson, sha256Hex } from '../digest.ts';
import type { Longhand } from '../css/properties.ts';
import type { NativeBackend, NativeProgram, ProgramNode, ProgramWrite } from '../lower/native-program.ts';

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

/** The device values of one node at one scale, from the engine: border widths in whole device px and the snapped border box. */
export type NodeGeometry = { readonly border: readonly [number, number, number, number]; readonly box: SnappedRect };

const rgba = (c: { r: number; g: number; b: number; alpha: number }): number[] => [c.r, c.g, c.b, c.alpha];

/** The engine instance size of a text run at a device scale: the zoomed font size with the platform font-size rule (units.ts). */
export function textInstanceSize(cssSize: number, dpr: number): number {
  return platformFontSize(zoomFontSize(cssSize, dpr));
}

/** One write's applied value at a device scale, in the backend's units (Android Paint.textSize is a float); the device computes the same. */
export function appliedValue(backend: NativeBackend, w: ProgramWrite, dpr: number, g: NodeGeometry): JsonValue {
  const ios = backend === 'uikit';
  const [bt, br, bb, bl] = g.border;
  switch (w.kind) {
    case 'background-color':
    case 'text-color':
      return rgba(w.color);
    case 'border-widths':
      return ios ? [bt / dpr, br / dpr, bb / dpr, bl / dpr] : [bt, br, bb, bl];
    case 'border-styles':
      return [...w.styles];
    case 'border-colors':
      return w.colors.map(rgba);
    case 'padding-box-clip': {
      const width = g.box.right - g.box.left;
      const height = g.box.bottom - g.box.top;
      return ios ? [bl / dpr, bt / dpr, (width - bl - br) / dpr, (height - bt - bb) / dpr] : [bl, bt, width - br, height - bb];
    }
    case 'font':
      return ios ? { name: w.family, pointSize: textInstanceSize(w.size, dpr) / dpr } : { typeface: `dragon:${w.family}`, textSize: Math.fround(textInstanceSize(w.size, dpr)) };
  }
}

/** The engine input of a program at a device scale. */
export function programInput(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): LayoutInput {
  return { viewport: { width: viewport.width, height: viewport.height }, devicePixelRatio: dpr, root: p.root };
}

/** Border widths of every box of the zoomed input, in whole device px (box.ts resolveBorder at zoomed ratio 1). */
export function borderDevicePx(input: LayoutInput): Map<string, readonly [number, number, number, number]> {
  const zoomed = zoomInput(input, NO_ENGINE_FAULTS);
  const out = new Map<string, readonly [number, number, number, number]>();
  const walk = (b: LayoutBox): void => {
    const e = resolveBorder(b.style, zoomed.devicePixelRatio);
    out.set(b.id, [e.top / LU_PER_PX, e.right / LU_PER_PX, e.bottom / LU_PER_PX, e.left / LU_PER_PX]);
    for (const c of b.children) if (c.kind === 'box') walk(c);
  };
  walk(zoomed.root);
  return out;
}

const isLine = (r: LayoutRect): boolean => r.parent !== null && r.id.startsWith(`${r.parent}:line`);

/** The expected dump of a program at a device DPR: every laid-out node (engine order), its native class and applied map. */
export function expectedDump(p: NativeProgram, caseId: string, viewport: { readonly width: number; readonly height: number }, dpr: number, measurer: TextMeasurer): ExpectedDump {
  const input = programInput(p, viewport, dpr);
  const out = layout(input, measurer);
  if (out.kind !== 'ok') throw new Error(`${caseId}@${dpr}: the engine refused the case (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  const snapped = snapEdges(out.boxes);
  const borders = borderDevicePx(input);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const nodes: ExpectedNode[] = [];
  out.boxes.forEach((r, i) => {
    if (isLine(r)) return;
    const n = byId.get(r.id);
    if (n === undefined) throw new Error(`${caseId}@${dpr}: the engine laid out ${r.id}, which the program does not have`);
    const g: NodeGeometry = { border: borders.get(r.id) ?? [0, 0, 0, 0], box: snapped[i] as SnappedRect };
    const applied: { [key: string]: JsonValue } = {};
    for (const w of n.writes) applied[w.key] = appliedValue(p.backend, w, dpr, g);
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
