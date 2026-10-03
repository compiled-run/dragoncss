// TXT-W2 (T147 part 2, notes/T147J-txt-weight.md) against the pinned Chrome: the font and font-synthesis shorthands expand as
// Chrome 145 expands them. Each value of the grammar table is set as written on one element and as Dragon's longhands on its
// sibling, under a parent with non-initial line-height, weight and font-synthesis; the computed values must agree, every longhand
// Dragon does not model must stay initial, and values Dragon calls invalid must be ones Chrome drops. The three plants are caught.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import type { FrontEndResult } from 'dragon';
import * as dragon from 'dragon';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { FONT_RESET_LONGHANDS } from '../../dragon/src/css/properties/text.ts';
import { fontShorthand, TEXT_SHORTHANDS } from '../../dragon/src/css/shorthands/text.ts';
import type { ShorthandHandler } from '../../dragon/src/css/shorthands/shared.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { CSS_WIDE } from '../../dragon/src/css/values.ts';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { NO_FONT_FAULTS, SHORTHAND_FAULTS, withFault } from '../../dragon/src/fonts/faults.ts';
import type { FontFaults } from '../../dragon/src/fonts/faults.ts';
import { layoutCases } from '../src/dpr.ts';
import { FONT_SHORTHAND } from '../src/fixture-groups/font-shorthand.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { TEXT_DECORATION_LONGHANDS } from '../../dragon/src/css/properties/text-decoration.ts';
import { repoPath } from '../src/paths.ts';

const SOURCE = { uri: 'dragon-source://test/font.css', revision: 'r1', hash: 'sha256:0' };

type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };
const chrome = async (): Promise<Browser> => ((await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> }).launchChrome();

const FONT = ['12px x', 'italic bold 12px/30px Georgia, serif', 'bold italic 12px x', 'normal normal normal normal 12px x', 'normal normal normal normal normal 12px x',
  'oblique 20deg 12px x', 'oblique 12px x', 'oblique 14deg 600 12px x', 'oblique 91deg 12px x', 'oblique 2turn 12px x', '300 12px x', '1000 12px x', '0 12px x', 'bolder 12px x', 'lighter 12px x',
  '12px', 'x', '12px/normal x', '12px / 1.5 x', 'larger x', 'medium x', '2em x', '10% x', '12px/1.5em x', '12px/20% x', '12px "a b", c', '12px x y', '12px 100', 'italic italic 12px x',
  '400 bold 12px x', 'italic oblique 12px x', 'left 12px x', 'italic left 12px x', 'small-caps 12px x', 'condensed 12px x', 'normal small-caps 12px x', 'ultra-expanded 12px x', 'normal 100% 12px x',
  'caption', 'menu', 'icon', 'message-box', 'small-caption', 'status-bar', '-webkit-small-control', 'inherit', 'initial', 'unset', 'Italic BOLD 12PX X', '12px/30px sans-serif', '700 1.5em/2 monospace'];
const SYNTHESIS = ['none', 'weight', 'style', 'small-caps', 'position', 'weight style', 'style weight', 'weight style small-caps', 'small-caps weight', 'auto', 'weight weight', 'inherit', 'initial', 'unset', 'NONE'];
const SYNTHESIS_LONGHANDS = [['font-synthesis-weight', 'auto'], ['font-synthesis-weight', 'none'], ['font-synthesis-style', 'oblique-only'], ['font-synthesis-style', 'none'], ['font-synthesis-small-caps', 'none'], ['font-synthesis-small-caps', 'auto']] as const;

/** Dragon's reading of one declaration: the code that drops or refuses it, and the longhands it sets. */
function declare(property: string, value: string): { readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = rules[0]?.declarations[0];
  return { code: diagnostics[0]?.code ?? null, longhands: (d?.longhands ?? []).map((l) => [l.property, valueToString(l.value)] as const) };
}

/** The longhands a font handler under a fault sets for a value Dragon accepts (CSS-wide keywords set each of its longhands). */
function planted(handler: ShorthandHandler, value: string): (readonly [string, string])[] {
  const node = parse(value, { context: 'value' } as Parameters<typeof parse>[1]);
  const tokens = (node['children'] as { toArray(): CssNode[] }).toArray().filter((n) => n.type !== 'WhiteSpace');
  const lower = value.toLowerCase();
  if (CSS_WIDE.has(lower)) return handler.longhands.map((p) => [p, lower] as const);
  return handler.expand([], tokens).map((l) => [l.property, valueToString(l.value)] as const);
}

type Item = { readonly property: string; readonly value: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] };
type Seen = { readonly parsed: boolean; readonly diff: readonly string[]; readonly reset: readonly string[] };

const COMPARED = ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', ...Object.keys(FONT_RESET_LONGHANDS)];

