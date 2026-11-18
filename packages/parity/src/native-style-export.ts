// The native style export (docs/markless-native-styles.md "The export"), generalised from the Markless counter's
// dragon.native-style-export/0: from compileNativeStyles' state programs, per target and per reachable state assignment, every
// node's lowered writes and the frame the reference engine lays it out at for the proof device, in device px.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { LayoutBox, ScrollRange } from '@dragon/layout';
import { LU_PER_PX, NO_ENGINE_FAULTS, resolveBorder, scrollRanges } from '@dragon/layout';
import type { Assignment, NativeProgram, NativeStyles, NativeStyleTarget, Scalar } from 'dragon';
import { programAt, programInput } from 'dragon';
import { scrollMetricsWithFaults } from '../../layout/src/overflow.ts';
import { snapEdge } from '../../layout/src/units.ts';
import { engineBoxes, referenceMeasurer } from './native-host.ts';
import { viewportDirectionOf } from './scroll-metrics.ts';
import { repoPath } from './paths.ts';

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
export type ExportNode = {
  readonly id: string;
  readonly parent: string | null;
  readonly kind: string;
  readonly native: string;
  readonly text: string | null;
  readonly frame: Frame | null;
  readonly borderWidths: Readonly<Record<string, number>> | null;
  readonly writes: readonly Readonly<Record<string, unknown>>[];
  /** Only on a node with a scroll-container write: the offset range its scroll view scrolls over. */
  readonly scrollRange?: ScrollOffsets;
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

/** The viewport's and every scroll container's offset range for one assignment's layout; a range the engine does not decide throws, naming it. */
function scrollOffsets(component: string, program: NativeProgram, viewport: ExportDevice['viewport'], dpr: number): { readonly page: ScrollOffsets | { readonly undecided: string; readonly nodeId: string; readonly detail: string }; readonly containers: ReadonlyMap<string, ScrollOffsets> } {
  const input = programInput(program, viewport, dpr);
  const ranges = scrollRanges(input, referenceMeasurer());
  if (ranges.kind === 'refused') throw new Error(`${component}: the engine refused the scroll ranges at ${ranges.nodeId}: ${ranges.detail}`);
  if (ranges.refused.length > 0) throw new Error(`${component}: no scroll range for ${ranges.refused.map((r) => `${r.id} (at ${r.nodeId}: ${r.detail})`).join('; ')}`);
  const metrics = scrollMetricsWithFaults(input, referenceMeasurer(), viewportDirectionOf(input), NO_ENGINE_FAULTS);
  const containers = new Map(ranges.ranges.map((r) => [r.id, offsetsOf(r)]));
  if (metrics.kind === 'refused') return { page: { undecided: `the page's scroll range is not decided at ${metrics.nodeId}: ${metrics.detail}`, nodeId: metrics.nodeId, detail: metrics.detail }, containers };
  const v = metrics.viewport;
  // As overflow.ts rangeOf does for an element scroll container.
  const ox = Math.floor((v.paddingX - v.scrollRect.x) / LU_PER_PX);
  const oy = Math.floor((v.paddingY - v.scrollRect.y) / LU_PER_PX);
  const page = { minX: 0 - ox, maxX: snapEdge(v.scrollRect.width) - snapEdge(v.clientWidth) - ox, minY: 0 - oy, maxY: snapEdge(v.scrollRect.height) - snapEdge(v.clientHeight) - oy };
  return { page, containers };
}

const offsetsOf = ({ minX, maxX, minY, maxY }: ScrollRange): ScrollOffsets => ({ minX, maxX, minY, maxY });

const valuesOf = (a: Assignment): Record<string, Scalar> => Object.fromEntries(a.map((x) => [`${x.state.instance}#${x.state.state}`, x.value]));

/** The export of every emitted target; a blocked target throws, naming its reason, since an export without it would drop styles. */
export function nativeStyleExport(styles: NativeStyles, component: string, source: string, devices: { readonly [T in NativeStyleTarget]: ExportDevice } = EXPORT_DEVICES): NativeStyleExport {
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
    const assignments = sp.assignments.map((a, i): ExportAssignment => {
      const program = programAt(sp, i);
      const boxes = new Map(engineBoxes(program, d.viewport, d.dpr).map((b) => [b.id, b]));
      const style = boxStyles(program.root);
      const scroll = scrollOffsets(component, program, d.viewport, d.dpr);
      const px = (v: number): number => v / LU_PER_PX;
      const nodes = program.nodes.map((n): ExportNode => {
        const box = boxes.get(n.id);
        const s = style.get(n.id);
        for (const w of n.writes) if (w.kind === 'font') faces.add(w.font.family);
        const scrolls = n.writes.some((w) => w.kind === 'scroll-container');
        const range = scroll.containers.get(n.id);
        if (scrolls && range === undefined) throw new Error(`${component}: ${t} node ${n.id} is a scroll container with no scroll range`);
        return {
          id: n.id, parent: n.parent, kind: n.kind, native: n.native, text: n.text,
          frame: box === undefined ? null : { x: px(box.x), y: px(box.y), width: px(box.width), height: px(box.height) },
          borderWidths: s === undefined ? null : Object.fromEntries(Object.entries(resolveBorder(s, d.dpr)).map(([k, v]) => [k, px(v) * d.dpr])),
          writes: n.writes.map(({ css: _css, detail: _detail, technique: _technique, ...w }) => w),
          ...(scrolls && range !== undefined ? { scrollRange: range } : {}),
        };
      });
      if ('undecided' in scroll.page) undecided.add(`${t}: ${scroll.page.undecided}`);
      if ('undecided' in scroll.page) return { values: valuesOf(a.assignment), pageScroll: null, pageScrollUndecided: { nodeId: scroll.page.nodeId, detail: scroll.page.detail }, nodes };
      return { values: valuesOf(a.assignment), pageScroll: scroll.page, nodes };
    });
    const r = o.readiness;
    if (r.kind === 'blocked') throw new Error(`${component}: ${t} is emitted but its output state is blocked`);
    const readiness = r.kind === 'ready' ? { kind: 'ready' as const } : { kind: 'analysis-only' as const, reason: r.reason };
    targets[t] = { backend: o.backend, viewport: d.viewport, dpr: d.dpr, readiness, states: sp.states.map((s) => ({ key: s.key, domain: s.domain })), initial: sp.initial, assignments, next: sp.next };
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
      const file = files.get(id);
      if (file === undefined) throw new Error(`${component}: face ${id} is not a vendored font`);
      return { id, file };
    }),
    targets,
  };
}
