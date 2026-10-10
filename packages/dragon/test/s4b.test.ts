import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LayoutBox, LayoutStyle } from '@dragon/layout';
import type { FrontEndResult } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { applyFix, CATALOGUE, compiledFeatures, createProjectWith, iosLayoutProjection, LONGHANDS, NO_FAULTS, PROPERTY_ASPECTS, PROPERTY_ROLE, textTopology, WEB_CSS_PATH } from '../src/internal.ts';
import { initialValue } from '../src/analysis/resolve.ts';
import { computed, userAgentLonghands } from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf, text } from './helpers.ts';
import { floorProblems } from './floor.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, rootFont: 'ua-default' } as const;
const project = (direction: 'ltr' | 'rtl' = 'ltr', profiles: 'enforce' | 'derive' = 'derive', faults = NO_FAULTS) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles, direction });

function boxes(input: FrontEndResult, direction: 'ltr' | 'rtl' = 'ltr'): Map<string, LayoutBox> {
  const c = project(direction).compile(input);
  const p = iosLayoutProjection(c, { ...ENV, direction }, []);
  if (p.kind !== 'ready') throw new Error(`${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
  const out = new Map<string, LayoutBox>();
  const walk = (b: LayoutBox): void => {
    out.set(b.id, b);
    for (const k of b.children) if (k.kind === 'box') walk(k);
  };
  walk(p.input.root);
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

describe('M2: the public entry explains the root direction truthfully', () => {
  it('public createProject (ltr) explains html direction with cascade environment and a built-in origin', () => {
    const c = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }).compile(inputFor(FONT, (r) => [div(r, 'a', [])]));
    expect(explainOne(c, 'ios', 'html', 'direction')).toMatchObject({ value: 'ltr', cascade: 'environment', origin: { kind: 'builtin', dataset: 'reference environment', entry: 'direction ltr' } });
    expect(explainOne(c, 'ios', 'a', 'direction')).toMatchObject({ value: 'ltr', cascade: 'inherited' });
  });
  it('M4: the planted fault ignoreEnvironmentDirection resolves the root ltr in the rtl environment', () => {
    const input = inputFor(FONT, (r) => [div(r, 'a', [])]);
    expect(explainOne(project('rtl').compile(input), 'ios', 'html', 'direction').value).toBe('rtl');
    expect(explainOne(project('rtl', 'derive', { ...NO_FAULTS, ignoreEnvironmentDirection: true }).compile(input), 'ios', 'html', 'direction').value).toBe('ltr');
  });
});

describe("rec1 colour_rows: the 'paint' role", () => {
  const paint = LONGHANDS.filter((p) => PROPERTY_ROLE[p] === 'paint');
  it('(i) paint holds exactly for the aspect-table longhands with a paint aspect and no layout aspect', () => {
    for (const p of LONGHANDS) expect(PROPERTY_ROLE[p] === 'paint', p).toBe(!PROPERTY_ASPECTS[p].layout && PROPERTY_ASPECTS[p].paint);
    // PIN-DERIVE: the seams floor keeps every longhand that had the paint role, in order; a new paint longhand needs no edit here.
    expect(floorProblems(new URL('./seams-floor.json', import.meta.url), 'role:paint', paint, true)).toEqual([]);
  });
  it('(ii) a paint longhand never reaches the layout input: two elements that differ only in it lower to identical styles', () => {
    // Two values of each paint longhand: two colours, or for the PNT2 and BG2 longhands two values of their own syntax.
    const pair: { readonly [p: string]: readonly [string, string] } = { 'object-fit': ['cover', 'contain'], 'object-position': ['10px 20px', 'left top'], transform: ['rotate(30deg)', 'translate(5px, 10%) scale(2)'], 'transform-origin': ['0 0', 'right bottom'], 'will-change': ['transform', 'opacity'],
      // BG2's layer longhands, each with two values of its own syntax that paint no image.
      'background-image': ['none', 'none, none'], 'background-position-x': ['0%', 'right 4px'], 'background-position-y': ['0%', '25%'], 'background-size': ['auto', 'cover'], 'background-repeat': ['repeat', 'no-repeat'], 'background-attachment': ['scroll', 'scroll, scroll'], 'background-origin': ['padding-box', 'content-box'], 'background-clip': ['border-box', 'padding-box'],
      // T150a: visibility's two keywords that paint nothing.
      visibility: ['hidden', 'collapse'] };
    for (const p of paint) {
      const [va, vb] = pair[p] ?? (p.endsWith('-radius') ? ['4px', '30% 2px'] : ['#102030', 'rgba(200, 100, 50, 0.5)']);
      const input = inputFor(`${FONT} .x { width: 30px; border: 2px solid; position: relative; } .a { ${p}: ${va}; } .b { ${p}: ${vb}; }`, (r) => [div(r, 'a', ['x', 'a'], [text(r, 'at', 'XX XX')]), div(r, 'b', ['x', 'b'], [text(r, 'bt', 'XX XX')])]);
      const m = boxes(input);
      const [a, b] = [m.get('a') as LayoutBox, m.get('b') as LayoutBox];
      expect(a.style, p).toEqual(b.style);
      expect(JSON.stringify(a.children).replaceAll('a:text0', 'b:text0'), p).toBe(JSON.stringify(b.children));
    }
  });
  it('(iii) colour conversion stays in css/color.ts', () => {
    for (const f of files(src)) {
      if (f.endsWith(join('css', 'color.ts'))) continue;
      // The font metrics port Blink's float32 arithmetic (Math.fround, floorf), so src/fonts/** is exempt by path.
      if (f.includes(`${join('src', 'fonts')}${sep}`)) continue;
      // The forms port Blink's Decimal and geometry math (LayoutUnit truncation), so src/forms/** is exempt by path.
      if (f.includes(`${join('src', 'forms')}${sep}`)) continue;
      // MQ-R0: media/viewport.ts reproduces Chrome's measured media size (float32 size, device px, int orientation and aspect-ratio read); only that file.
      if (f.endsWith(join('src', 'media', 'viewport.ts'))) continue;
      // CASC 2: css/chrome-number.ts writes registered @property numbers as Chrome 145 serialises them (six significant digits, %g; probed in casc-property); only that file.
      if (f.endsWith(join('src', 'css', 'chrome-number.ts'))) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.(round|floor|ceil|trunc|fround)|toFixed|toPrecision/);
    }
  });
  it('paint rows are keyed @paint/<element direction>, never by formatting context', () => {
    const input = inputFor(`${FONT} .f { display: flex; } .a { color: hsl(120 50% 50%); background-color: transparent; } .r { direction: rtl; border-top-color: #abc; }`, (r) => [div(r, 'f', ['f'], [div(r, 'a', ['a']), div(r, 'r', ['r'])])]);
    const keys = compiledFeatures(project().compile(input), 'ios', []);
    expect(keys).toContain('color:<hsl()>@paint/ltr');
    expect(keys).toContain('background-color:transparent@paint/ltr');
    expect(keys).toContain('border-top-color:<hex-color>@paint/rtl');
    expect(keys.filter((k) => /^(color|background-color|border-\w+-color):/.test(k) && !/@paint\/(ltr|rtl)$/.test(k))).toEqual([]);
  });
});

