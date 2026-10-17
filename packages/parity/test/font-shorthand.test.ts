// TXT-W2 (T147 part 2, notes/T147J-txt-weight.md) against the pinned Chrome: the font and font-synthesis shorthands expand as
// Chrome 145 expands them. Each value of the grammar table is set as written on one element and as Dragon's longhands on its
// sibling, under a parent with non-initial line-height, weight and font-synthesis; the computed values must agree, every longhand
// Dragon does not model must stay initial, and values Dragon calls invalid must be ones Chrome drops. The three plants are caught.
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import type { FrontEndResult } from 'dragon';
import * as dragon from 'dragon';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { FONT_RESET_LONGHANDS } from '../../dragon/src/css/properties/text.ts';
import { FONT_VARIANT_LONGHANDS } from '../../dragon/src/css/properties/font-variant.ts';
import { FONT_TUNING_LONGHANDS } from '../../dragon/src/css/properties/font-tuning.ts';
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
import { FONT_FEATURES_LONGHANDS } from '../../dragon/src/css/properties/font-features.ts';
import { FONT_STRETCH_LONGHANDS } from '../../dragon/src/css/properties/font-stretch.ts';
import { TEXT_FILL_STROKE_LONGHANDS } from '../../dragon/src/css/properties/text-fill-stroke.ts';
import { TEXT_SHADOW_LONGHANDS } from '../../dragon/src/css/properties/text-shadow.ts';
import { repoPath } from '../src/paths.ts';

const SOURCE = { uri: 'dragon-source://test/font.css', revision: 'r1', hash: 'sha256:0' };

type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };
const chrome = async (): Promise<Browser> => ((await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> }).launchChrome();

const FONT = ['12px x', 'italic bold 12px/30px Georgia, serif', 'bold italic 12px x', 'normal normal normal normal 12px x', 'normal normal normal normal normal 12px x',
  'oblique 20deg 12px x', 'oblique 12px x', 'oblique 14deg 600 12px x', 'oblique 91deg 12px x', 'oblique 2turn 12px x', '300 12px x', '1000 12px x', '0 12px x', 'bolder 12px x', 'lighter 12px x',
  '12px', 'x', '12px/normal x', '12px / 1.5 x', 'larger x', 'medium x', '2em x', '10% x', '12px/1.5em x', '12px/20% x', '12px "a b", c', '12px x y', '12px 100', 'italic italic 12px x',
  '400 bold 12px x', 'italic oblique 12px x', 'left 12px x', 'italic left 12px x', 'small-caps 12px x', 'condensed 12px x', 'normal small-caps 12px x', 'ultra-expanded 12px x', 'normal 100% 12px x',
  'caption', 'menu', 'icon', 'message-box', 'small-caption', 'status-bar', '-webkit-small-control', 'inherit', 'initial', 'unset', 'Italic BOLD 12PX X', '12px/30px sans-serif', '700 1.5em/2 monospace',
  'calc(600) 12px x', 'italic calc(600) 12px/1 x', 'oblique calc(20deg) 12px x', 'calc(600) x'];
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

const COMPARED = ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', 'font-stretch', ...FONT_VARIANT_LONGHANDS, ...FONT_TUNING_LONGHANDS, 'font-feature-settings', 'font-variation-settings', ...Object.keys(FONT_RESET_LONGHANDS)];

