// The four native dump checks (docs/research/native-strategy.md 3.1): (a) frames and lines against Chrome at the same DPR within
// GATE_DEVICE_PX, (b) applied against expected exactly, (c) pixel samples against Chrome's pixels (channel delta GATE_CHANNEL_DELTA,
// edge positions within GATE_DEVICE_PX, each line's glyph x centre and bottom edge within GATE_GLYPH_POSITION_DEVICE_PX), (d) frames against snapRect of
// the TS engine frames exactly. Tolerances are imported only.
import type { LayoutBox, LayoutInput, LayoutRect } from '@dragon/layout';
import { absoluteRects, LU_PER_PX, snapEdges } from '@dragon/layout';
import type { WebCapture } from './capture.ts';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX, GATE_GLYPH_POSITION_DEVICE_PX } from './compare.ts';
import { GRADIENT_CHANNEL_DELTA } from './allowances/gradient.ts';
import { SHADOW_CHANNEL_DELTA } from './allowances/shadow.ts';
import type { DumpEdges, DumpFrame, DumpLine, DumpNode, DumpSample, JsonValue, NativeDump } from './native-dump.ts';
import { frameOf, REFERENCE_LANE } from './native-dump.ts';
import type { SamplePoint, SampleRule } from './samples.ts';
import { GLYPH_EDGE_RULE, isScanlineRule, ruleKind } from './samples.ts';

export type CheckResult = { readonly pass: boolean; readonly compared: number; readonly problems: readonly string[] };

const result = (compared: number, problems: readonly string[]): CheckResult => ({ pass: problems.length === 0, compared, problems });

/** A Chrome line node id "<text>:line<j>". */
function lineRef(id: string): { readonly text: string; readonly index: number } | null {
  const m = /^(.*):line(\d+)$/.exec(id);
  return m === null ? null : { text: m[1] as string, index: Number(m[2]) };
}

const edgesOfFrame = (f: DumpFrame): { left: number; top: number; right: number; bottom: number } => ({ left: f.x, top: f.y, right: f.x + f.width, bottom: f.y + f.height });

// ---------------------------------------------------------------- (a) frames and lines against Chrome

export function checkAgainstChrome(dump: NativeDump, capture: WebCapture): CheckResult {
  const problems: string[] = [];
  const dpr = dump.case.dpr;
  if (capture.devicePixelRatio !== dpr) problems.push(`capture DPR ${capture.devicePixelRatio} is not the dump DPR ${dpr}`);
  if (dump.device.scale !== dpr) problems.push(`device scale ${dump.device.scale} is not the case DPR ${dpr}`);
  if (capture.direction !== dump.case.direction) problems.push(`capture direction ${capture.direction} is not the dump direction ${dump.case.direction}`);
  // A capture's fixture field is its case id (capture.ts).
  if (capture.fixture !== dump.case.id) problems.push(`capture of case ${capture.fixture} is not the dump case ${dump.case.id}`);
  const byId = new Map(dump.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let compared = 0;
  const gate = (id: string, chrome: WebCapture['nodes'][number], frame: DumpFrame): void => {
    compared++;
    const e = edgesOfFrame(frame);
    const delta = [e.left - chrome.x, e.top - chrome.y, e.right - (chrome.x + chrome.width), e.bottom - (chrome.y + chrome.height)];
    if (!delta.every((d) => Math.abs(d) * dpr <= GATE_DEVICE_PX)) problems.push(`${id}: edge delta ${JSON.stringify(delta)} css px exceeds ${GATE_DEVICE_PX} device px at DPR ${dpr}`);
  };
  for (const c of capture.nodes) {
    seen.add(c.id);
    if (c.kind === 'line') {
      const ref = lineRef(c.id);
      const line = ref === null ? undefined : byId.get(ref.text)?.lines[ref.index];
      if (line === undefined) {
        problems.push(`${c.id}: Chrome has a line box the dump does not have`);
        continue;
      }
      gate(c.id, c, line.frame);
      continue;
    }
    const n = byId.get(c.id);
    if (!c.hasBox) {
      if (n !== undefined) problems.push(`${c.id}: Chrome generates no box but the dump has one`);
      continue;
    }
    // SVG-a1: a shape is its <svg>'s content, which no native view stands for (the outline is svg-compare.ts's, at DPR 1).
    if (n === undefined && c.svg !== undefined) continue;
    if (n === undefined) {
      problems.push(`${c.id}: Chrome has a box but the dump has no node ${c.id}`);
      continue;
    }
    gate(c.id, c, n.frame);
  }
  for (const n of dump.nodes) {
    n.lines.forEach((_, j) => {
      if (seen.has(n.id) && !seen.has(`${n.id}:line${j}`)) problems.push(`${n.id}:line${j}: the dump has a line box Chrome does not have`);
    });
    if (seen.has(n.id)) continue;
    if (n.kind !== 'anonymous') {
      problems.push(`${n.id}: the dump has a node Chrome does not have`);
      continue;
    }
    // An anonymous box only Dragon has passes only if every text line inside it is a compared Chrome node.
    const lines = dump.nodes.filter((t) => t.parent === n.id && t.kind === 'text').flatMap((t) => t.lines.map((_, j) => `${t.id}:line${j}`));
    const uncompared = lines.filter((l) => !seen.has(l));
    if (lines.length === 0 || uncompared.length > 0) problems.push(`${n.id}: anonymous box whose text lines are not all compared with Chrome (${uncompared.join(', ') || 'no lines'})`);
  }
  return result(compared, problems);
}

// ---------------------------------------------------------------- (b) applied against expected

export type ExpectedApplied = ReadonlyMap<string, { readonly [key: string]: JsonValue }>;

function canonical(v: JsonValue): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as { readonly [k: string]: JsonValue };
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k] as JsonValue)}`).join(',')}}`;
}

