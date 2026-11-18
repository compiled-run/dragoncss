// The native style export (docs/markless-native-styles.md "The export"), generalised from the Markless counter's
// dragon.native-style-export/0: from compileNativeStyles' state programs, per target and per reachable state assignment, every
// node's lowered writes and the frame the reference engine lays it out at for the proof device, in device px.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { BorderOp, LayoutBox } from '@dragon/layout';
import { absoluteRects, borderNeedsSidePainter, borderPaintOps, LU_PER_PX, NO_DASH_FAULTS, resolveBorder, snapRect } from '@dragon/layout';
import type { Assignment, NativeStyles, NativeStyleTarget, Scalar } from 'dragon';
import { borderDevicePx, programAt, programInput } from 'dragon';
import { engineBoxes, expectedEngine } from './native-host.ts';
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
  /**
   * Only for a box with a visible dashed or dotted side: the drawing operations Dragon's own native paint runs for its border
   * (paint-dash.ts, Blink 145's side painter, judged against Chrome's pixels by p6a-dash-oracle), in device px with the snapped
   * border box's top-left at `origin`, which is relative to this node's frame; `size` is that box and `widths` its sides (top,
   * right, bottom, left) in whole device px.
   */
  readonly borderOps?: { readonly origin: { readonly x: number; readonly y: number }; readonly size: { readonly width: number; readonly height: number }; readonly widths: readonly number[]; readonly ops: readonly BorderOp[] };
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

const valuesOf = (a: Assignment): Record<string, Scalar> => Object.fromEntries(a.map((x) => [`${x.state.instance}#${x.state.state}`, x.value]));

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
      const laid = engineBoxes(program, d.viewport, d.dpr);
      const boxes = new Map(laid.map((b) => [b.id, b]));
      const absolute = absoluteRects(laid);
      const deviceBorders = borderDevicePx(expectedEngine(), programInput(program, d.viewport, d.dpr));
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
          ...dashedBorder(n.id, n.writes, absolute.get(n.id), deviceBorders.get(n.id)),
        };
      });
      return { values: valuesOf(a.assignment), nodes };
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
    warnings: styles.diagnostics.filter((x) => x.severity !== 'error').map((x) => ({ code: x.code, message: x.message })),
    fonts: [...faces].sort().map((id) => {
      const file = files.get(id);
      if (file === undefined) throw new Error(`${component}: face ${id} is not a vendored font`);
      return { id, file };
    }),
    targets,
  };
}
