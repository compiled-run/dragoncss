// TXT-W1 (T147 part 1, notes/T147J-txt-weight.md) against the pinned Chrome: the font-weight and font-style grammar table and
// bolder/lighter chains compute as Chrome computes them, the synthesis predicate says synthesized exactly where Chrome's pixels
// change under font-synthesis, native refuses synthesized text, and each of the six plants is caught by one of these tests. The
// pins check that BASE's outputs are unchanged but for the computed keys added since.
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult } from 'dragon';
import * as dragon from 'dragon';
import type { CssValue } from '../../dragon/src/css/values.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import type { Diagnostic } from '../../dragon/src/index.ts';
import type { FontFaults } from '../../dragon/src/fonts/faults.ts';
import { NO_FONT_FAULTS, WEIGHT_FAULTS, withFault } from '../../dragon/src/fonts/faults.ts';
import { fsv } from '../../dragon/src/fonts/selection.ts';
import type { TextFontValue } from '../../dragon/src/fonts/weight.ts';
import { computeTextFont, INITIAL_TEXT_FONT, requestOf, serializeFontStyle, serializeFontWeight, synthesisOf } from '../../dragon/src/fonts/weight.ts';
import { layoutCases } from '../src/dpr.ts';
import { fixtureInput } from '../src/cases.ts';
import { layout } from '../src/fixture-groups/define.ts';
import { FONT_FIXTURES, withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { TEXT_WEIGHT } from '../src/fixture-groups/text-weight.ts';
import { TEXT_DECORATION_LONGHANDS } from '../../dragon/src/css/properties/text-decoration.ts';
import { FONT_VARIANT_LONGHANDS } from '../../dragon/src/css/properties/font-variant.ts';
import { FONT_TUNING_LONGHANDS } from '../../dragon/src/css/properties/font-tuning.ts';
import { FONT_STRETCH_LONGHANDS } from '../../dragon/src/css/properties/font-stretch.ts';
import { FONT_FEATURES_LONGHANDS } from '../../dragon/src/css/properties/font-features.ts';
import { TEXT_FILL_STROKE_LONGHANDS } from '../../dragon/src/css/properties/text-fill-stroke.ts';
import { TEXT_SHADOW_LONGHANDS } from '../../dragon/src/css/properties/text-shadow.ts';
import { WHITE_SPACE } from '../src/fixture-groups/white-space.ts';
import { FONT_REFERENCE_MAP, fontDataUrl, vendorFontBytes } from '../src/font-reference.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';

/**
 * A JSON value with every text leaf's overflowWrap and wordBreak removed where they are 'normal' (the TXT2-a migration), and every
 * LayoutStyle's lineClamp removed where it is 0 (the TXT2-g migration: a style is the object that carries textOverflow).
 */
function withoutWrapKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutWrapKeys);
  if (typeof v !== 'object' || v === null) return v;
  const o = v as Record<string, unknown>;
  const leaf = o['kind'] === 'text';
  const style = 'textOverflow' in o;
  return Object.fromEntries(Object.entries(o).filter(([k, x]) => !(leaf && (k === 'overflowWrap' || k === 'wordBreak') && x === 'normal') && !(style && k === 'lineClamp' && x === 0)).map(([k, x]) => [k, withoutWrapKeys(x)]));
}