/** Every expected node's applied map equals the dump's, key for key and value for value; no tolerance. */
export function checkApplied(dump: NativeDump, expected: ExpectedApplied): CheckResult {
  const problems: string[] = [];
  const byId = new Map(dump.nodes.map((n) => [n.id, n]));
  let compared = 0;
  for (const [id, want] of expected) {
    const n = byId.get(id);
    if (n === undefined) {
      problems.push(`${id}: expected applied values, but the dump has no node ${id}`);
      continue;
    }
    for (const k of Object.keys(want).sort()) {
      compared++;
      if (!Object.hasOwn(n.applied, k)) problems.push(`${id}: applied key ${k} is missing`);
      else if (canonical(n.applied[k] as JsonValue) !== canonical(want[k] as JsonValue)) problems.push(`${id}: applied ${k} is ${canonical(n.applied[k] as JsonValue)}, expected ${canonical(want[k] as JsonValue)}`);
    }
    for (const k of Object.keys(n.applied).sort()) if (!Object.hasOwn(want, k)) problems.push(`${id}: applied key ${k} is not expected`);
  }
  for (const n of dump.nodes) if (!expected.has(n.id) && Object.keys(n.applied).length > 0) problems.push(`${n.id}: applied values on a node with no expected entry`);
  return result(compared, problems);
}

// ---------------------------------------------------------------- (c) pixel samples against Chrome

/** An RGBA8 image, rows top to bottom. */
export type RgbaImage = { readonly width: number; readonly height: number; readonly data: Uint8Array };

export function pixelAt(img: RgbaImage, x: number, y: number): readonly [number, number, number, number] {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) throw new Error(`pixel ${x},${y} is outside the ${img.width}x${img.height} image`);
  const i = (y * img.width + x) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number, img.data[i + 3] as number];
}

/** What a native harness writes for the generated points: the capture's pixel at each point. */
export function readSamples(img: RgbaImage, points: readonly SamplePoint[]): DumpSample[] {
  return points.map((p) => ({ x: p.x, y: p.y, rgba: [...pixelAt(img, p.x, p.y)], rule: p.rule }));
}

/**
 * Distance in device px from the first (outside) sample of a scanline to the edge: the sum of (1 - coverage), coverage being
 * (c - outside) / (inside - outside) on the channel the reference shows the most contrast in. Null when that channel has none.
 */
export function edgeDistance(colors: readonly (readonly number[])[], channel: number): number | null {
  const bg = (colors[0] as readonly number[])[channel] as number;
  const fg = (colors[colors.length - 1] as readonly number[])[channel] as number;
  if (fg === bg) return null;
  return colors.reduce((s, c) => s + (1 - Math.min(1, Math.max(0, ((c[channel] as number) - bg) / (fg - bg)))), 0);
}