async function chromeSeen(sets: readonly (readonly Item[])[]): Promise<Seen[][]> {
  const browser = await chrome();
  try {
    const page = await browser.newPage();
    // The parent's line-height, weight, font-synthesis, font-stretch, font-variant, kerning, optical sizing, language override and
    // feature and variation settings are not initial, so a longhand Dragon fails to reset or inherit shows.
    await page.setContent('<!DOCTYPE html><div id="p" style="line-height:7px;font-weight:700;font-synthesis:none;font-size:20px;font-stretch:expanded;font-variant:no-common-ligatures tabular-nums jis04 historical-forms small-caps sub;font-kerning:none;font-optical-sizing:none;font-language-override:&quot;TRK&quot;;font-feature-settings:&quot;liga&quot; 0;font-variation-settings:&quot;wght&quot; 500"><div id="a"></div><div id="c"></div></div>');
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
  it('the grammar table, invalid values and the reset of every longhand; the plants are caught', async () => {
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
    expect(TEXT_SHORTHANDS.font.longhands).toEqual(['font-style', 'font-weight', 'font-size', 'line-height', 'font-family', 'font-stretch', ...FONT_VARIANT_LONGHANDS, ...FONT_TUNING_LONGHANDS, 'font-feature-settings', 'font-variation-settings']);
    SHORTHAND_FAULTS.forEach((fault, i) => expect(judge(plantSets[i] as Item[], plantSeen[i] as Seen[]).length, fault).toBeGreaterThan(0));
    const refused = real.filter((it) => it.code !== null && it.code !== 'DRAGON_CSS_INVALID_VALUE').map((it) => `${it.code as string} ${it.property}: ${it.value}`);
    expect(refused).toEqual([
      'DRAGON_UNSUPPORTED_VALUE font: oblique 2turn 12px x', 'DRAGON_UNSUPPORTED_VALUE font: small-caps 12px x',
      'DRAGON_UNSUPPORTED_VALUE font: normal small-caps 12px x',
      'DRAGON_UNSUPPORTED_VALUE font: caption', 'DRAGON_UNSUPPORTED_VALUE font: menu', 'DRAGON_UNSUPPORTED_VALUE font: icon', 'DRAGON_UNSUPPORTED_VALUE font: message-box',
      'DRAGON_UNSUPPORTED_VALUE font: small-caption', 'DRAGON_UNSUPPORTED_VALUE font: status-bar', 'DRAGON_UNSUPPORTED_VALUE font: oblique calc(20deg) 12px x',
    ]);
  }, 300_000);
});

describe('font-synthesis on native', () => {
  const compile = (css: string) => dragon.createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, web: {} } },
    { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr' },
  ).compile(htmlInput(css));
  it('Ahem bold or italic is drawn synthesized or unsynthesized as Chrome draws it, so ios accepts it; bold and italic synthesized together are refused', () => {
    const fonts = (css: string): string[] => compile(css).diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_FONT').map((d) => `${String(d.target)} ${d.message.split(';')[0]}`);
    // TXT-W: Ahem's synthetic bold (text-weight-bold-ahem) and oblique (text-style-ahem) are each drawn natively, so either with synthesis
    // on is accepted since then; Chrome strokes the sheared outline where both apply, which no fixture proves.
    expect(fonts('.a { font: bold 10px Ahem; }')).toEqual([]);
    expect(fonts('.a { font: italic 10px Ahem; }')).toEqual([]);
    expect(fonts('.a { font: bold italic 10px Ahem; }')).toEqual(["ios text d:text0 inherits font-weight: 700 from the author's style on <div> d, and font-style: italic from the author's style on <div> d"]);
    expect(fonts('.a { font: bold italic 10px Ahem; font-synthesis: none; }')).toEqual([]);
    expect(fonts('.a { font: italic 10px Ahem; font-synthesis: weight; }')).toEqual([]);
    expect(fonts('.a { font: bold 10px Ahem; font-synthesis-weight: none; }')).toEqual([]);
    expect(fonts('.a { font: bold 10px Ahem; font-synthesis: style; }')).toEqual([]);
    expect(fonts('.a { font: bold 10px Ahem; font-synthesis: weight; }')).toEqual([]);
  });
});