/**
 * The outputs of BASE (batch2's regenerated head 768a8ebdf7: batch #281 at dde476247f plus #274's and #271's groups), as digests the BASE
 * pins recompute; BASE_OUTPUTS is retaken on TXT2-b word-spacing's regenerated head, whose vectors carry wordSpacing (px 0), and again
 * on TXT2-h text-indent's regenerated head, whose vectors carry textIndent (px 0) and differ from TXT2-b's in nothing else (13144 files, b60ff3dc48…). TXT2-a, stacked on TXT2-h, reads that same tree with its text-break
 * files and the vectors README left out and each vector without the TXT2-a TextLeaf keys at 'normal' (it has none), so the pinned bytes
 * are that head's (690a1b3fdb…, captures 3c5abaa478…). PNT1 (c3bc6ce193) then moved BASE on purpose: it took the translucent boxes out of
 * the BASE fixtures outline-3d, outline-dashed and radius-double (into its own outline-web and radius-double-web), which changes their
 * vectors, pixels and captures (84 files with their -rtl twins) and nothing else, so both digests are retaken on master 344627d93a.
 * With those 84 files put back at 6964e8a337 that tree still gives 690a1b3fdb… and 3c5abaa478….
 * The landing of #340 and #332 moves BASE again: #340 adds an inherited-currentcolor shadow to the BASE fixture shadow-cascade and #332
 * a hidden shape to svg-hidden, which changes their vectors, pixels and captures (and their -rtl twins) and nothing else, so both
 * digests are retaken on that landing's regenerated head. The landing of #370 does the same: it adds -webkit-opacity rows to the BASE
 * fixture opacity-cascade, which changes its vectors, pixels and captures (and its -rtl twin) and nothing else.
 */
const BASE_OUTPUTS = { files: 13143, digest: '5e7fe7b3a00581dad1178b58e59061a6ccca82fe36b90dc043d2dde36a7d9a7b' };
const BASE_CAPTURES = { files: 3354, digest: 'f480435bce4d3a70e0dd6ef1d580071ad684a9f0c313ed3690fbf6e996caa95a' };
const SOURCE = { uri: 'dragon-source://test/weight.css', revision: 'r1', hash: 'sha256:0' };

type Browser = { newPage(o?: object): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown>; screenshot(): Promise<Buffer> }>; close(): Promise<void> };
const chrome = async (): Promise<Browser> => ((await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> }).launchChrome();

/** How Dragon reads one declaration: its value, or the code that drops (invalid) or refuses it. */
function declared(property: 'font-weight' | 'font-style', value: string): { readonly value: CssValue | null; readonly code: string | null } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const lh = rules[0]?.declarations[0]?.longhands[0];
  return { value: lh === undefined ? null : lh.value, code: diagnostics[0]?.code ?? null };
}

/** One chain: nested elements, each with an optional font-weight and font-style declaration; the innermost is compared. */
type Chain = readonly { readonly weight?: string; readonly style?: string }[];

const WEIGHTS = ['normal', 'bold', 'bolder', 'lighter', 'BOLD', '1', '1.5', '100.1', '100.3', '100.4', '100.125', '999.9', '1000', '99.99', '400.24', '600.0',
  '0', '1001', '-5', '0.5', 'calc(250 + 0.3)', 'calc(2000)', 'calc(-5)', 'calc(0.1)', 'inherit', 'initial', 'unset', 'bold bolder', '700px'];
const STYLES = ['normal', 'italic', 'oblique', 'Italic', 'oblique 14deg', 'oblique 0deg', 'oblique -0deg', 'oblique 20deg', 'oblique -20deg', 'oblique 90deg', 'oblique -90deg',
  'oblique 13.999deg', 'oblique 13.9deg', 'oblique 10.1deg', 'oblique 0.2rad', 'oblique 10grad', 'oblique 0.25turn', 'oblique 1e1deg', 'OBLIQUE 20DEG',
  'oblique 91deg', 'oblique 100grad', 'oblique 0', 'oblique 20', 'left', 'right', 'inherit', 'initial', 'unset'];
const PARENTS = ['1', '99', '100', '349.75', '350', '549.75', '550', '749.75', '750', '899.75', '900', '1000'];