/** The channel a reference scanline shows the most contrast in, first to last. */
export function contrastChannel(colors: readonly (readonly number[])[]): number {
  const first = colors[0] as readonly number[];
  const last = colors[colors.length - 1] as readonly number[];
  return [0, 1, 2, 3].reduce((best, k) => (Math.abs((last[k] as number) - (first[k] as number)) > Math.abs((last[best] as number) - (first[best] as number)) ? k : best), 0);
}

/**
 * The edge position along a scanline in device px from its pixels and the distance edgeDistance gives: a scanline that runs toward
 * higher coordinates (a left or top edge) puts the edge at first + distance, one that runs toward lower coordinates at first + 1 - distance.
 */
export function edgePosition(pixels: readonly { readonly x: number; readonly y: number }[], distance: number): number {
  const a = pixels[0] as { x: number; y: number };
  const b = pixels[pixels.length - 1] as { x: number; y: number };
  const horizontal = a.y === b.y;
  const first = horizontal ? a.x : a.y;
  const last = horizontal ? b.x : b.y;
  return last > first ? first + distance : first + 1 - distance;
}

/**
 * One line's glyph position on one axis: x is the midpoint of its glyph-left and glyph-right edges; y is its glyph-bottom edge alone,
 * since Chrome's darwin fringe grows glyph tops and not bottoms (T093 addendum F1).
 */
export type GlyphPosition = { readonly line: string; readonly axis: 'x' | 'y'; readonly native: number; readonly chrome: number };

type ScanlineEdge = { readonly rule: string; readonly native: number | null; readonly chrome: number | null };

function scanlineEdges(samples: readonly DumpSample[], chrome: RgbaImage): ScanlineEdge[] {
  const out: ScanlineEdge[] = [];
  for (let i = 0; i < samples.length;) {
    const s = samples[i] as DumpSample;
    let j = i + 1;
    if (isScanlineRule(s.rule)) while (j < samples.length && (samples[j] as DumpSample).rule === s.rule) j++;
    if (isScanlineRule(s.rule)) {
      const line = samples.slice(i, j);
      const chromeColors = line.map((x) => pixelAt(chrome, x.x, x.y));
      const channel = contrastChannel(chromeColors);
      const want = edgeDistance(chromeColors, channel);
      const got = edgeDistance(line.map((x) => x.rgba), channel);
      out.push({ rule: s.rule, native: got === null ? null : edgePosition(line, got), chrome: want === null ? null : edgePosition(line, want) });
    }
    i = j;
  }
  return out;
}

/**
 * The glyph positions of a dump's samples (the generated points, in order): per line, the x centre of left and right and the bottom
 * edge, where the scanlines show an edge in Chrome and in the capture. Check (c) holds each within GATE_GLYPH_POSITION_DEVICE_PX.
 */
export function glyphPositions(samples: readonly DumpSample[], chrome: RgbaImage): GlyphPosition[] {
  const edges = new Map<string, { native: number; chrome: number }>();
  const order: string[] = [];
  for (const e of scanlineEdges(samples, chrome)) {
    const m = GLYPH_EDGE_RULE.exec(e.rule);
    if (m === null || e.native === null || e.chrome === null) continue;
    const line = m[1] as string;
    if (!order.includes(line)) order.push(line);
    edges.set(`${line}\t${m[2]}`, { native: e.native, chrome: e.chrome });
  }
  const out: GlyphPosition[] = [];
  for (const line of order) {
    const a = edges.get(`${line}\tleft`);
    const b = edges.get(`${line}\tright`);
    if (a !== undefined && b !== undefined) out.push({ line, axis: 'x', native: (a.native + b.native) / 2, chrome: (a.chrome + b.chrome) / 2 });
    const bottom = edges.get(`${line}\tbottom`);
    if (bottom !== undefined) out.push({ line, axis: 'y', ...bottom });
  }
  return out;
}