describe('the font-shorthand group', () => {
  // BASE is master af67457777 (#262, which landed TXT-W1). The pins are digests (PIN-DERIVE: CI checks out the head alone, so they
  // read no git history), each taken at BASE with git; a merge that moves BASE retakes them there and states why in its message.
  /** sha256 of "<path>\t<sha256 of the capture without the keys added since>" lines in path order, over every capture but TXT-W2's own. */
  // Retaken on master 285ce07960: #340 added an inherited-currentcolor shadow to the BASE fixture shadow-cascade (its 8 captures), the
  // only BASE capture that changed once the keys below are stripped and the later groups left out. Retaken again on the landing of #370,
  // which adds -webkit-opacity rows to the BASE fixture opacity-cascade (its 8 captures).
  const BASE_CAPTURES = { files: 3164, digest: 'ec8955ba043db575a4aa2c9c35f981ad79127ec588fcb962d95914ea80cb4899' };
  // TDEC-a adds the decoration longhands after TXT-W2; BASE has neither, so stripping both leaves BASE's digest.
  // The keys added since BASE: TXT-W2's font-synthesis longhands, TDEC-a's decoration longhands, TXT2's spacing, text-indent,
  // text-transform, text-overflow, overflow-wrap, word-break and line-clamp, INL's vertical-align, float and clear, user-select, resize
  // SVG-a's paint and touch-action; BASE has none of them, so stripping them leaves BASE's captures.
  const ADDED = ['font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', ...TEXT_DECORATION_LONGHANDS, 'letter-spacing', 'word-spacing', 'text-indent', 'text-transform', 'text-overflow', 'overflow-wrap', 'word-break', '-webkit-box-orient', '-webkit-line-clamp', 'vertical-align', 'float', 'clear', 'user-select', 'resize', 'fill', 'stroke', 'stroke-width', 'touch-action', ...FONT_VARIANT_LONGHANDS, ...FONT_TUNING_LONGHANDS, ...FONT_STRETCH_LONGHANDS, ...FONT_FEATURES_LONGHANDS, ...TEXT_SHADOW_LONGHANDS, ...TEXT_FILL_STROKE_LONGHANDS, 'fill-opacity', 'stroke-opacity', 'clip', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-path', 'filter', 'stroke-dasharray', 'stroke-dashoffset'];
  // The groups that landed after BASE and add files and layout cases only (each prefix matches no BASE case or capture).
  const LATER = /(^|\/)(grid-abspos|grid-baseline|atomic-inline-|legacy-box-inert|stacking-grid-items|vertical-align-inert|float-clear-inert|line-clamp-|outline-dashed|outline-3d|outline-web|overflow-grid|radius-replaced|radius-double|resize-values|user-select-none|sizing-keywords-|svg-|clip-rect-|filter-none|bg-position-|clip-path-|text-break-|text-decoration-|text-indent-|text-justify-|text-overflow-lines|text-overflow-fonts|text-overflow-blocks|text-spacing-|text-word-spacing-|text-transform-keywords|text-transform-text|visibility-outline|white-space-|text-font-variant-|text-font-tuning-|text-font-size-|text-font-stretch-|text-font-features-|text-weight-ahem|text-weight-bold-ahem|touch-action-values|radius-logical|grid-gap-units|ctx-proof-flex-gap-units|text-shadow-none|text-fill-stroke-|alias-background|shadow-webkit-alias|text-style-ahem|alias-font)/;
  it('every capture of BASE is unchanged but for the keys added since, which every node has', () => {
    const dirs = ['packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/expected-fonts'];
    const paths = dirs.flatMap((d) => (readdirSync(repoPath(d), { recursive: true, withFileTypes: true }) as Dirent[])
      .filter((f) => f.isFile()).map((f) => relative(repoPath('.'), join(f.parentPath, f.name)).split(sep).join('/')))
      .filter((p) => p.endsWith('.json') && !/(^|\/)font-shorthand-/.test(p) && !LATER.test(p)).sort();
    const lacking: string[] = [];
    const lines = paths.map((p) => {
      const c = JSON.parse(readFileSync(repoPath(p), 'utf8')) as { nodes?: { computed: Record<string, string> | null }[] };
      for (const n of c.nodes ?? []) {
        if (n.computed === null) continue;
        if (ADDED.some((k) => n.computed?.[k] === undefined)) lacking.push(p);
        for (const k of ADDED) delete n.computed[k];
      }
      return `${p}\t${createHash('sha256').update(JSON.stringify(c)).digest('hex')}\n`;
    });
    expect({ files: paths.length, digest: createHash('sha256').update(lines.join('')).digest('hex') }).toEqual(BASE_CAPTURES);
    expect([...new Set(lacking)]).toEqual([]);
  });

  it('adds exactly its own layout cases and keeps every BASE case in order', () => {
    const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));
    const added = FONT_SHORTHAND.filter((f) => f.kind === 'layout').flatMap((f) => [f.id, `${f.id}-rtl`]);
    // Groups after the per-feature split run in id order (fixtures.ts), so the font-shorthand group sits among them.
    expect(FIXTURE_GROUPS.some((g) => g.id === 'font-shorthand')).toBe(true);
    expect(ids.filter((id) => added.includes(id))).toEqual(added);
    const base = ids.filter((id) => !added.includes(id) && !LATER.test(id));
    // BASE's FIXTURES hold 778 layout cases.
    expect(base.length).toBe(778);
    expect(createHash('sha256').update(base.join('\n')).digest('hex')).toBe('42a7d7b6b83d9843d09b712fd88325a0d88f54ed82f0954fe5e79c54753da1dc');
  });
});

/** A one-element HTML document through the fixture reader, with the given stylesheet. */
function htmlInput(css: string): FrontEndResult {
  return fixtureToInput('font-shorthand-probe', `<!DOCTYPE html><html data-dragon-id="html"><head><style>body { margin: 0; font-family: Ahem; } ${css}</style></head><body data-dragon-id="body"><div data-dragon-id="d" class="a">XX</div></body></html>`);
}