const CHAINS: readonly Chain[] = [
  ...WEIGHTS.flatMap((w) => [[{ weight: w }], [{ weight: '700', style: 'italic' }, { weight: w }]]),
  ...STYLES.flatMap((s) => [[{ style: s }], [{ style: 'oblique 20deg' }, { style: s }]]),
  ...PARENTS.flatMap((p) => [[{ weight: p }, { weight: 'bolder' }], [{ weight: p }, { weight: 'lighter' }], [{ weight: p }, {}], [{ weight: p }, {}, { weight: 'bolder' }]]),
  [{ weight: 'bolder' }, { weight: 'bolder' }, { weight: 'lighter' }],
  [{ weight: 'lighter' }, { weight: 'lighter' }, { weight: 'bolder' }],
];

/** Dragon's computed innermost font of a chain under the faults, or null when Dragon refuses a declaration of it (not compared). */
function dragonChain(chain: Chain, faults: FontFaults): string | null {
  let parent: TextFontValue = INITIAL_TEXT_FONT;
  for (const step of chain) {
    const read = (p: 'font-weight' | 'font-style', v: string | undefined): CssValue | null | 'refused' => {
      if (v === undefined) return null;
      const d = declared(p, v);
      if (d.code === 'DRAGON_CSS_INVALID_VALUE') return null;
      if (d.code !== null || d.value === null) return 'refused';
      if (d.value.kind === 'keyword' && ['inherit', 'unset'].includes(d.value.value)) return null;
      if (d.value.kind === 'keyword' && d.value.value === 'initial') return { kind: 'keyword', value: 'normal' };
      return d.value;
    };
    const weight = read('font-weight', step.weight);
    const style = read('font-style', step.style);
    if (weight === 'refused' || style === 'refused') return null;
    const font = computeTextFont({ weight, style }, parent, faults);
    if (font === null) throw new Error(JSON.stringify(step));
    parent = font;
  }
  return `${serializeFontWeight(parent.weight)} ${serializeFontStyle(parent.style)}`;
}

/** Chrome's computed innermost font of each chain, and whether every declaration of it parsed. */
async function chromeChains(chains: readonly Chain[]): Promise<{ readonly font: string; readonly parsed: boolean }[]> {
  const browser = await chrome();
  try {
    const page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><body></body>');
    return (await page.evaluate(`(${JSON.stringify(chains)}).map((chain) => {
      let at = document.body, parsed = true;
      const made = [];
      for (const step of chain) {
        const e = document.createElement('div');
        if (step.weight !== undefined) { e.style.setProperty('font-weight', step.weight); if (e.style.getPropertyValue('font-weight') === '') parsed = false; }
        if (step.style !== undefined) { e.style.setProperty('font-style', step.style); if (e.style.getPropertyValue('font-style') === '') parsed = false; }
        at.appendChild(e); made.push(e); at = e;
      }
      const cs = getComputedStyle(at);
      const out = { font: cs.fontWeight + ' ' + cs.fontStyle, parsed };
      made[0].remove();
      return out;
    })`)) as { font: string; parsed: boolean }[];
  } finally {
    await browser.close();
  }
}

describe('font-weight and font-style compute as Chrome 145 computes them', () => {
  it('the grammar table and the bolder and lighter chains, with invalid values dropped where Chrome drops them; the five value plants are caught', async () => {
    const seen = await chromeChains(CHAINS);
    const judge = (faults: FontFaults): string[] => CHAINS.flatMap((chain, i) => {
      const s = seen[i] as { font: string; parsed: boolean };
      const dropped = chain.some((st) => (st.weight !== undefined && declared('font-weight', st.weight).code === 'DRAGON_CSS_INVALID_VALUE') || (st.style !== undefined && declared('font-style', st.style).code === 'DRAGON_CSS_INVALID_VALUE'));
      const out: string[] = [];
      if (dropped && s.parsed) out.push(`${JSON.stringify(chain)}: Dragon calls it invalid, Chrome parses it`);
      if (!dropped && !s.parsed) out.push(`${JSON.stringify(chain)}: Dragon accepts it, Chrome drops it`);
      const mine = dragonChain(chain, faults);
      if (mine !== null && mine !== s.font) out.push(`${JSON.stringify(chain)}: Chrome ${s.font}, Dragon ${mine}`);
      return out;
    });
    expect(judge(NO_FONT_FAULTS)).toEqual([]);
    const refused = CHAINS.filter((c) => dragonChain(c, NO_FONT_FAULTS) === null).map((c) => JSON.stringify(c));
    expect(refused).toEqual([]);
    for (const fault of WEIGHT_FAULTS.filter((f) => f !== 'syntheticBoldThreshold700')) expect(judge(withFault(fault)).length, fault).toBeGreaterThan(0);
  }, 300_000);
});