/** The channel delta per rule kind: GATE_CHANNEL_DELTA for every kind but shadow and gradient, which take their allowances/ constant. */
export const CHANNEL_DELTA_BY_KIND: { readonly [K in SampleRule]: number } = {
  interior: GATE_CHANNEL_DELTA,
  border: GATE_CHANNEL_DELTA,
  outside: GATE_CHANNEL_DELTA,
  radius: GATE_CHANNEL_DELTA,
  clip: GATE_CHANNEL_DELTA,
  edge: GATE_CHANNEL_DELTA,
  glyph: GATE_CHANNEL_DELTA,
  shadow: SHADOW_CHANNEL_DELTA,
  gradient: GRADIENT_CHANNEL_DELTA,
  // REPL-a (R8): flat image content is compared strictly, with no allowance.
  'image-flat': GATE_CHANNEL_DELTA,
  // SVG-a2: a point clear of every shape edge shows one solid paint (or the backdrop), compared strictly.
  svg: GATE_CHANNEL_DELTA,
};

/**
 * The generated points must be the dump's samples in order; colours equal within their kind's channel delta (CHANNEL_DELTA_BY_KIND); edges within GATE_DEVICE_PX;
 * each line's glyph x centre and bottom edge within GATE_GLYPH_POSITION_DEVICE_PX. A glyph-edge scanline across which Chrome shows no contrast is
 * compared by colour at its two ends only: the pixels between are within SAMPLE_INSET_DEVICE_PX of the glyph edge (T093 ruling A).
 */
export function checkPixels(samples: readonly DumpSample[], points: readonly SamplePoint[], chrome: RgbaImage): CheckResult {
  const problems: string[] = [];
  if (samples.length !== points.length) problems.push(`the dump has ${samples.length} samples, the generator ${points.length}`);
  points.forEach((p, i) => {
    const s = samples[i];
    if (s !== undefined && (s.x !== p.x || s.y !== p.y || s.rule !== p.rule)) problems.push(`sample ${i} is ${s.rule} at ${s.x},${s.y}, the generator's is ${p.rule} at ${p.x},${p.y}`);
  });
  if (problems.length > 0) return result(0, problems);
  let compared = 0;
  const colourCheck = (s: DumpSample): void => {
    compared++;
    const c = pixelAt(chrome, s.x, s.y);
    const limit = CHANNEL_DELTA_BY_KIND[ruleKind(s.rule)];
    if (!s.rgba.every((v, k) => Math.abs(v - (c[k] as number)) <= limit)) problems.push(`${s.rule} at ${s.x},${s.y}: native ${JSON.stringify(s.rgba)}, Chrome ${JSON.stringify(c)} (channel delta limit ${limit})`);
  };
  for (let i = 0; i < samples.length;) {
    const s = samples[i] as DumpSample;
    if (!isScanlineRule(s.rule)) {
      colourCheck(s);
      i++;
      continue;
    }
    let j = i;
    while (j < samples.length && (samples[j] as DumpSample).rule === s.rule) j++;
    const line = samples.slice(i, j);
    const chromeColors = line.map((x) => pixelAt(chrome, x.x, x.y));
    const channel = contrastChannel(chromeColors);
    const want = edgeDistance(chromeColors, channel);
    if (want === null) {
      // No contrast across the edge in Chrome: every point is a colour sample, only the clear ends of a glyph-edge scanline.
      for (const x of GLYPH_EDGE_RULE.test(s.rule) ? [line[0] as DumpSample, line[line.length - 1] as DumpSample] : line) colourCheck(x);
    } else {
      compared++;
      const got = edgeDistance(line.map((x) => x.rgba), channel);
      if (got === null) problems.push(`${s.rule}: Chrome shows an edge ${want.toFixed(3)} device px along the scanline, the native capture none`);
      else if (Math.abs(got - want) > GATE_DEVICE_PX) problems.push(`${s.rule}: edge at ${got.toFixed(3)} device px, Chrome ${want.toFixed(3)}; exceeds ${GATE_DEVICE_PX} device px`);
    }
    i = j;
  }
  for (const c of glyphPositions(samples, chrome)) {
    compared++;
    const what = c.axis === 'x' ? ['centre', 'glyph centre'] : ['bottom', 'glyph bottom edge'];
    if (Math.abs(c.native - c.chrome) > GATE_GLYPH_POSITION_DEVICE_PX) problems.push(`${what[0]}:${c.line}:${c.axis}: ${what[1]} at ${c.native.toFixed(3)} device px, Chrome ${c.chrome.toFixed(3)}; differs by more than ${GATE_GLYPH_POSITION_DEVICE_PX} device px`);
  }
  return result(compared, problems);
}

