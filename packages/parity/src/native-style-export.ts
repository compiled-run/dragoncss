// The native style export (docs/markless-native-styles.md "The export"), generalised from the Markless counter's
// dragon.native-style-export/0: from compileNativeStyles' state programs, per target and per reachable state assignment, every
// node's lowered writes and the frame the reference engine lays it out at for the proof device, in device px.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { LayoutBox } from '@dragon/layout';
import { LU_PER_PX, resolveBorder } from '@dragon/layout';
import type { Assignment, NativeStyles, NativeStyleTarget, Scalar } from 'dragon';
import { isScalar, programAt } from 'dragon';
import { engineBoxes } from './native-host.ts';
import { repoPath } from './paths.ts';

export const NATIVE_STYLE_EXPORT_SCHEMA = 'dragon.native-style-export/1';

export type ExportDevice = { readonly viewport: { readonly width: number; readonly height: number }; readonly dpr: number };

/** The proof devices of the counter export: the iPhone 17 simulator's safe-area size in points at 3x, the Pixel 7 emulator in whole dp at 420 dpi. */
export const EXPORT_DEVICES: { readonly [T in NativeStyleTarget]: ExportDevice } = {
  ios: { viewport: { width: 402, height: 778 }, dpr: 3 },
  android: { viewport: { width: 411, height: 818 }, dpr: 2.625 },
};

type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type ExportNode = {
  readonly id: string;
  readonly parent: string | null;
  readonly kind: string;
  readonly native: string;
  readonly text: string | null;
  readonly frame: Frame | null;
  readonly borderWidths: Readonly<Record<string, number>> | null;
  readonly writes: readonly Readonly<Record<string, unknown>>[];
};
export type ExportAssignment = { readonly values: Readonly<Record<string, Scalar>>; readonly nodes: readonly ExportNode[] };
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
  readonly fonts: readonly { readonly id: string; readonly file: string }[];
  readonly targets: { readonly [T in NativeStyleTarget]?: ExportTarget };
};

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

const valuesOf = (a: Assignment): Record<string, Scalar> => Object.fromEntries(a.map((x) => [`${x.state.instance}#${x.state.state}`, x.value]));

/** A target's bands as the export writes them; absent for a sheet without @media. */
export const exportBands = (o: { readonly bands: { readonly table: { readonly atoms: readonly unknown[]; readonly bands: readonly (readonly boolean[])[] }; readonly conditions: readonly string[] } | null }): Pick<ExportTarget, 'bands'> =>
  o.bands === null ? {} : { bands: { atoms: o.bands.table.atoms, bands: o.bands.table.bands, conditions: o.bands.conditions } };

/** The export of every emitted target; a blocked target throws, naming its reason, since an export without it would drop styles. */
export function nativeStyleExport(styles: NativeStyles, component: string, source: string, devices: { readonly [T in NativeStyleTarget]: ExportDevice } = EXPORT_DEVICES): NativeStyleExport {
  if (!styles.ok) throw new Error(`${component}: no export: ${Object.entries(styles.targets).map(([t, o]) => `${t} ${o.kind === 'blocked' ? o.reason : 'emitted'}`).join('; ')}`);
  const faces = new Set<string>();
  const targets: { [T in NativeStyleTarget]?: ExportTarget } = {};
  for (const t of ['ios', 'android'] as const) {
    const o = styles.targets[t];
    if (o === undefined) continue;
    if (o.kind !== 'emitted') throw new Error(`${component}: ${t} is blocked: ${o.reason}`);
    const d = devices[t];
    const sp = o.program;
    const assignments = sp.assignments.map((a, i): ExportAssignment => {
      const program = programAt(sp, i);
      const boxes = new Map(engineBoxes(program, d.viewport, d.dpr).map((b) => [b.id, b]));
      const style = boxStyles(program.root);
      const px = (v: number): number => v / LU_PER_PX;
      const nodes = program.nodes.map((n): ExportNode => {
        const box = boxes.get(n.id);
        const s = style.get(n.id);
        for (const w of n.writes) if (w.kind === 'font') faces.add(w.font.family);
        return {
          id: n.id, parent: n.parent, kind: n.kind, native: n.native, text: n.text,
          frame: box === undefined ? null : { x: px(box.x), y: px(box.y), width: px(box.width), height: px(box.height) },
          borderWidths: s === undefined ? null : Object.fromEntries(Object.entries(resolveBorder(s, d.dpr)).map(([k, v]) => [k, px(v) * d.dpr])),
          writes: n.writes.map(({ css: _css, detail: _detail, technique: _technique, ...w }) => w),
        };
      });
      return { values: valuesOf(a.assignment), nodes };
    });
    const r = o.readiness;
    if (r.kind === 'blocked') throw new Error(`${component}: ${t} is emitted but its output state is blocked`);
    const readiness = r.kind === 'ready' ? { kind: 'ready' as const } : { kind: 'analysis-only' as const, reason: r.reason };
    targets[t] = { backend: o.backend, viewport: d.viewport, dpr: d.dpr, readiness, states: sp.states.map((s) => ({ key: s.key, domain: s.domain })), initial: sp.initial, assignments, next: sp.next, ...exportBands(o) };
  }
  const files = vendoredFaces();
  return {
    schema: NATIVE_STYLE_EXPORT_SCHEMA,
    units: 'device px; frames relative to the parent box',
    compiler: styles.digest,
    component,
    source,
    warnings: styles.diagnostics.filter((x) => x.severity !== 'error').map((x) => ({ code: x.code, message: x.message })),
    fonts: [...faces].sort().map((id) => {
      const file = files.get(id);
      if (file === undefined) throw new Error(`${component}: face ${id} is not a vendored font`);
      return { id, file };
    }),
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