describe('synthesis is where Chrome synthesizes (font-synthesis: none draws the base face)', () => {
  const face = (family: string, file: string, weight: string, style = 'normal'): string => `@font-face{font-family:${family};src:url("${fontDataUrl(vendorFontBytes(file))}");font-weight:${weight};font-style:${style}}`;
  const CSS = [face('Mono', 'NotoSansMono/NotoSansMono-Regular.ttf', '400'), face('Lato', 'Lato/Lato-Regular.ttf', '400'), face('Lato', 'Lato/Lato-Bold.ttf', '700'),
    face('Sans', 'Inter/Inter-Light.ttf', '300'), face('Sans', 'Inter/Inter-Regular.ttf', '400'), face('Sans', 'Inter/Inter-Italic.ttf', '400', 'italic'),
    face('Sans', 'Inter/Inter-Bold.ttf', '700'), face('Sans', 'Inter/Inter-BoldItalic.ttf', '700', 'italic')].join('\n');
  /** family, weight, style, and the declared weight and slope of the face Chrome matches (fonts/selection.ts, matching.json). */
  const ROWS: readonly (readonly [string, number, string, number, number])[] = [
    ['Mono', 400, 'normal', 400, 0], ['Mono', 599.75, 'normal', 400, 0], ['Mono', 600, 'normal', 400, 0], ['Mono', 650, 'normal', 400, 0], ['Mono', 700, 'normal', 400, 0],
    ['Mono', 400, 'italic', 400, 0], ['Mono', 400, 'oblique 13.75deg', 400, 0], ['Mono', 400, 'oblique 20deg', 400, 0],
    ['Lato', 400, 'italic', 400, 0], ['Lato', 400, 'oblique 13deg', 400, 0], ['Lato', 550, 'normal', 700, 0], ['Lato', 900, 'normal', 700, 0], ['Lato', 700, 'italic', 700, 0],
    ['Sans', 400, 'italic', 400, 14], ['Sans', 400, 'oblique 20deg', 400, 14], ['Sans', 400, 'oblique 10deg', 400, 0], ['Sans', 400, 'oblique -20deg', 400, 0],
    ['Sans', 600, 'normal', 700, 0], ['Sans', 300, 'italic', 400, 14], ['Sans', 900, 'italic', 700, 14], ['Sans', 100, 'normal', 300, 0],
  ];
  const styleOf = (s: string) => (s === 'normal' ? { kind: 'normal' as const } : s === 'italic' ? { kind: 'italic' as const } : { kind: 'oblique' as const, degrees: Number(/oblique (-?[0-9.]+)deg/.exec(s)?.[1]) });
  const predicted = (faults: FontFaults): boolean[] => ROWS.map(([, w, s, fw, fs]) => synthesisOf({ weight: { minimum: fsv(fw), maximum: fsv(fw) }, slope: { minimum: fsv(fs), maximum: fsv(fs) }, width: { minimum: fsv(100), maximum: fsv(100) } }, requestOf(w, styleOf(s)), faults) !== null);

  it('Chrome changes the pixels under font-synthesis exactly where synthesisOf predicts; syntheticBoldThreshold700 is caught', async () => {
    const browser = await chrome();
    const synthesized: boolean[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 420, height: 48 } });
      for (const [family, w, s] of ROWS) {
        const shot = async (synthesis: string): Promise<string> => {
          await page.setContent(`<style>${CSS} body{margin:0} div{font-family:${family};font-weight:${w};font-style:${s};font-size:24px;font-synthesis:${synthesis}}</style><div>Hamburgefonstiv</div>`);
          await page.evaluate('document.fonts.ready');
          return (await page.screenshot()).toString('base64');
        };
        synthesized.push((await shot('none')) !== (await shot('weight style')));
      }
    } finally {
      await browser.close();
    }
    expect(synthesized.filter(Boolean).length).toBeGreaterThan(4);
    expect(predicted(NO_FONT_FAULTS)).toEqual(synthesized);
    expect(predicted(withFault('syntheticBoldThreshold700'))).not.toEqual(synthesized);
  }, 300_000);
});