// ---------------------------------------------------------------- (d) frames against snapRect of the engine

const isLineRect = (r: LayoutRect): boolean => r.parent !== null && r.id.startsWith(`${r.parent}:line`);
const sameEdges = (a: DumpEdges, b: DumpEdges): boolean => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
const sameFrame = (a: DumpFrame, b: DumpFrame): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** deviceEdges equal snapRect of the engine's absolute rects, and every frame is exactly its deviceEdges / scale. */
export function checkAgainstEngine(dump: NativeDump, engine: readonly LayoutRect[]): CheckResult {
  const problems: string[] = [];
  const snapped = snapEdges(engine);
  const byId = new Map(dump.nodes.map((n) => [n.id, n]));
  const want = new Map<string, number>();
  let compared = 0;
  const one = (id: string, got: { readonly frame: DumpFrame; readonly deviceEdges: DumpEdges }, s: DumpEdges): void => {
    compared++;
    if (!sameEdges(got.deviceEdges, s)) problems.push(`${id}: deviceEdges ${JSON.stringify(got.deviceEdges)}, snapRect of the engine ${JSON.stringify({ left: s.left, top: s.top, right: s.right, bottom: s.bottom })}`);
    if (!sameFrame(got.frame, frameOf(got.deviceEdges, dump.device.scale))) problems.push(`${id}: frame ${JSON.stringify(got.frame)} is not deviceEdges / scale ${dump.device.scale}`);
  };
  engine.forEach((r, i) => {
    const s = snapped[i] as DumpEdges & { id: string };
    if (isLineRect(r)) {
      const ref = lineRef(r.id);
      const line = ref === null ? undefined : byId.get(ref.text)?.lines[ref.index];
      want.set(r.parent as string, (want.get(r.parent as string) ?? 0) + 1);
      if (line === undefined) problems.push(`${r.id}: the engine has a line box the dump does not have`);
      else one(r.id, line, s);
      return;
    }
    if (!want.has(r.id)) want.set(r.id, 0);
    const n = byId.get(r.id);
    if (n === undefined) problems.push(`${r.id}: the engine laid out ${r.id} but the dump has no such node`);
    else one(r.id, n, s);
  });
  for (const n of dump.nodes) {
    if (!want.has(n.id)) problems.push(`${n.id}: the dump has a node the engine did not lay out`);
    else if (n.lines.length !== want.get(n.id)) problems.push(`${n.id}: the dump has ${n.lines.length} line boxes, the engine ${want.get(n.id)}`);
  }
  return result(compared, problems);
}

// ---------------------------------------------------------------- the TS engine plus snapRect reference dump

/** Faults a reference dump can carry, for the negative tests; the proof itself uses none. */
export type ReferenceFaults = { readonly snap: 'on' | 'off' };
export const NO_REFERENCE_FAULTS: ReferenceFaults = { snap: 'on' };

export type ReferenceCase = {
  readonly platform: 'ios' | 'android';
  readonly caseId: string;
  readonly fixture: string;
  readonly dpr: number;
  readonly direction: 'ltr' | 'rtl';
  readonly compilerDigest: string;
  readonly input: LayoutInput;
  readonly engine: readonly LayoutRect[];
};

function nodeKinds(input: LayoutInput): Map<string, DumpNode['kind']> {
  const out = new Map<string, DumpNode['kind']>();
  const walk = (b: LayoutBox): void => {
    out.set(b.id, b.boxType === 'anonymous' ? 'anonymous' : 'element');
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else out.set(c.id, c.kind === 'replaced' ? 'element' : 'text');
    }
  };
  walk(input.root);
  return out;
}

/**
 * The dump a platform would write if it applied the engine's frames through the shared snap: the TS engine output, snapped by
 * snapRect. With snap off, the platform writes the unsnapped frame and truncates edges to ints (the planted snap fault).
 */