async function chromeSeen(sets: readonly (readonly Item[])[]): Promise<Seen[][]> {
  const browser = await chrome();
  try {
    const page = await browser.newPage();
    // The parent's line-height, weight and font-synthesis are not initial, so a longhand Dragon fails to reset or inherit shows.
    await page.setContent('<!DOCTYPE html><div id="p" style="line-height:7px;font-weight:700;font-synthesis:none;font-size:20px"><div id="a"></div><div id="c"></div></div>');
    return (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
      const L = ${JSON.stringify(COMPARED)}, R = ${JSON.stringify(FONT_RESET_LONGHANDS)};
      const a = document.getElementById('a'), c = document.getElementById('c');
      a.removeAttribute('style'); c.removeAttribute('style');
      a.style.setProperty(it.property, it.value);
      const parsed = a.getAttribute('style') !== null && a.getAttribute('style') !== '';
      for (const [l, v] of it.longhands) c.style.setProperty(l, v);
      const ca = getComputedStyle(a), cc = getComputedStyle(c);
      const diff = it.code !== null ? [] : L.filter((l) => ca.getPropertyValue(l) !== cc.getPropertyValue(l)).map((l) => l + ' Chrome "' + ca.getPropertyValue(l) + '" Dragon "' + cc.getPropertyValue(l) + '"');
      const reset = it.code !== null ? [] : Object.keys(R).filter((l) => ca.getPropertyValue(l) !== R[l]).map((l) => l + ' "' + ca.getPropertyValue(l) + '"');
      return { parsed, diff, reset };
    }))`)) as Seen[][];
  } finally {
    await browser.close();
  }
}

const judge = (items: readonly Item[], seen: readonly Seen[]): string[] => items.flatMap((it, i) => {
  const s = seen[i] as Seen;
  const at = `${it.property}: ${it.value}`;
  const out: string[] = [];
  if (it.code === null && !s.parsed) out.push(`${at}: accepted, Chrome drops it`);
  if (it.code === 'DRAGON_CSS_INVALID_VALUE' && s.parsed) out.push(`${at}: invalid, Chrome parses it`);
  out.push(...s.diff.map((d) => `${at}: ${d}`), ...s.reset.map((d) => `${at}: Chrome sets the unmodelled ${d}`));
  return out;
});

describe('the font and font-synthesis shorthands expand as Chrome 145 expands them', () => {
  it('the grammar table, invalid values and the reset of every longhand; the three plants are caught', async () => {
    const real: Item[] = [
      ...FONT.map((v) => ({ property: 'font', value: v, ...declare('font', v) })),
      ...SYNTHESIS.map((v) => ({ property: 'font-synthesis', value: v, ...declare('font-synthesis', v) })),
      ...SYNTHESIS_LONGHANDS.map(([p, v]) => ({ property: p, value: v, ...declare(p, v) })),
    ];
    const plantSets = SHORTHAND_FAULTS.map((fault) => {
      const handler = fontShorthand(withFault(fault) as FontFaults);
      return real.filter((it) => it.property === 'font' && it.code === null).map((it) => ({ ...it, longhands: planted(handler, it.value) }));
    });
    const [seen, ...plantSeen] = await chromeSeen([real, ...plantSets]);
    // Chrome's -webkit- system fonts are outside the webref grammar: Dragon calls them invalid, a refusal and never an acceptance.
    const GRAMMAR_GAPS = ['font: -webkit-small-control: invalid, Chrome parses it'];
    expect(judge(real, seen as Seen[]).filter((p) => !GRAMMAR_GAPS.includes(p))).toEqual([]);
    expect(judge(real, seen as Seen[]).filter((p) => GRAMMAR_GAPS.includes(p))).toEqual(GRAMMAR_GAPS);
    // The production handler and the unfaulted builder agree on every accepted value.
    for (const it of real.filter((x) => x.property === 'font' && x.code === null)) expect(planted(fontShorthand(NO_FONT_FAULTS), it.value), it.value).toEqual([...it.longhands]);
    expect(TEXT_SHORTHANDS.font.longhands).toEqual(['font-style', 'font-weight', 'font-size', 'line-height', 'font-family']);
    SHORTHAND_FAULTS.forEach((fault, i) => expect(judge(plantSets[i] as Item[], plantSeen[i] as Seen[]).length, fault).toBeGreaterThan(0));
    const refused = real.filter((it) => it.code !== null && it.code !== 'DRAGON_CSS_INVALID_VALUE').map((it) => `${it.code as string} ${it.property}: ${it.value}`);
    expect(refused).toEqual([
      'DRAGON_UNSUPPORTED_VALUE font: oblique 2turn 12px x', 'DRAGON_UNSUPPORTED_VALUE font: small-caps 12px x',
      'DRAGON_UNSUPPORTED_VALUE font: condensed 12px x', 'DRAGON_UNSUPPORTED_VALUE font: normal small-caps 12px x', 'DRAGON_UNSUPPORTED_VALUE font: ultra-expanded 12px x',
      'DRAGON_UNSUPPORTED_VALUE font: caption', 'DRAGON_UNSUPPORTED_VALUE font: menu', 'DRAGON_UNSUPPORTED_VALUE font: icon', 'DRAGON_UNSUPPORTED_VALUE font: message-box',
      'DRAGON_UNSUPPORTED_VALUE font: small-caption', 'DRAGON_UNSUPPORTED_VALUE font: status-bar',
    ]);
  }, 300_000);
});

describe('font-synthesis on native', () => {
  const compile = (css: string) => dragon.createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, web: {} } },
    { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr' },
  ).compile(htmlInput(css));
  it('Ahem bold or italic with synthesis off is drawn unsynthesized, so ios accepts it; with synthesis on it is refused', () => {
    const fonts = (css: string): string[] => compile(css).diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_FONT').map((d) => `${String(d.target)} ${d.message.split(';')[0]}`);
    expect(fonts('.a { font: bold 10px Ahem; }')).toEqual(["ios text d:text0 inherits font-weight: 700 from the author's style on <div> d"]);
    expect(fonts('.a { font: bold italic 10px Ahem; font-synthesis: none; }')).toEqual([]);
    expect(fonts('.a { font: italic 10px Ahem; font-synthesis: weight; }')).toEqual([]);
    expect(fonts('.a { font: bold 10px Ahem; font-synthesis-weight: none; }')).toEqual([]);
    expect(fonts('.a { font: bold 10px Ahem; font-synthesis: style; }')).toEqual([]);
    expect(fonts('.a { font: bold 10px Ahem; font-synthesis: weight; }')).toEqual(["ios text d:text0 inherits font-weight: 700 from the author's style on <div> d"]);
  });
});

describe('the font-shorthand group', () => {
  it('every capture of TXT-W1 (txt-w1-v2 53699e28b) is unchanged but for the keys added since', () => {
    const W1 = '53699e28b';
    // TDEC-a adds the decoration longhands after TXT-W2.
    const ADDED = ['font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', ...TEXT_DECORATION_LONGHANDS];
    const root = repoPath('.');
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', W1, '--', 'packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/expected-fonts'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter((p) => p.endsWith('.json'));
    expect(paths.length).toBeGreaterThan(1500);
    const blobs = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: paths.map((p) => `${W1}:${p}`).join('\n'), maxBuffer: 1 << 30 });
    const strip = (c: { nodes?: { computed: Record<string, string> | null }[] }): string => {
      for (const n of c.nodes ?? []) if (n.computed !== null) for (const k of ADDED) delete n.computed[k];
      return JSON.stringify(c);
    };
    let at = 0;
    const differ: string[] = [];
    for (const p of paths) {
      const nl = blobs.indexOf(10, at);
      const size = Number(blobs.subarray(at, nl).toString('utf8').split(' ')[2]);
      const before = JSON.parse(blobs.subarray(nl + 1, nl + 1 + size).toString('utf8')) as { nodes?: { computed: Record<string, string> | null }[] };
      at = nl + 1 + size + 1;
      const now = JSON.parse(readFileSync(repoPath(p), 'utf8')) as { nodes?: { computed: Record<string, string> | null }[] };
      if ((now.nodes ?? []).some((n) => n.computed !== null && ADDED.some((k) => n.computed?.[k] === undefined))) differ.push(`${p}: a node lacks an added key`);
      if (strip(now) !== strip(before)) differ.push(p);
    }
    expect(differ).toEqual([]);
  });

  it('follows text-weight and adds exactly its own layout cases', () => {
    expect(FIXTURE_GROUPS.map((g) => g.id).slice(-2)).toEqual(['font-shorthand', 'text-decoration']);
    const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));
    const added = FONT_SHORTHAND.filter((f) => f.kind === 'layout').flatMap((f) => [f.id, `${f.id}-rtl`]);
    expect(ids.slice(-added.length)).toEqual(added);
    expect(ids.length).toBe(514 + added.length);
  });
});

/** A one-element HTML document through the fixture reader, with the given stylesheet. */
function htmlInput(css: string): FrontEndResult {
  return fixtureToInput('font-shorthand-probe', `<!DOCTYPE html><html data-dragon-id="html"><head><style>body { margin: 0; font-family: Ahem; } ${css}</style></head><body data-dragon-id="body"><div data-dragon-id="d" class="a">XX</div></body></html>`);
}