describe('the native refusals', () => {
  const compile = (input: FrontEndResult, fonts = FONT_REFERENCE_MAP): Compiled<'ios' | 'android' | 'web'> => dragon.createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, fonts },
    { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport },
  ).compile(input);
  const inputOf = (id: string): FrontEndResult => withFontMapAssets(fixtureInput(layout(id, ['ltr'], 'ahem')), FONT_REFERENCE_MAP);

  it('every text of fonts-weight-synthetic is DRAGON_SYNTHETIC_FONT_STYLE on ios and android, and web is ready', () => {
    const c = compile(inputOf('fonts-weight-synthetic'));
    const spec = FONT_FIXTURES.find((f) => f.spec.id === 'fonts-weight-synthetic');
    if (spec === undefined) throw new Error('fonts-weight-synthetic');
    for (const target of ['ios', 'android']) {
      const at = new Set(c.diagnostics.filter((d) => d.code === 'DRAGON_SYNTHETIC_FONT_STYLE' && d.target === target).map((d) => /^text ([^:]+):/.exec(d.message)?.[1]));
      expect([...at].sort(), target).toEqual(Object.keys(spec.faces).sort());
    }
    expect(c.diagnostics.filter((d) => d.severity === 'error' && (d.target === 'web' || d.target === null))).toEqual([]);
    expect(c.outputs.web.kind).toBe('ready');
  });

  it('a face file with the bold trait declared below 600 is refused where Chrome would suppress the synthesis', () => {
    // Lato's map entry swapped for Lato-Bold declared at 400: fonts-lato's h1 asks 700, so synthesis is predicted over a bold file.
    const map = { ...FONT_REFERENCE_MAP, families: { Lato: { mode: 'pinned' as const, family: 'Lato', faces: [{ src: 'vendor/fonts/Lato/Lato-Bold.ttf', weight: '400' }] } } };
    const input = withFontMapAssets(fixtureInput(layout('fonts-lato', ['ltr'], 'ahem')), map);
    const c = compile(input, map);
    const refused = c.diagnostics.filter((d) => d.code === 'DRAGON_SYNTHETIC_FONT_STYLE' && d.target === 'ios' && d.message.startsWith('text bold:')).map((d) => d.message);
    expect(refused).toEqual([expect.stringMatching(/^text bold:text0 in Lato at font-weight 700 and font-style normal would be drawn in synthetic bold that Chrome suppresses because the face file has the bold trait/)]);
  });
});

/** Case id prefixes of the groups that landed after BASE beside those named in the filter below (see own). */
const LATER_PREFIXES = ['atomic-inline-grid', 'outline-web', 'radius-double-web', 'resize-values', 'grid-baseline-axes', 'text-decoration-native-current', 'line-clamp-', 'stacking-grid-items', 'text-font-variant-', 'text-font-tuning-', 'text-font-stretch-', 'text-font-features-', 'text-font-size-', 'touch-action-values', 'radius-logical', 'grid-gap-units', 'ctx-proof-flex-gap-units', 'text-decoration-native-values', 'text-fill-stroke-', 'text-shadow-none', 'alias-background', 'shadow-webkit-alias'];