export function referenceDump(c: ReferenceCase, faults: ReferenceFaults = NO_REFERENCE_FAULTS): NativeDump {
  const kinds = nodeKinds(c.input);
  const snapped = snapEdges(c.engine);
  const abs = absoluteRects(c.engine);
  const geometry = (r: LayoutRect, i: number): { frame: DumpFrame; deviceEdges: DumpEdges } => {
    if (faults.snap === 'on') {
      const s = snapped[i] as DumpEdges;
      const deviceEdges = { left: s.left, top: s.top, right: s.right, bottom: s.bottom };
      return { frame: frameOf(deviceEdges, c.dpr), deviceEdges };
    }
    const a = abs.get(r.id) as LayoutRect;
    const scale = LU_PER_PX * c.dpr;
    return {
      frame: { x: a.x / scale, y: a.y / scale, width: a.width / scale, height: a.height / scale },
      deviceEdges: { left: Math.trunc(a.x / LU_PER_PX), top: Math.trunc(a.y / LU_PER_PX), right: Math.trunc((a.x + a.width) / LU_PER_PX), bottom: Math.trunc((a.y + a.height) / LU_PER_PX) },
    };
  };
  const lines = new Map<string, DumpLine[]>();
  const nodes: { node: Omit<DumpNode, 'lines'>; id: string }[] = [];
  c.engine.forEach((r, i) => {
    const g = geometry(r, i);
    if (isLineRect(r)) {
      const list = lines.get(r.parent as string) ?? [];
      list.push({ ...g, baseline: null, start: null, end: null });
      lines.set(r.parent as string, list);
      return;
    }
    const kind = kinds.get(r.id);
    if (kind === undefined) throw new Error(`${c.caseId}: engine rect ${r.id} is not a node of the layout input`);
    nodes.push({ id: r.id, node: { id: r.id, parent: r.parent, kind, native: 'ts-reference', ...g, applied: {} } });
  });
  return {
    schema: 'dragon.native-dump/1',
    lane: REFERENCE_LANE,
    case: { id: c.caseId, fixture: c.fixture, dpr: c.dpr, viewport: { width: c.input.viewport.width, height: c.input.viewport.height }, direction: c.direction, compilerDigest: c.compilerDigest, expectedDigest: null },
    device: { platform: c.platform, os: 'none', model: 'ts-engine', abi: 'none', scale: c.dpr, toolchain: 'packages/layout (TypeScript reference)', renderer: 'none' },
    units: 'css-px',
    nodes: nodes.map((n) => ({ ...n.node, lines: lines.get(n.id) ?? [] })),
    pixels: null,
    timing: null,
  };
}

// ---------------------------------------------------------------- planted dump faults

/** The dump faults the checks must catch, the same on every native target (native-strategy.md 3.1, 3.3; T009 P3 item 6). */
export const DUMP_FAULTS = ['edge-plus-2-device-px', 'edge-plus-1-device-px', 'applied-changed', 'applied-missing', 'channel-delta-1', 'missing-node', 'snap-disabled', 'break-shifted'] as const;
export type DumpFault = (typeof DUMP_FAULTS)[number];

// ---------------------------------------------------------------- dump faults on real device dumps (P5)

/** The check each fault targets: (a) Chrome, (b) applied, (c) pixels, (d) engine, or the line-break check. */
export type NamedCheck = 'a' | 'b' | 'c' | 'd' | 'breaks';
export const FAULT_CHECK: { readonly [F in DumpFault]: NamedCheck } = {
  'edge-plus-2-device-px': 'a',
  'edge-plus-1-device-px': 'd',
  'applied-changed': 'b',
  'applied-missing': 'b',
  'channel-delta-1': 'c',
  'missing-node': 'a',
  'snap-disabled': 'd',
  'break-shifted': 'breaks',
};

/** What a fault may need besides the dump: the engine's absolute rects (snap-disabled) and the sample indices check (c) passes. */
export type FaultContext = { readonly engine: readonly LayoutRect[]; readonly passingSamples: readonly number[] };

const withEdges = (e: DumpEdges, scale: number): { frame: DumpFrame; deviceEdges: DumpEdges } => ({ frame: frameOf(e, scale), deviceEdges: e });

function changedValue(v: JsonValue): JsonValue {
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'string') return `${v}x`;
  if (typeof v === 'boolean') return !v;
  if (v === null) return 0;
  if (Array.isArray(v)) return [...v, 0];
  return { ...(v as { readonly [k: string]: JsonValue }), dragonPlanted: 1 };
}

