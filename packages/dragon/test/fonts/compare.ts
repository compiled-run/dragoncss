// Runs the fonts module on the inputs recorded in the Chrome captures and pairs each result with Chrome's. The tests require every
// pair to be equal without faults, and every planted capture fault to break at least one pair.
import { readFileSync } from 'node:fs';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import {
  candidates, descriptorText, DESCRIPTOR_NAMES, faceMetrics, NO_FONT_FAULTS, parseFamilyList, parseFontFace, readSfnt, rewriteFamilyList,
  selectionRequest, serializeFamilyList,
} from '../../src/fonts/index.ts';
import type { DeclaredFace, FontFaults, FontMap, MetricDescriptors } from '../../src/fonts/index.ts';

const root = new URL('../../../../', import.meta.url);
export const vendorBytes = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`vendor/fonts/${file}`, root)));
export const capture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./captures/${name}`, import.meta.url), 'utf8')) as T;

/** Case CSS names vendored fonts as url("fonts/<file>"); they resolve to snapshot-like assets. */
export const resolveFonts = (specifier: string): { id: string; bytes: Uint8Array } | null =>
  specifier.startsWith('fonts/') ? { id: `asset:${specifier}`, bytes: vendorBytes(specifier.slice('fonts/'.length)) } : null;

export const atRules = (css: string): CssNode[] =>
  ((parse(css, { positions: true, parseValue: true }) as unknown as { children: { toArray(): CssNode[] } }).children.toArray()).filter((n) => n.type === 'Atrule');

export type Comparison = { readonly group: string; readonly id: string; readonly dragon: unknown; readonly chrome: unknown };
export const same = (c: Comparison): boolean => JSON.stringify(c.dragon) === JSON.stringify(c.chrome);

type PlatformFont = { postScriptName: string; isCustomFont: boolean; glyphCount: number };
type Req = { family: string; weight: number; stretch: number; style: string; text: string; chrome: PlatformFont[] };

const chromeBuckets = (fonts: readonly PlatformFont[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const f of fonts) {
    const k = f.isCustomFont ? f.postScriptName : 'platform';
    out[k] = (out[k] ?? 0) + f.glyphCount;
  }
  return sortKeys(out);
};
const sortKeys = (o: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

/** Computed font-style text to the selection request's slope. */
function styleOf(style: string): Parameters<typeof selectionRequest>[2] {
  if (style === 'normal') return { kind: 'normal' };
  if (style === 'italic') return { kind: 'italic' };
  const m = /^oblique (-?[\d.]+)deg$/.exec(style);
  if (m === null) throw new Error(`style ${style}`);
  return Number(m[1]) === 0 ? { kind: 'normal' } : { kind: 'oblique', degrees: Number(m[1]) };
}

/** The face per character: the first family in the list with a candidate face for it; 'platform' when none has one. */
function dragonBuckets(faces: readonly DeclaredFace[], r: Omit<Req, 'chrome'>, faults: FontFaults): Record<string, number> {
  const list = parseFamilyList(r.family);
  if (list === null) throw new Error(`family list ${r.family}`);
  const request = selectionRequest(r.weight, r.stretch, styleOf(r.style));
  const out: Record<string, number> = {};
  for (const ch of r.text) {
    const cp = ch.codePointAt(0) as number;
    let name = 'platform';
    for (const e of list) {
      if (e.kind === 'generic') break;
      const face = candidates(faces, e.name, request, cp, faults)[0];
      if (face !== undefined) {
        name = face.source?.font.names.postScriptName ?? '(unreadable)';
        break;
      }
    }
    out[name] = (out[name] ?? 0) + 1;
  }
  return sortKeys(out);
}

const facesOf = (css: string): DeclaredFace[] =>
  atRules(css).map((n, i) => parseFontFace(n, i, resolveFonts)).flatMap((r) => (r.face === null ? [] : [r.face]));

export function matchingComparisons(faults: FontFaults): Comparison[] {
  const cap = capture<{ cases: { id: string; css: string; requests: Req[] }[] }>('matching.json');
  return cap.cases.flatMap((c) => {
    const faces = facesOf(c.css);
    return c.requests.map((r, i) => ({ group: 'matching', id: `${c.id}#${i} ${r.family} ${r.weight} ${r.stretch}% ${r.style} "${r.text}"`, dragon: dragonBuckets(faces, r, faults), chrome: chromeBuckets(r.chrome) }));
  });
}

type MetricRow = { variant: string; descriptors: string; file: string; dpr: number; size: number; ex: number; ch: number; cap: number; height: number; baseline: number; top: number };