describe('positioning in the compiler', () => {
  it('lowers position and the four insets explicitly (px, percentage, auto)', () => {
    const input = inputFor(`${FONT} .p { position: relative; left: 10px; bottom: -5%; } .a { position: absolute; top: 0; right: 12.5%; }`, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])]);
    const m = boxes(input);
    const pick = (s: LayoutStyle) => [s.position, s.top, s.right, s.bottom, s.left];
    expect(pick((m.get('p') as LayoutBox).style)).toEqual(['relative', { kind: 'auto' }, { kind: 'auto' }, { kind: 'percent', value: -5 }, { kind: 'px', value: 10 }]);
    expect(pick((m.get('a') as LayoutBox).style)).toEqual(['absolute', { kind: 'px', value: 0 }, { kind: 'percent', value: 12.5 }, { kind: 'auto' }, { kind: 'auto' }]);
    expect(pick((m.get('html') as LayoutBox).style)).toEqual(['static', { kind: 'auto' }, { kind: 'auto' }, { kind: 'auto' }, { kind: 'auto' }]);
  });
  it('item contexts carry the positioning scheme, the parent context and every direction the algorithm reads', () => {
    const input = inputFor(`${FONT} .cb { position: relative; direction: rtl; } .f { display: flex; direction: ltr; } .r { position: relative; top: 1px; } .a { position: absolute; top: 2px; width: 5px; } .t { width: 30px; }`, (r) => [
      div(r, 'cb', ['cb'], [div(r, 'f', ['f'], [div(r, 'r', ['r']), div(r, 'a', ['a'], [text(r, 'x', 'XX XX')])])]),
      div(r, 'b', ['a']),
    ]);
    const c = project().compile(input);
    const keys = compiledFeatures(c, 'ios', []);
    expect(keys).toContain('position:relative@relative-in-block/ltr');
    expect(keys).toContain('display:flex@block/rtl');
    expect(keys).toContain('top:<length-px>@relative-in-flex-row/ltr');
    expect(keys).toContain('position:absolute@absolute-in-flex-row/ltr/cb-rtl');
    expect(keys).toContain('width:<length-px>@absolute-in-flex-row/ltr/cb-rtl');
    expect(keys).toContain('position:absolute@absolute-in-block/ltr/cb-ltr');
    // Text in an absolutely positioned child of a flex container is in a block, not in a flex item (css-flexbox-1 §4.1).
    expect(textTopology(c, [])?.find((t) => t.address === 'a:text0')?.context).toBe('text-in-block/ltr');
  });
  it('an absolutely positioned element beside text, and an absolutely positioned root, are DRAGON_UNSUPPORTED_VALUE on every target at the position value', () => {
    for (const [css, body] of [
      [`${FONT} .p { position: relative; } .a { position: absolute; }`, (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'p', ['p'], [text(r, 't', 'XX'), div(r, 'a', ['a'])])]],
      [`${FONT} html { position: absolute; }`, (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', [])]],
    ] as const) {
      const input = inputFor(css, body);
      const c = project('ltr', 'derive').compile(input);
      const hits = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(hits.map((d) => d.target).sort(), css).toEqual(['ios', 'web']);
      for (const d of hits) expect(spanTextOf(input, d)).toBe('absolute');
      expect([c.outputs.ios.kind, c.outputs.web.kind], css).toEqual(['blocked', 'blocked']);
      expectCatalogued(c.diagnostics);
    }
    // The same box beside elements only is laid out.
    expect(project('ltr', 'derive').compile(inputFor(`${FONT} .p { position: relative; } .a { position: absolute; }`, (r) => [div(r, 'p', ['p'], [div(r, 'k', [], [text(r, 't', 'XX')]), div(r, 'a', ['a'])])])).diagnostics).toEqual([]);
  });
  it('position: fixed and sticky have no profile row: DRAGON_UNSUPPORTED_VALUE on ios and web; the lowering has no mapping for them', () => {
    for (const v of ['fixed', 'sticky']) {
      const input = inputFor(`${FONT} .a { position: ${v}; top: 1px; }`, (r) => [div(r, 'a', ['a'])]);
      const c = project('ltr', 'enforce').compile(input);
      const hits = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(hits.map((d) => [d.target, spanTextOf(input, d)]).sort(), v).toEqual([['ios', v], ['web', v]]);
      expect(project('ltr', 'derive').compile(input).diagnostics.map((d) => d.code), v).toEqual(['DRAGON_LOWERING_FAILED']);
    }
  });
});