/**
 * A real dump with one planted fault, or null when the dump has nothing the fault applies to. The node is the first that qualifies
 * in dump order: an element for the edge faults, a node with applied values, a leaf node for missing-node, a text node with two
 * lines for break-shifted (the first line ends one code unit early and the second starts there); channel-delta-1 moves the red
 * channel of the first sample check (c) passes by one; snap-disabled writes the unsnapped engine frames with truncated edges.
 */
export function plantDumpFault(fault: DumpFault, dump: NativeDump, ctx: FaultContext): NativeDump | null {
  const scale = dump.device.scale;
  switch (fault) {
    case 'edge-plus-2-device-px':
    case 'edge-plus-1-device-px': {
      const px = fault === 'edge-plus-2-device-px' ? 2 : 1;
      const i = dump.nodes.findIndex((n) => n.kind === 'element');
      if (i < 0) return null;
      return { ...dump, nodes: dump.nodes.map((n, k) => (k === i ? { ...n, ...withEdges({ ...n.deviceEdges, right: n.deviceEdges.right + px }, scale) } : n)) };
    }
    case 'applied-changed':
    case 'applied-missing': {
      const i = dump.nodes.findIndex((n) => Object.keys(n.applied).length > 0);
      if (i < 0) return null;
      const n = dump.nodes[i] as DumpNode;
      const k = Object.keys(n.applied).sort()[0] as string;
      const applied: { [key: string]: JsonValue } = { ...n.applied };
      if (fault === 'applied-missing') delete applied[k];
      else applied[k] = changedValue(n.applied[k] as JsonValue);
      return { ...dump, nodes: dump.nodes.map((x, j) => (j === i ? { ...x, applied } : x)) };
    }
    case 'channel-delta-1': {
      const i = ctx.passingSamples[0];
      if (dump.pixels === null || i === undefined) return null;
      const samples = dump.pixels.samples.map((x, j) => (j === i ? { ...x, rgba: x.rgba.map((v, c) => (c === 0 ? (v === 255 ? 254 : v + 1) : v)) } : x));
      return { ...dump, pixels: { ...dump.pixels, samples } };
    }
    case 'missing-node': {
      const parents = new Set(dump.nodes.map((n) => n.parent));
      const i = dump.nodes.findIndex((n) => n.parent !== null && n.kind !== 'anonymous' && !parents.has(n.id));
      if (i < 0) return null;
      return { ...dump, nodes: dump.nodes.filter((_, j) => j !== i) };
    }
    case 'snap-disabled': {
      const abs = absoluteRects(ctx.engine);
      const unsnapped = (id: string, fallback: { frame: DumpFrame; deviceEdges: DumpEdges }): { frame: DumpFrame; deviceEdges: DumpEdges } => {
        const a = abs.get(id);
        if (a === undefined) return fallback;
        const s = LU_PER_PX * scale;
        return {
          frame: { x: a.x / s, y: a.y / s, width: a.width / s, height: a.height / s },
          deviceEdges: { left: Math.trunc(a.x / LU_PER_PX), top: Math.trunc(a.y / LU_PER_PX), right: Math.trunc((a.x + a.width) / LU_PER_PX), bottom: Math.trunc((a.y + a.height) / LU_PER_PX) },
        };
      };
      const nodes = dump.nodes.map((n) => ({ ...n, ...unsnapped(n.id, n), lines: n.lines.map((l, j) => ({ ...l, ...unsnapped(`${n.id}:line${j}`, l) })) }));
      const planted = { ...dump, nodes };
      return JSON.stringify(planted.nodes) === JSON.stringify(dump.nodes) ? null : planted;
    }
    case 'break-shifted': {
      const i = dump.nodes.findIndex((n) => n.lines.length >= 2 && n.lines[0]?.end !== null && n.lines[1]?.start !== null && (n.lines[0]?.end ?? 0) > (n.lines[0]?.start ?? 0) + 1);
      if (i < 0) return null;
      const n = dump.nodes[i] as DumpNode;
      const lines = n.lines.map((l, j) => (j === 0 ? { ...l, end: (l.end as number) - 1 } : j === 1 ? { ...l, start: (l.start as number) - 1 } : l));
      return { ...dump, nodes: dump.nodes.map((x, j) => (j === i ? { ...x, lines } : x)) };
    }
  }
}