/**
 * getBoundingClientRect is LayoutUnit geometry in device px scaled by 1/zoom in float (the capture puts each block at top 0),
 * so a LayoutUnit length L reads as f32(f32(L / 64) * f32(1 / dpr)).
 */
export const cssPx = (layoutUnits: number, dpr: number): number => Math.fround(Math.fround(layoutUnits / 64) * Math.fround(1 / dpr));

export function metricComparisons(faults: FontFaults): Comparison[] {
  const cap = capture<{ rows: MetricRow[] }>('metrics.json');
  return cap.rows.flatMap((r): Comparison[] => {
    const bytes = vendorBytes(r.file);
    const node = atRules(`@font-face{font-family:M;src:url("fonts/${r.file}");${r.descriptors}}`)[0] as CssNode;
    const d = parseFontFace(node, 0, resolveFonts).descriptors;
    const md: { -readonly [K in keyof MetricDescriptors]: number } = {};
    if (d.sizeAdjust !== undefined) md.sizeAdjust = d.sizeAdjust / 100;
    if (typeof d.ascentOverride === 'number') md.ascentOverride = d.ascentOverride / 100;
    if (typeof d.descentOverride === 'number') md.descentOverride = d.descentOverride / 100;
    if (typeof d.lineGapOverride === 'number') md.lineGapOverride = d.lineGapOverride / 100;
    const read = readSfnt(bytes);
    if (!read.ok) throw new Error(`${r.file} unreadable`);
    const m = faceMetrics(read.font, r.size, r.dpr, md, faults);
    const id = `${r.variant}/${r.file}/dpr ${r.dpr}/${r.size}px`;
    if (!m.ok) return [{ group: 'metrics', id, dragon: m.refusal, chrome: r }];
    const x = m.metrics;
    return [
      { group: 'metrics.ex', id, dragon: x.ex, chrome: r.ex },
      { group: 'metrics.ch', id, dragon: x.ch, chrome: r.ch },
      { group: 'metrics.cap', id, dragon: x.cap, chrome: r.cap },
      { group: 'metrics.line-height-normal', id, dragon: cssPx(x.lineBoxHeightLayoutUnits, r.dpr), chrome: r.height },
      { group: 'metrics.baseline', id, dragon: cssPx(x.baselineLayoutUnits, r.dpr), chrome: r.baseline },
    ];
  });
}

type ParseRule = { css: string; values: Record<string, string> | null; faces: number };
type FamilyCase = { value: string; parentComputed: string; computed: string };

export function parsingComparisons(faults: FontFaults): Comparison[] {
  const cap = capture<{ rules: ParseRule[]; families: FamilyCase[] }>('parsing.json');
  const rules = cap.rules.map((r) => {
    const res = parseFontFace(atRules(`@font-face{${r.css}}`)[0] as CssNode, 0, () => null, faults);
    const values = Object.fromEntries(DESCRIPTOR_NAMES.map((n) => [n, descriptorText(res.descriptors, n)]));
    return { group: 'parsing.font-face', id: r.css, dragon: { values, faces: res.face === null ? 0 : 1 }, chrome: { values: r.values, faces: r.faces } };
  });
  const families = cap.families.map((f) => {
    const list = parseFamilyList(f.value);
    return { group: 'parsing.font-family', id: f.value, dragon: list === null ? f.parentComputed : serializeFamilyList(list), chrome: f.computed };
  });
  return [...rules, ...families];
}

type PinnedReq = Omit<Req, 'chrome'> & { rewritten: string; fontFaceRules: string[]; chrome: PlatformFont[] };

export function pinnedComparisons(faults: FontFaults): Comparison[] {
  const cap = capture<{ map: FontMap; requests: PinnedReq[] }>('pinned.json');
  return cap.requests.flatMap((r, i) => {
    const list = parseFamilyList(r.family);
    if (list === null) throw new Error(r.family);
    const rewrite = rewriteFamilyList(list, cap.map, new Set(), (s) => s);
    const faces = facesOf(rewrite.fontFaceRules.join('\n'));
    const id = `${i} ${r.family} ${r.weight} ${r.style}`;
    return [
      { group: 'pinned.rewrite', id, dragon: { value: rewrite.value, rules: rewrite.fontFaceRules }, chrome: { value: r.rewritten, rules: r.fontFaceRules } },
      { group: 'pinned.face', id, dragon: dragonBuckets(faces, { ...r, family: rewrite.value }, faults), chrome: chromeBuckets(r.chrome) },
    ];
  });
}

export function allComparisons(faults: FontFaults = NO_FONT_FAULTS): Comparison[] {
  return [...matchingComparisons(faults), ...metricComparisons(faults), ...parsingComparisons(faults), ...pinnedComparisons(faults)];
}
