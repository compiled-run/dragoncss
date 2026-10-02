// TXT-W1 (T147 part 1, notes/T147J-txt-weight.md): font-weight and font-style as longhands, computed as Blink computes them
// (fonts/weight.ts), the html.css UA rows as specified values, and the refusals that stay. Chrome-backed checks are in
// packages/parity/test/text-weight.test.ts.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement, ResolvedValue } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import * as dark from '../src/ua/chrome-145.darwin-arm64.dark.generated.ts';
import * as light from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { darkDatasetFor, referenceDataset, TEXT_FONT_LONGHANDS, uaDatasetFor, UA_TEXT_FONT_RULES } from '../src/ua/datasets.ts';
import { UNSTYLED_TAGS } from '../src/analysis/elements.ts';
import { parseValueText } from '../src/analysis/computed.ts';
import { bolderWeight, computeFontStyle, computeTextFont, INITIAL_TEXT_FONT, lighterWeight, quarterUnits, serializeFontStyle, serializeFontWeight, synthesisOf } from '../src/fonts/weight.ts';
import { synthesisTraits } from '../src/fonts/metrics.ts';
import { fsv, selectionRequest } from '../src/fonts/selection.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SRC: SourceRef = { uri: 's.css', revision: 'r', hash: 'h' };

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Every element's computed font-weight and font-style after resolving the tree under body with the stylesheet. */
function computed(css: string, tree: (r: SourceRef) => TreeNode[]): { fonts: Map<string, string>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: DOC, scope: 'document' }, 0, diagnostics);
  const linked = (n: TreeNode): LinkedElement | null => n.kind !== 'element' ? null : {
    kind: 'element', address: n.id, instance: DOC, owner: DOC, tag: n.tag, attributes: new Map(), node: n,
    classes: n.classes.map((c) => ({ owner: DOC, sheet: 'sheet', name: (c.value[0] as { value: { name: string } }).value.name })),
    children: n.children.map(linked).filter((c): c is LinkedElement => c !== null),
  };
  const ORIGIN: Origin = { kind: 'unlocated', reason: 'test' };
  const body: LinkedElement = { kind: 'element', address: 'body', instance: DOC, owner: DOC, tag: 'body', classes: [], attributes: new Map(), children: tree(SRC).map(linked).filter((c): c is LinkedElement => c !== null), node: { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], children: [], origin: ORIGIN } };
  const root = resolveTree({ ...body, address: 'html', tag: 'html', children: [body] }, rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const fonts = new Map<string, string>();
  const walk = (e: ResolvedElement): void => {
    fonts.set(e.element.address, `${valueToString((e.props.get('font-weight') as ResolvedValue).value)} ${valueToString((e.props.get('font-style') as ResolvedValue).value)}`);
    for (const c of e.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return { fonts, diagnostics };
}

describe('the html.css text-font rows (datasets.ts UA_TEXT_FONT_RULES)', () => {
  for (const [scheme, ds, choice] of [['light', light, uaDatasetFor('darwin-arm64')], ['dark', dark, darkDatasetFor('darwin-arm64')]] as const) {
    it(`${scheme}: each specified value computes to the captured row under the medium root, and the dataset holds the specified rows`, () => {
      if (choice.kind !== 'ok') throw new Error(choice.reason);
      const captured: [string, { readonly [p: string]: string }][] = [...Object.entries(ds.userAgentTextFonts), ...Object.entries(ds.phrasingKeyTextFonts).filter(([t]) => UNSTYLED_TAGS.has(t))];
      let rows = 0;
      for (const [tag, row] of captured) {
        const rule = UA_TEXT_FONT_RULES[tag] ?? {};
        expect(Object.keys(rule).sort(), tag).toEqual(Object.keys(row).sort());
        expect((choice.dataset.userAgentTextFonts as { readonly [t: string]: unknown })[tag], tag).toEqual(rule);
        const font = computeTextFont({ weight: rule['font-weight'] === undefined ? null : parseValueText('font-weight', rule['font-weight']), style: rule['font-style'] === undefined ? null : parseValueText('font-style', rule['font-style']) }, INITIAL_TEXT_FONT);
        if (font === null) throw new Error(tag);
        if (row['font-weight'] !== undefined) expect(serializeFontWeight(font.weight), tag).toBe(row['font-weight']);
        if (row['font-style'] !== undefined) expect(serializeFontStyle(font.style), tag).toBe(row['font-style']);
        rows += Object.keys(row).length;
      }
      expect(rows).toBe(11);
      expect(TEXT_FONT_LONGHANDS).toEqual(['font-weight', 'font-style']);
    });
  }
});

describe('computed font-weight and font-style (fonts/weight.ts)', () => {
  it('bolder and lighter follow BolderWeight and LighterWeight at every band edge', () => {
    expect([1, 349.75, 350, 549.75, 550, 899.75, 900, 1000].map((w) => bolderWeight(w))).toEqual([400, 400, 700, 700, 900, 900, 900, 1000]);
    expect([1, 99.75, 100, 549.75, 550, 749.75, 750, 1000].map((w) => lighterWeight(w))).toEqual([1, 99.75, 100, 100, 400, 400, 700, 700]);
  });
  it('numbers clamp to [1, 1000] and truncate to quarter units; oblique angles truncate too, 0 is normal and 14 italic', () => {
    expect([100.1, 100.3, 999.9, 99.99, 400.24].map((w) => quarterUnits(w))).toEqual([100, 100.25, 999.75, 99.75, 400]);
    const style = (t: string): string => {
      const s = computeFontStyle(parseValueText('font-style', t).kind === 'keyword' ? parseValueText('font-style', t) : { kind: 'other', type: 'oblique-angle', text: t });
      return s === null ? 'null' : serializeFontStyle(s);
    };
    expect(['italic', 'oblique', 'oblique 14deg', 'oblique 0deg', 'oblique -0deg', 'oblique 10.1deg', 'oblique 13.999deg', 'oblique 0.2rad', 'oblique 10grad', 'oblique 0.25turn', 'oblique -20deg'].map(style))
      .toEqual(['italic', 'italic', 'italic', 'normal', 'normal', 'oblique 10deg', 'oblique 13.75deg', 'oblique 11.25deg', 'oblique 9deg', 'oblique 90deg', 'oblique -20deg']);
  });
  it('resolves html.css values against the parent: b in h1 is 900, b under 300 is 400, em in h3 is bold italic, an author value wins', () => {
    const css = 'body { font-family: Ahem; } .l { font-weight: 300; } .w { font-weight: 550.3; } .n { font-weight: normal; } .o { font-style: oblique 20deg; } .up { font-weight: bolder; } .in { font-weight: inherit; } .ini { font-weight: initial; }';
    const { fonts, diagnostics } = computed(css, (r) => [
      el(r, 'h1', 'h1', [], [el(r, 'h1b', 'b', [], [text(r, 't1', 'X')])]),
      el(r, 'l', 'div', ['l'], [el(r, 'lb', 'b', [], [text(r, 't2', 'X')]), el(r, 'lu', 'div', ['up'])]),
      el(r, 'h3', 'h3', [], [el(r, 'he', 'em', [], [el(r, 'hen', 'span', ['n'])])]),
      el(r, 'w', 'div', ['w'], [el(r, 'wi', 'div', ['in']), el(r, 'wn', 'strong', ['ini'])]),
      el(r, 'o', 'address', ['o'], [el(r, 'oi', 'i')]),
    ]);
    expect(diagnostics).toEqual([]);
    expect(Object.fromEntries(fonts)).toEqual({
      html: '400 normal', body: '400 normal',
      h1: '700 normal', h1b: '900 normal',
      l: '300 normal', lb: '400 normal', lu: '400 normal',
      h3: '700 normal', he: '700 italic', hen: '400 italic',
      w: '550.25 normal', wi: '550.25 normal', wn: '400 normal',
      o: '400 oblique 20deg', oi: '400 italic',
    });
  });
  it('parses as Chrome 145: left and right, and an oblique number beyond 90, are invalid; a calculated or converted angle beyond 90deg is refused', () => {
    const codes = (decl: string): string[] => computed(`.a { ${decl}; }`, () => []).diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(codes('font-style: left')).toEqual(['DRAGON_CSS_INVALID_VALUE: "left" is not a valid value for font-style: Chrome 145 does not parse font-style: left']);
    expect(codes('font-style: right')[0]).toMatch(/^DRAGON_CSS_INVALID_VALUE/);
    expect(codes('font-style: oblique 100grad')[0]).toMatch(/^DRAGON_CSS_INVALID_VALUE: .*number is in \[-90, 90\]/);
    expect(codes('font-style: oblique 1.6rad')[0]).toMatch(/^DRAGON_UNSUPPORTED_VALUE: font-style: the oblique angle 1.6rad is .*beyond 90deg/);
    expect(codes('font-style: oblique calc(10deg + 5deg)')[0]).toMatch(/^DRAGON_UNSUPPORTED_VALUE: font-style: the oblique angle calc/);
    for (const v of ['0', '0.5', '1001', '-5', 'bold bolder']) expect(codes(`font-weight: ${v}`)[0], v).toMatch(/^DRAGON_CSS_INVALID_VALUE/);
    for (const v of ['1', '1000', 'calc(0.1)', 'calc(2000)', 'bolder', 'lighter', 'BOLD', 'inherit']) expect(codes(`font-weight: ${v}`), v).toEqual([]);
    for (const v of ['italic', 'oblique', 'oblique -90deg', 'oblique 90deg', 'oblique 0.25turn', 'OBLIQUE 20DEG']) expect(codes(`font-style: ${v}`), v).toEqual([]);
  });
});

describe('synthesis (css_segmented_font_face.cc)', () => {
  const caps = (weight: number, slope: number) => ({ weight: { minimum: fsv(weight), maximum: fsv(weight) }, slope: { minimum: fsv(slope), maximum: fsv(slope) }, width: { minimum: fsv(100), maximum: fsv(100) } });
  it('bold at a request of 600 and up over a face below 600; oblique at slope 14 and up over a face below 14', () => {
    const at = (w: number, s: { kind: 'normal' } | { kind: 'italic' } | { kind: 'oblique'; degrees: number }, face: ReturnType<typeof caps>) => synthesisOf(face, selectionRequest(w, 100, s));
    expect(at(599.75, { kind: 'normal' }, caps(400, 0))).toBeNull();
    expect(at(600, { kind: 'normal' }, caps(400, 0))).toBe('synthetic bold');
    expect(at(900, { kind: 'normal' }, caps(700, 0))).toBeNull();
    expect(at(400, { kind: 'oblique', degrees: 13.75 }, caps(400, 0))).toBeNull();
    expect(at(400, { kind: 'italic' }, caps(400, 0))).toBe('synthetic oblique');
    expect(at(400, { kind: 'oblique', degrees: 20 }, caps(400, 14))).toBeNull();
  });
  it('reads the traits under which Chrome suppresses synthesis from usWeightClass, fsSelection, macStyle and post', () => {
    const font = (usWeightClass: number, fsSelection: number, macStyle: number, italicAngle = 0) =>
      ({ os2: { usWeightClass, fsSelection }, head: { macStyle }, post: { italicAngle } }) as unknown as Parameters<typeof synthesisTraits>[0];
    expect(synthesisTraits(font(400, 0, 0))).toEqual({ bold: false, italic: false });
    expect(synthesisTraits(font(600, 0, 0)).bold).toBe(true);
    expect(synthesisTraits(font(400, 0x20, 0)).bold).toBe(true);
    expect(synthesisTraits(font(400, 0, 1)).bold).toBe(true);
    expect(synthesisTraits(font(400, 1, 0)).italic).toBe(true);
    expect(synthesisTraits(font(400, 0, 2)).italic).toBe(true);
    expect(synthesisTraits(font(400, 0, 0, -12)).italic).toBe(true);
  });
});

describe('Ahem: one regular face', () => {
  const project = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
  const fonts = (css: string): string[] => project().compile(inputFor(`body { font-family: Ahem; } ${css}`, (r) => [el(r, 'd', 'div', ['a'], [text(r, 't', 'XX')])])).diagnostics.map((d) => `${d.code} ${String(d.target)} ${d.message.split(';')[0]}`);
  it('refuses on ios the weights and slopes Chrome synthesizes, naming the author value, and accepts the rest', () => {
    expect(fonts('.a { font-weight: 600; }')).toEqual(["DRAGON_UNSUPPORTED_FONT ios text d:text0 inherits font-weight: 600 from the author's style on <div> d"]);
    expect(fonts('.a { font-style: oblique 20deg; }')).toEqual(["DRAGON_UNSUPPORTED_FONT ios text d:text0 inherits font-style: oblique 20deg from the author's style on <div> d"]);
    for (const v of ['font-weight: 599.9', 'font-weight: 100', 'font-style: oblique 13deg', 'font-style: oblique -30deg', 'font-weight: lighter']) expect(fonts(`.a { ${v}; }`), v).toEqual([]);
  });
});