describe('BASE pins', () => {
  // The outputs of BASE that TXT-W1 must not change, pinned as digests (PIN-DERIVE: CI checks out the head alone, so the pins read
  // no git history): each is the sha256 of "<path>\t<sha256 of its content>" lines in path order, over every file but TXT-W1's own
  // (its text-weight cases and the fonts-weight-synthetic font fixture) and TXT-W2's (its font-shorthand cases). Each digest was taken at BASE with git and equals this
  // tree's; a merge that moves BASE retakes them there (git show BASE:<path>) and states why in its message.
  // TDEC-a2's text-decoration cases (the web-only lane's captures) are its own as well. TXT2-c's white-space group and TXT2's
  // text-justify cases landed after BASE, and so did TXT2-b's word-spacing, TXT2-h's text-indent and the svg-colors cases (#297): their own
  // files are left out as TXT-W1's are (they add files only, and change none of BASE's).
  // TXT2-a's text-break cases are left out the same way.
  // The groups that landed after BASE and add files only: G-INL's atomic-inline-grid, PNT1's outline-web and radius-double-web,
  // resize-values, G3b's grid-baseline-axes, PNT's text-decoration-native-current, TXT2-g's line-clamp cases, PNT1's stacking-grid-items cases and touch-action-values. (PNT1's change to
  // three BASE fixtures is retaken in BASE_OUTPUTS and BASE_CAPTURES, not left out.)
  const own = (p: string): boolean => /(^|\/)(text-weight-|fonts-weight-synthetic|font-shorthand-|text-decoration-|white-space-|text-justify-|text-word-spacing-|text-indent-|svg-colors|text-break-|atomic-inline-grid|outline-web|radius-double-web|resize-values|grid-baseline-axes|line-clamp-|stacking-grid-items|text-font-variant-|text-font-tuning-|text-font-stretch-|text-font-features-|text-font-size-|touch-action-values|radius-logical|grid-gap-units|ctx-proof-flex-gap-units|text-fill-stroke-|text-shadow-none|alias-background|shadow-webkit-alias)/.test(p);
  const files = (dirs: readonly string[], keep: (p: string) => boolean): string[] => dirs.flatMap((d) => (readdirSync(repoPath(d), { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((f) => f.isFile()).map((f) => relative(repoPath('.'), join(f.parentPath, f.name)).split(sep).join('/'))).filter((p) => keep(p) && !own(p)).sort();
  const digest = (paths: readonly string[], content: (p: string) => string | Buffer): string =>
    createHash('sha256').update(paths.map((p) => `${p}\t${createHash('sha256').update(content(p)).digest('hex')}\n`).join('')).digest('hex');
  it('the text-weight group adds exactly its own layout cases and keeps every BASE case in order', () => {
    const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));
    const added = TEXT_WEIGHT.filter((f) => f.kind === 'layout').flatMap((f) => [f.id, `${f.id}-rtl`]);
    // Groups after the per-feature split run in id order (fixtures.ts), so the text-weight group sits between text-latin and transforms.
    expect(ids.filter((id) => added.includes(id))).toEqual(added);
    // TXT-W2's font-shorthand cases are its own too, as the digests below exclude them; TXT2-c's white-space layout cases and TXT2's
    // text-justify cases landed after BASE.
    const later = WHITE_SPACE.filter((f) => f.kind === 'layout').flatMap((f) => [f.id, `${f.id}-rtl`]);
    const base = ids.filter((id) => !added.includes(id) && !id.startsWith('font-shorthand-') && !later.includes(id) && !id.startsWith('text-justify-') && !id.startsWith('text-word-spacing-') && !id.startsWith('text-indent-') && !id.startsWith('svg-colors') && !id.startsWith('text-break-') && !LATER_PREFIXES.some((p) => id.startsWith(p)));
    // BASE is batch #284's regenerated head da2a902a7e (text-batch2, #247, #282, #283, #275) with #285's, #280's and #286's groups, whose FIXTURES hold 828 BASE layout cases.
    expect(base.length).toBe(828);
    expect(createHash('sha256').update(base.join('\n')).digest('hex')).toBe('913a57ff7fbe0dd1f9eb9b3fc119cd82889e581ec4a9f6e628b0d675a73febf3');
  });
  it('every existing vector, break vector, break capture and pixel PNG is byte-identical to BASE (vectors up to the TXT2-a TextLeaf keys and the TXT2-g lineClamp)', () => {
    // TXT2-a gives every text leaf overflowWrap and wordBreak, so a vector is digested as its JSON with both removed where they are
    // 'normal' (every other byte of it is still pinned), and the vectors README (a format document, not a vector) documents the keys.
    const dirs = ['packages/layout/vectors', 'packages/layout/break-vectors', 'packages/parity/expected-breaks', 'packages/parity/expected-pixels'];
    const paths = files(dirs, (p) => !/expected-pixels\/darwin-arm64\/manifest\.json$/.test(p) && p !== 'packages/layout/vectors/README.md');
    const content = (p: string): string | Buffer => p.startsWith('packages/layout/vectors/') && p.endsWith('.json')
      ? JSON.stringify(withoutWrapKeys(JSON.parse(readFileSync(repoPath(p), 'utf8')) as unknown)) : readFileSync(repoPath(p));
    expect({ files: paths.length, digest: digest(paths, content) }).toEqual(BASE_OUTPUTS);
    // The migration exception is not a blanket pass: a leaf whose key is not 'normal' keeps the key and differs.
    expect(withoutWrapKeys({ kind: 'text', overflowWrap: 'anywhere', wordBreak: 'normal' })).toEqual({ kind: 'text', overflowWrap: 'anywhere' });
  });
  /** The computed keys added since BASE: TXT-W1's font-weight and font-style, TXT-W2's font-synthesis longhands, TDEC-a's decoration longhands, TXT2-b's spacing, TXT2-h's text-indent, TXT2-a's overflow-wrap and word-break, TXT2-g's -webkit-box-orient and -webkit-line-clamp, resize-values' resize, touch-action-values' touch-action, TXT-FX's text fill, stroke and shadow, the font-variant, font-tuning, font-stretch and font-features longhands. */
  const ADDED_KEYS = ['font-weight', 'font-style', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', ...TEXT_DECORATION_LONGHANDS, 'letter-spacing', 'word-spacing', 'text-indent', 'overflow-wrap', 'word-break', '-webkit-box-orient', '-webkit-line-clamp', 'resize', 'touch-action', ...TEXT_FILL_STROKE_LONGHANDS, ...TEXT_SHADOW_LONGHANDS, ...FONT_VARIANT_LONGHANDS, ...FONT_TUNING_LONGHANDS, ...FONT_STRETCH_LONGHANDS, ...FONT_FEATURES_LONGHANDS];
  it('every existing capture equals BASE once the computed keys added since are removed', () => {
    const dirs = ['packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/expected-fonts'];
    const paths = files(dirs, (p) => p.endsWith('.json'));
    expect(paths.length).toBeGreaterThan(1500);
    const lacking: string[] = [];
    const stripped = (p: string): string => {
      const c = JSON.parse(readFileSync(repoPath(p), 'utf8')) as { nodes?: { computed: Record<string, string> | null }[] };
      for (const n of c.nodes ?? []) {
        if (n.computed === null) continue;
        if (ADDED_KEYS.some((k) => n.computed?.[k] === undefined)) lacking.push(p);
        for (const k of ADDED_KEYS) delete n.computed[k];
      }
      return JSON.stringify(c);
    };
    expect({ files: paths.length, digest: digest(paths, stripped) }).toEqual(BASE_CAPTURES);
    expect([...new Set(lacking)]).toEqual([]);
    expect(readdirSync(repoPath('packages/parity/expected/darwin-arm64')).some((f) => f.startsWith('text-weight-numeric'))).toBe(true);
  });
});
