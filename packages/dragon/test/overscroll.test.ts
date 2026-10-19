// overscroll-behavior (css-overscroll-1 §2) and overflow-anchor (css-scroll-anchoring-1 §2): every value Chrome 145 parses compiles on
// every target. -inline and -block pair with -x and -y (css-logical-1 §4, horizontal-tb), so each declaration sets both of its pair.
// On native, none stops a scroll container's bounce on that axis (read back as dragonScroll.bounce); contain, auto and overflow-anchor need nothing, since a native
// scroll view neither chains a drag nor anchors. The Chrome case is scroll-overscroll-values (packages/parity/fixtures);
// packages/parity/test/overscroll-parse.test.ts pins the parse against Chrome 145.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { valueToString } from '../src/analysis/resolve.ts';
import { SCROLL_EMITTER } from '../src/emit/paint/scroll.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/os.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(property: string, value: string): { readonly codes: string[]; readonly longhands: string[] } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { codes: diagnostics.map((d) => d.code), longhands: (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`) };
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

describe('overscroll: grammar and parse', () => {
  it('has Chrome 145 keywords: auto, contain and none, with no chain; overflow-anchor auto or none', () => {
    expect(grammar['overscroll-behavior']?.syntax).toBe('[ auto | contain | none ]{1,2}');
    for (const p of ['overscroll-behavior-x', 'overscroll-behavior-y', 'overscroll-behavior-inline', 'overscroll-behavior-block']) expect(grammar[p]?.syntax, p).toBe('auto | contain | none');
    expect(grammar['overflow-anchor']?.syntax).toBe('auto | none');
  });

  it('the shorthand sets x then y, one value both, each with its logical pair', () => {
    expect(parse('overscroll-behavior', 'Contain NONE')).toEqual({ codes: [], longhands: ['overscroll-behavior-x: contain', 'overscroll-behavior-inline: contain', 'overscroll-behavior-y: none', 'overscroll-behavior-block: none'] });
    expect(parse('overscroll-behavior', 'none').longhands).toEqual(['overscroll-behavior-x: none', 'overscroll-behavior-inline: none', 'overscroll-behavior-y: none', 'overscroll-behavior-block: none']);
    expect(parse('overscroll-behavior-block', 'contain').longhands).toEqual(['overscroll-behavior-block: contain', 'overscroll-behavior-y: contain']);
    expect(parse('overscroll-behavior-x', 'none').longhands).toEqual(['overscroll-behavior-x: none', 'overscroll-behavior-inline: none']);
    expect(parse('overflow-anchor', 'NONE').longhands).toEqual(['overflow-anchor: none']);
  });

  it('drops what Chrome drops', () => {
    for (const [p, v] of [['overscroll-behavior', 'chain'], ['overscroll-behavior', 'auto auto auto'], ['overscroll-behavior-x', 'auto auto'], ['overscroll-behavior-y', 'chain'], ['overflow-anchor', 'contain'], ['overflow-anchor', 'auto none']] as const) {
      expect(parse(p, v).codes, `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
});

describe('overscroll: cascade', () => {
  for (const [css, p, a, b] of [
    // The later of a physical longhand and its logical pair wins for both, as in Chrome's logical property group.
    ['.a { overscroll-behavior-inline: contain; overscroll-behavior-x: none; }', 'overscroll-behavior-inline', 'none', 'auto'],
    ['.a { overscroll-behavior-x: none; overscroll-behavior-inline: contain; }', 'overscroll-behavior-x', 'contain', 'auto'],
    ['.a { overscroll-behavior: contain none; } .b { overscroll-behavior: inherit; }', 'overscroll-behavior-block', 'none', 'none'],
    ['.a { overflow-anchor: none; }', 'overflow-anchor', 'none', 'auto'],
  ] as const) {
    it(`${css} computes ${p} ${a} and ${b}`, () => {
      const c = compile(css);
      expect(errors(c)).toEqual([]);
      expect(explainOne(c, 'web', 'a', p).value).toBe(a);
      expect(explainOne(c, 'web', 'b', p).value).toBe(b);
    });
  }
});

describe('overscroll on native', () => {
  const bounce = (css: string, id = 'a') => {
    const p = nativePrograms(compile(css, NATIVE), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return (['uikit', 'android-views'] as const).map((b) => (p.programs[b].nodes.find((x) => x.id === id)?.writes ?? []).flatMap((w) => (w.kind === 'scroll-bounce' ? [[w.bounceX, w.bounceY]] : [])));
  };

  it('every value compiles on every target, on a scroll container or not', () => {
    for (const css of ['.a { overscroll-behavior: contain; }', '.a { overscroll-behavior: none; overflow: auto; }', '.a { overscroll-behavior-inline: none; overscroll-behavior-block: contain; overflow-y: scroll; }', '.a { overflow-anchor: none; overflow: hidden; }', 'html { overscroll-behavior: none; overflow-anchor: none; }']) {
      const c = compile(css, NATIVE);
      expectCatalogued(c.diagnostics);
      expect(errors(c), css).toEqual([]);
      expect(c.targets, css).toEqual({ web: 'checked', ios: 'checked', android: 'checked' });
    }
  });

  it('none on a scrolling axis adds a bounce write with that axis off; auto, contain and a non-scrolling axis add none', () => {
    const both = (v: boolean[][]) => [v, v];
    expect(bounce('.a { overflow: auto; overscroll-behavior: none; }')).toEqual(both([[false, false]]));
    expect(bounce('.a { overflow: auto; overscroll-behavior: contain none; }')).toEqual(both([[true, false]]));
    expect(bounce('.a { overflow: auto; overscroll-behavior-inline: none; }')).toEqual(both([[false, true]]));
    expect(bounce('.a { overflow-x: hidden; overflow-y: auto; overscroll-behavior-x: none; }')).toEqual(both([]));
    expect(bounce('.a { overflow: auto; overscroll-behavior: contain; overflow-anchor: none; }')).toEqual(both([]));
    expect(bounce('.a { overscroll-behavior: none; } .b { overflow: auto; }', 'b')).toEqual(both([]));
  });

  it('the bounce write calls its writer on both backends, applies [x, y], and the readback reports it from the flags', () => {
    const w = { kind: 'scroll-bounce', bounceX: true, bounceY: false } as const;
    for (const b of ['uikit', 'android-views'] as const) {
      expect(SCROLL_EMITTER.lines[b]('v', null as never, w as never)).toEqual(['  v.dragonSetScrollBounce(true, false)']);
      expect(SCROLL_EMITTER.applied(null as never, b, w as never, 2, null as never)).toEqual([true, false]);
    }
    expect(SCROLL_EMITTER.native.uikit.file).toContain('if (sv.scrollsX && !bx) || (sv.scrollsY && !by) { out.append(("dragonScroll.bounce", .array([.bool(bx), .bool(by)]))) }');
    expect(SCROLL_EMITTER.native.uikit.boxMembers).toContain('s.bouncesHorizontally = x');
    expect(SCROLL_EMITTER.native['android-views'].file).toContain('if ((sv.scrollsX && !sv.bounceX) || (sv.scrollsY && !sv.bounceY)) out.add(Pair("dragonScroll.bounce"');
  });
});