describe('the web emitter and the inset longhands', () => {
  it('no Chrome UA rule sets an inset on a supported tag, and their initial value is auto', () => {
    for (const tag of ['html', 'body', 'div', 'dragon-unstyled'] as const) {
      for (const p of ['top', 'right', 'bottom', 'left']) {
        expect(userAgentLonghands[tag], `${tag} ${p}`).not.toContain(p);
        expect(computed[tag][p], `${tag} ${p}`).toBe('auto');
        expect(initialValue(p as (typeof LONGHANDS)[number], referenceDataset())).toEqual({ kind: 'keyword', value: 'auto' });
      }
    }
  });
  it('writes the four insets only on elements where one of them is not auto', () => {
    const c = project().compile(inputFor(`${FONT} .a { position: relative; top: 3px; } .b { position: absolute; }`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]));
    const out = c.outputs.web;
    if (out.kind !== 'ready') throw new Error(out.kind);
    const rules = ((out.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text).split('\n}').filter((r) => r.includes('{'));
    const withInsets = rules.filter((r) => /\n {2}top: /.test(r));
    expect(withInsets.length).toBe(1);
    expect(withInsets[0]).toMatch(/top: 3px;\n {2}right: auto;\n {2}bottom: auto;\n {2}left: auto;/);
    expect(rules.filter((r) => /position: absolute/.test(r))[0]).not.toMatch(/\n {2}top: /);
  });
});

describe('rec4: the unsupported at-rule fix is manual and never deletes the enclosed rules', () => {
  it('DRAGON_UNSUPPORTED_AT_RULE carries a manual fix; applyFix changes no text', () => {
    expect(CATALOGUE.DRAGON_UNSUPPORTED_AT_RULE.fix.kind).toBe('manual');
    // A width @media is native too since MQ-R1, so the at-rule here is one every target refuses.
    const css = `${FONT} @container (min-width: 1px) { .a { width: 80px; } }`;
    const input = inputFor(css, (r) => [div(r, 'a', ['a'])]);
    const d = project().compile(input).diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_AT_RULE');
    if (d === undefined || d.fix === null) throw new Error('no at-rule diagnostic');
    expect('edits' in d.fix).toBe(false);
    const r = applyFix(d.fix, input.snapshot.sources);
    expect(r.kind).toBe('manual');
    if (r.kind === 'manual') expect(r.instruction).toMatch(/Move the declarations/);
    expect(input.snapshot.sources[0]?.text).toContain('.a { width: 80px; }');
  });
});
