// OVFL-S0: scrollbar-width and scrollbar-gutter (css-scrollbars-1 §3, css-overflow-4 §3.2), registered after the background layers,
// not inherited, discrete. Every value compiles on every target under the overlay-scrollbar rule (no gutter on any target); on native
// scrollbar-width: none hides a scroll container's indicators (read back as dragonScroll.indicators false), and every other value keeps them.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS, profileNoteFor } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { BACKGROUND_LAYERS_LONGHANDS } from '../src/css/properties/background-layers.ts';
import { SCROLLBAR_LONGHANDS } from '../src/css/properties/scrollbar.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { valueToString } from '../src/analysis/resolve.ts';
import { SCROLL_EMITTER } from '../src/emit/paint/scroll.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/sb.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(property: string, value: string): { readonly codes: string[]; readonly values: string[] } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { codes: diagnostics.map((d) => d.code), values: (rules[0]?.declarations[0]?.longhands ?? []).map((l) => valueToString(l.value)) };
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

describe('scrollbar: registry and parse', () => {
  it('follows the background layers, not inherited, layout aspect only, discrete, initial auto', () => {
    expect([...SCROLLBAR_LONGHANDS]).toEqual(['scrollbar-width', 'scrollbar-gutter']);
    expect(LONGHANDS[LONGHANDS.indexOf('scrollbar-width') - 1]).toBe(BACKGROUND_LAYERS_LONGHANDS[BACKGROUND_LAYERS_LONGHANDS.length - 1]);
    for (const p of SCROLLBAR_LONGHANDS) {
      expect(INHERITED.has(p), p).toBe(false);
      expect(PROPERTY_ASPECTS[p], p).toEqual({ layout: true, paint: false });
      expect(ANIMATION_KINDS[p], p).toBe(DISCRETE);
      expect(grammar[p]?.initial, p).toBe('auto');
    }
  });

  it('scrollbar-width takes auto, thin and none in any case, and the CSS-wide keywords; the rest is invalid', () => {
    for (const [v, want] of [['auto', 'auto'], ['thin', 'thin'], ['none', 'none'], ['NONE', 'none'], ['Thin', 'thin'], ['inherit', 'inherit'], ['initial', 'initial'], ['unset', 'unset']] as const) expect(parse('scrollbar-width', v), v).toEqual({ codes: [], values: [want] });
    for (const v of ['thick', '0', '8px', 'thin none', 'auto auto', 'medium']) expect(parse('scrollbar-width', v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('scrollbar-gutter takes auto, stable, and stable with both-edges in either order, kept as stable both-edges; the rest is invalid', () => {
    for (const [v, want] of [['auto', 'auto'], ['stable', 'stable'], ['stable both-edges', 'stable both-edges'], ['both-edges stable', 'stable both-edges'], ['STABLE Both-Edges', 'stable both-edges'], ['inherit', 'inherit']] as const) expect(parse('scrollbar-gutter', v), v).toEqual({ codes: [], values: [want] });
    for (const v of ['both-edges', 'auto both-edges', 'stable stable', 'stable both-edges stable', 'always', '0', 'stable 1px']) expect(parse('scrollbar-gutter', v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('scrollbar: computed values', () => {
  for (const [css, p, a, b] of [
    ['.a { scrollbar-width: thin; } .b { scrollbar-width: inherit; }', 'scrollbar-width', 'thin', 'thin'],
    ['.a { scrollbar-width: none; }', 'scrollbar-width', 'none', 'auto'],
    ['.a { --w: none; scrollbar-width: var(--w); } .b { scrollbar-width: unset; }', 'scrollbar-width', 'none', 'auto'],
    ['.a { scrollbar-gutter: both-edges stable; } .b { scrollbar-gutter: inherit; }', 'scrollbar-gutter', 'stable both-edges', 'stable both-edges'],
    ['.a { scrollbar-gutter: stable; } .b { scrollbar-gutter: initial; }', 'scrollbar-gutter', 'stable', 'auto'],
  ] as const) {
    it(`${css} computes ${a} and ${b}`, () => {
      const c = compile(css);
      expect(errors(c)).toEqual([]);
      expect(explainOne(c, 'web', 'a', p).value).toBe(a);
      expect(explainOne(c, 'web', 'b', p).value).toBe(b);
    });
  }
});

describe('scrollbar on native', () => {
  const writesOf = (css: string, id: string) => {
    const p = nativePrograms(compile(css, NATIVE), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return (['uikit', 'android-views'] as const).map((b) => (p.programs[b].nodes.find((x) => x.id === id)?.writes ?? []).filter((w) => w.key.startsWith('dragonScroll')).map((w) => (w.kind === 'scroll-container' ? `${w.key} ${String(w.x)} ${String(w.y)}` : w.key)));
  };

  it('every value compiles on every target, on a scroll container or not', () => {
    for (const css of ['.a { scrollbar-width: none; }', '.a { scrollbar-width: thin; overflow: auto; }', '.a { scrollbar-gutter: stable both-edges; overflow-y: scroll; }', '.a { scrollbar-gutter: stable; scrollbar-width: none; overflow: hidden; }', 'html { scrollbar-width: none; scrollbar-gutter: stable; }']) {
      const c = compile(css, NATIVE);
      expectCatalogued(c.diagnostics);
      expect(errors(c), css).toEqual([]);
      expect(c.targets, css).toEqual({ web: 'checked', ios: 'checked', android: 'checked' });
    }
  });

  it('scrollbar-width: none on a scroll container adds a hidden-indicators write; thin, auto and a box that does not scroll add none', () => {
    const both = (ws: string[]) => [ws, ws];
    expect(writesOf('.a { overflow: auto; scrollbar-width: none; }', 'a')).toEqual(both(['dragonScroll.range true true', 'dragonScroll.indicators']));
    expect(writesOf('.a { overflow-x: hidden; overflow-y: scroll; scrollbar-width: thin; }', 'a')).toEqual(both(['dragonScroll.range false true']));
    expect(writesOf('.a { overflow: auto; } .b { overflow: auto; scrollbar-width: inherit; }', 'b')).toEqual(both(['dragonScroll.range true true']));
    expect(writesOf('.a { scrollbar-width: none; } .b { overflow: auto; scrollbar-width: inherit; }', 'b')).toEqual(both(['dragonScroll.range true true', 'dragonScroll.indicators']));
    expect(writesOf('.a { scrollbar-width: none; }', 'a')).toEqual(both([]));
  });

  it('the hidden-indicators write calls its own writer, applies false, and the readback reports it from the platform flags', () => {
    const range = { kind: 'scroll-container', x: true, y: false } as const;
    const hidden = { kind: 'scroll-indicators-hidden' } as const;
    for (const b of ['uikit', 'android-views'] as const) {
      expect(SCROLL_EMITTER.lines[b]('v', null as never, range as never)).toEqual(['  v.dragonEnableScroll(true, false)']);
      expect(SCROLL_EMITTER.lines[b]('v', null as never, hidden as never)).toEqual(['  v.dragonHideScrollIndicators()']);
      expect(SCROLL_EMITTER.applied(null as never, b, hidden as never, 2, null as never)).toBe(false);
    }
    expect(SCROLL_EMITTER.native.uikit.file).toContain('if !(sv.scrollsX && sv.showsHorizontalScrollIndicator) && !(sv.scrollsY && sv.showsVerticalScrollIndicator) { out.append(("dragonScroll.indicators", .bool(false))) }');
    expect(SCROLL_EMITTER.native['android-views'].file).toContain('if (!sv.indicators) out.add(Pair("dragonScroll.indicators", DumpJson.Bool(false)))');
  });

  it('web rows for values that reserve a classic gutter carry the overlay-scrollbar note; none and auto gutters do not', () => {
    for (const f of ['scrollbar-width:auto', 'scrollbar-width:thin', 'scrollbar-gutter:stable', 'scrollbar-gutter:stable both-edges']) expect(profileNoteFor('web', f), f).toBe('overlayScrollbars');
    for (const f of ['scrollbar-width:none', 'scrollbar-gutter:auto']) expect(profileNoteFor('web', f), f).toBe(null);
    expect(profileNoteFor('ios', 'scrollbar-width:thin')).toBe(null);
  });
});
