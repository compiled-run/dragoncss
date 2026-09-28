// The north-star device lane's case manifest (docs/goals/milestone-2-proof/notes/T010-north-star-plan.md, section 3). Every case
// is derived here: the free states x scroll positions, one forced case per :hover/:focus subject in styles.css, and the
// animation and transition frames, over the platform matrix. lane/manifest.json is this derivation written out.
import { createHash } from 'node:crypto';
import { inventory } from './css-inventory.ts';
import { FREE_STATES } from './snapshot.ts';
import type { FreeStateId } from './snapshot.ts';

export const LANE_SCHEMA = 'dragon-north-star-lane/1';
export const DUMP_SCHEMA = 'dragon-north-star-lane-chrome/1';
export const PIXEL_SCHEMA = 'dragon-north-star-pixels/1';
export const LANE_MANIFEST_FILE = 'lane/manifest.json';
export const PIXEL_MANIFEST_FILE = 'chrome/pixel-manifest.json';

export type LanePlatform = {
  readonly id: 'ios' | 'android';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly dprs: readonly number[];
};

/** Each root is a fixed CSS viewport; the device runner stops rather than crop. */
export const LANE_PLATFORMS: readonly LanePlatform[] = [
  { id: 'ios', viewport: { width: 390, height: 844 }, dprs: [2, 3] },
  { id: 'android', viewport: { width: 412, height: 915 }, dprs: [2, 2.625, 3] },
];

/** Every DPR Chrome is launched at, in launch order: one browser per DPR serves every platform at that DPR. */
export const LANE_DPRS: readonly number[] = [...new Set(LANE_PLATFORMS.flatMap((p) => p.dprs))].sort((a, b) => a - b);

export type Pseudo = 'hover' | 'focus';

export type LaneCase = {
  readonly id: string;
  readonly kind: 'state' | 'forced' | 'frame';
  /** The free state the page is loaded in. */
  readonly start: FreeStateId;
  readonly scroll: 'top' | 'end';
  /** CDP CSS.forcePseudoState on the first subject match whose declared properties change, with transitions finished. */
  readonly forced: { readonly pseudo: Pseudo; readonly selector: string; readonly subject: string } | null;
  /** State changes on the virtual clock, in ms from load. */
  readonly steps: readonly { readonly atMs: number; readonly to: FreeStateId }[];
  /** The frozen time of every animation and transition clock, in ms from load. */
  readonly tMs: number;
};

/** Forced subjects that are only visible with the library sheet open are forced in that state; everything else in main. */
export const FORCED_BASE_STATE: Readonly<Record<string, FreeStateId>> = { '.library-song': 'library-open' };

/** Animation and transition frames: album-spin paused and playing at 0 s and 5 s, the library toggle both ways at 0.25 s, and a pause at 5 s read at 6 s. */
const FRAMES: readonly Omit<LaneCase, 'kind' | 'scroll' | 'forced'>[] = [
  { id: 'spin-paused-0ms', start: 'main', steps: [], tMs: 0 },
  { id: 'spin-paused-5000ms', start: 'main', steps: [], tMs: 5000 },
  { id: 'spin-playing-0ms', start: 'playing', steps: [], tMs: 0 },
  { id: 'spin-playing-5000ms', start: 'playing', steps: [], tMs: 5000 },
  { id: 'library-opening-250ms', start: 'main', steps: [{ atMs: 0, to: 'library-open' }], tMs: 250 },
  { id: 'library-closing-250ms', start: 'library-open', steps: [{ atMs: 0, to: 'main' }], tMs: 250 },
  { id: 'paused-at-5000ms-6000ms', start: 'playing', steps: [{ atMs: 5000, to: 'main' }], tMs: 6000 },
];

const slug = (s: string): string =>
  s
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/** Every selector in styles.css whose subject carries :hover or :focus, in stylesheet order, with the pseudo stripped. */
export function forcedSubjects(css: string): readonly { readonly pseudo: Pseudo; readonly selector: string; readonly subject: string }[] {
  const out: { pseudo: Pseudo; selector: string; subject: string }[] = [];
  const seen = new Set<string>();
  for (const d of inventory(css).declarations) {
    if (d.atRule !== null) continue;
    for (const part of d.selector.split(',').map((s) => s.trim())) {
      const m = /^(.*):(hover|focus)$/.exec(part);
      if (m === null || seen.has(part)) continue;
      if (/:(hover|focus)/.test(m[1] as string)) throw new Error(`${part}: a pseudo-class outside the subject`);
      seen.add(part);
      out.push({ pseudo: m[2] as Pseudo, selector: part, subject: m[1] as string });
    }
  }
  return out;
}

