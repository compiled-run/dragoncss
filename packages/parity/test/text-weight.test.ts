// TXT-W1 (T147 part 1, notes/T147J-txt-weight.md) against the pinned Chrome: the font-weight and font-style grammar table and
// bolder/lighter chains compute as Chrome computes them, the synthesis predicate says synthesized exactly where Chrome's pixels
// change under font-synthesis, native refuses synthesized text, and each of the six plants is caught by one of these tests. The
// pins check that BASE's outputs are unchanged but for the two computed keys.
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
import { FONT_REFERENCE_MAP, fontDataUrl, vendorFontBytes } from '../src/font-reference.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';

/** The outputs of BASE (inl1a-tags-v2 at 186dba301c, #105 caught up with master ef96e1c079), as digests the BASE pins recompute. */
const BASE_OUTPUTS = { files: 12196, digest: '4c1a48fa2bf16876fafb835e58052616aba5e09e03847cf72c57fe85ad60f0ef' };
const BASE_CAPTURES = { files: 3114, digest: '5144ddabbaca0c722d9a9da39eee0526d0246f685c27518f75386aaa68f5a43b' };
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

describe('BASE pins', () => {
  // The outputs of BASE that TXT-W1 must not change, pinned as digests (PIN-DERIVE: CI checks out the head alone, so the pins read
  // no git history): each is the sha256 of "<path>\t<sha256 of its content>" lines in path order, over every file but TXT-W1's own
  // (its text-weight cases and the fonts-weight-synthetic font fixture). Each digest was taken at BASE with git and equals this
  // tree's; a merge that moves BASE retakes them there (git show BASE:<path>) and states why in its message.
  const own = (p: string): boolean => /(^|\/)(text-weight-|fonts-weight-synthetic)/.test(p);
  const files = (dirs: readonly string[], keep: (p: string) => boolean): string[] => dirs.flatMap((d) => (readdirSync(repoPath(d), { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((f) => f.isFile()).map((f) => relative(repoPath('.'), join(f.parentPath, f.name)).split(sep).join('/'))).filter((p) => keep(p) && !own(p)).sort();
  const digest = (paths: readonly string[], content: (p: string) => string | Buffer): string =>
    createHash('sha256').update(paths.map((p) => `${p}\t${createHash('sha256').update(content(p)).digest('hex')}\n`).join('')).digest('hex');
  it('the text-weight group adds exactly its own layout cases and keeps every BASE case in order', () => {
    const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));
    const added = TEXT_WEIGHT.filter((f) => f.kind === 'layout').flatMap((f) => [f.id, `${f.id}-rtl`]);
    // Groups after the per-feature split run in id order (fixtures.ts), so the text-weight group sits between text-latin and transforms.
    expect(ids.filter((id) => added.includes(id))).toEqual(added);
    const base = ids.filter((id) => !added.includes(id));
    // BASE is batch #262 (master f88834ce3d plus #257, #238, #254, #260 and #104-#105, which land with this change), whose FIXTURES hold 766 layout cases.
    expect(base.length).toBe(766);
    expect(createHash('sha256').update(base.join('\n')).digest('hex')).toBe('9ed8160c7db04452c284f56fea08be80f8b3900d806881535604eccb9764b25e');
  });
  it('every existing vector, break vector, break capture and pixel PNG is byte-identical to BASE', () => {
    const dirs = ['packages/layout/vectors', 'packages/layout/break-vectors', 'packages/parity/expected-breaks', 'packages/parity/expected-pixels'];
    const paths = files(dirs, (p) => !/expected-pixels\/darwin-arm64\/manifest\.json$/.test(p));
    expect({ files: paths.length, digest: digest(paths, (p) => readFileSync(repoPath(p))) }).toEqual(BASE_OUTPUTS);
  });
  it('every existing capture equals BASE once font-weight and font-style are removed from its computed values', () => {
    const dirs = ['packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/expected-fonts'];
    const paths = files(dirs, (p) => p.endsWith('.json'));
    expect(paths.length).toBeGreaterThan(1500);
    const lacking: string[] = [];
    const stripped = (p: string): string => {
      const c = JSON.parse(readFileSync(repoPath(p), 'utf8')) as { nodes?: { computed: Record<string, string> | null }[] };
      for (const n of c.nodes ?? []) {
        if (n.computed === null) continue;
        if (n.computed['font-weight'] === undefined || n.computed['font-style'] === undefined) lacking.push(p);
        delete n.computed['font-weight'];
        delete n.computed['font-style'];
      }
      return JSON.stringify(c);
    };
    expect({ files: paths.length, digest: digest(paths, stripped) }).toEqual(BASE_CAPTURES);
    expect([...new Set(lacking)]).toEqual([]);
    expect(readdirSync(repoPath('packages/parity/expected/darwin-arm64')).some((f) => f.startsWith('text-weight-numeric'))).toBe(true);
  });
});