export function laneCases(css: string): readonly LaneCase[] {
  const cases: LaneCase[] = [];
  for (const s of FREE_STATES) {
    for (const scroll of ['top', 'end'] as const) cases.push({ id: `${s.id}-${scroll}`, kind: 'state', start: s.id, scroll, forced: null, steps: [], tMs: 0 });
  }
  const subjects = forcedSubjects(css);
  for (const key of Object.keys(FORCED_BASE_STATE)) {
    if (!subjects.some((s) => s.subject === key)) throw new Error(`FORCED_BASE_STATE names ${key}, which is no forced subject`);
  }
  for (const f of subjects) {
    cases.push({ id: `${f.pseudo}-${slug(f.subject)}`, kind: 'forced', start: FORCED_BASE_STATE[f.subject] ?? 'main', scroll: 'top', forced: f, steps: [], tMs: 0 });
  }
  for (const f of FRAMES) cases.push({ ...f, kind: 'frame', scroll: 'top', forced: null });
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error('duplicate lane case id');
  return cases;
}

export const dprLabel = (dpr: number): string => `dpr-${dpr}`;
export const platformLabel = (p: LanePlatform): string => `${p.id}-${p.viewport.width}x${p.viewport.height}`;
/** Relative to the example directory. */
export const captureDir = (p: LanePlatform, dpr: number): string => `chrome/${platformLabel(p)}/${dprLabel(dpr)}`;

/** The raster-size rule for non-integral roots (O4): each PNG side is ceil(css px x DPR); 412 x 2.625 = 1081.5 rasters to 1082. */
export const RASTER_RULE = {
  rule: 'ceil',
  text: 'PNG width = ceil(viewport.width x DPR), PNG height = ceil(viewport.height x DPR); a non-integral root rounds its partial device pixel up',
} as const;
export const rasterSize = (css: number, dpr: number): number => Math.ceil(css * dpr);

export type LaneCapture = { readonly platform: LanePlatform; readonly dpr: number; readonly case: LaneCase; readonly png: string; readonly dump: string };

/** Every capture of the matrix, in capture order (DPR, platform, case). */
export function laneCaptures(css: string): readonly LaneCapture[] {
  const cases = laneCases(css);
  const out: LaneCapture[] = [];
  for (const dpr of LANE_DPRS) {
    for (const platform of LANE_PLATFORMS) {
      if (!platform.dprs.includes(dpr)) continue;
      const dir = captureDir(platform, dpr);
      for (const c of cases) out.push({ platform, dpr, case: c, png: `${dir}/${c.id}.png`, dump: `${dir}/${c.id}.json` });
    }
  }
  return out;
}

/** The committed lane manifest: the matrix, the derived case list and the per-platform, per-DPR case counts. */
export function laneManifest(css: string): unknown {
  const cases = laneCases(css);
  return {
    schema: LANE_SCHEMA,
    platforms: LANE_PLATFORMS.map((p) => ({ ...p, dir: platformLabel(p) })),
    cases,
    counts: Object.fromEntries(LANE_PLATFORMS.map((p) => [p.id, Object.fromEntries(p.dprs.map((d) => [String(d), cases.length]))])),
    total: LANE_PLATFORMS.reduce((n, p) => n + p.dprs.length * cases.length, 0),
  };
}

/** JSON with one array item per line at depth 1 and 2: diffable, and small enough for 100 dumps. */
export function laneJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return `${JSON.stringify(value)}\n`;
  const entries = Array.isArray(value) ? value.map((v) => [null, v] as const) : Object.entries(value as Record<string, unknown>);
  const lines = entries.map(([k, v]) => {
    const key = k === null ? '' : `${JSON.stringify(k)}: `;
    if (Array.isArray(v) && v.length > 0) return `${key}[\n${v.map((item) => `  ${JSON.stringify(item)}`).join(',\n')}\n ]`;
    return `${key}${JSON.stringify(v)}`;
  });
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${lines.map((l) => ` ${l}`).join(',\n')}\n${close}\n`;
}

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

export type PlatformFont = { readonly familyName: string; readonly postScriptName: string; readonly isCustomFont: boolean };

/** The font key: sha256 of the sorted distinct platform fonts Chrome rendered text with. A lane build whose key differs is stale. */
export function fontKey(fonts: readonly PlatformFont[]): string {
  const rows = [...new Set(fonts.map((f) => `${f.familyName}\t${f.postScriptName}\t${f.isCustomFont}`))].sort();
  return sha256(rows.join('\n'));
}

/** PNG width and height from the IHDR chunk. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => png[i] === b)) throw new Error('not a PNG');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
