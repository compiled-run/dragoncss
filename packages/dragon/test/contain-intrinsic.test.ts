// CONTAIN-IS (css-sizing-4 §5.2): contain-intrinsic-width, -height and contain-intrinsic-size parse none, non-negative lengths and
// auto with a fallback; on a size-contained box a px value (an em computes to px) lowers to LayoutStyle containIntrinsicWidth and
// containIntrinsicHeight, and auto is refused, since it takes a remembered size Dragon does not track; where no size containment
// applies in that axis the value is accepted and changes nothing. The Chrome cases are contain-intrinsic-ahem and the
// reject-contain-intrinsic-* cases of fixture-groups/contain-intrinsic.ts; the parse is pinned in
// packages/parity/test/contain-intrinsic-parse.test.ts.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { DraftTree, ElementNode, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, eq, inputFor, not, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/contain-intrinsic.css', revision: 'r1', hash: 'sha256:0' };

function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${l.value.kind === 'other' && l.value.type === 'non-initial-value' ? '?' : ''}${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const body = (r: SourceRef): TreeNode[] => [el(r, 'a', 'div', ['a'], [text(r, 't', 'XX')])];
const compile = (css: string, faults: CompilerFaults = NO_FAULTS) => project(faults).compile(inputFor(`${FONT} ${css}`, body));
type Compiled = ReturnType<typeof compile>;
const errors = (c: Compiled): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.message}`);

function lowered(c: Compiled): readonly unknown[] {
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const s = ((p.input.root.children[0] as LayoutBox).children[0] as LayoutBox).style;
  return [s.containSize, s.containIntrinsicWidth, s.containIntrinsicHeight];
}

const px = (value: number) => ({ kind: 'px', value });
const NONE = { kind: 'none' };

describe('contain-intrinsic-size: parsing', () => {
  it('reads none, a non-negative length and auto with none or a length, one value for both axes or width then height', () => {
    expect(parsed('contain-intrinsic-size: 10px')).toEqual(['contain-intrinsic-width: 10px', 'contain-intrinsic-height: 10px']);
    expect(parsed('contain-intrinsic-size: 10PX 0')).toEqual(['contain-intrinsic-width: 10px', 'contain-intrinsic-height: 0px']);
    expect(parsed('contain-intrinsic-size: auto 10px none')).toEqual(['contain-intrinsic-width: auto 10px', 'contain-intrinsic-height: none']);
    expect(parsed('contain-intrinsic-size: none AUTO 2em')).toEqual(['contain-intrinsic-width: none', 'contain-intrinsic-height: auto 2em']);
    expect(parsed('contain-intrinsic-width: auto none')).toEqual(['contain-intrinsic-width: auto none']);
    expect(parsed('contain-intrinsic-height: 1.5em')).toEqual(['contain-intrinsic-height: 1.5em']);
  });

  it('keeps every spelling it does not read as written, for the check to refuse', () => {
    for (const v of ['auto', '-1px', '10%', '5', 'auto auto', '10px auto', '1px 2px 3px', 'calc(1px + 1px)', 'auto 10%']) {
      expect(parsed(`contain-intrinsic-size: ${v}`).every((x) => x.includes(': ?')), v).toBe(true);
    }
  });
});

describe('contain-intrinsic-size: layout', () => {
  it('lowers px and em on size containment, the width alone on inline-size containment and container-type: inline-size', () => {
    expect(lowered(compile('.a { contain: strict; contain-intrinsic-size: 40px 30px; }'))).toEqual(['size', px(40), px(30)]);
    expect(lowered(compile('.a { contain: size layout; contain-intrinsic-width: 3em; contain-intrinsic-height: 2.5em; font-size: 12px; }'))).toEqual(['size', px(36), px(30)]);
    expect(lowered(compile('.a { contain: inline-size layout; contain-intrinsic-size: 70px 33px; }'))).toEqual(['inline-size', px(70), px(33)]);
    expect(lowered(compile('.a { container-type: inline-size; contain-intrinsic-width: 64px; contain-intrinsic-height: auto 9px; }'))).toEqual(['inline-size', px(64), px(9)]);
    expect(lowered(compile('.a { contain: strict; contain-intrinsic-size: none; }'))).toEqual(['size', NONE, NONE]);
    for (const c of [compile('.a { contain: strict; contain-intrinsic-size: 40px 30px; }'), compile('.a { contain: inline-size layout; contain-intrinsic-size: 70px 33px; }')]) expect(errors(c)).toEqual([]);
  });

  it('accepts any value it reads where no size containment applies in its axis, which changes nothing', () => {
    for (const d of ['contain-intrinsic-size: 100px 50px', 'contain-intrinsic-size: auto 500px', 'contain-intrinsic-size: auto none 2em', 'contain: inline-size layout; contain-intrinsic-height: auto 77px', 'contain: layout paint; contain-intrinsic-size: auto 1px', 'display: inline; contain: strict; contain-intrinsic-size: auto 5px']) {
      expect(errors(compile(`.a { ${d}; }`)), d).toEqual([]);
    }
    expect(lowered(compile('.a { contain-intrinsic-size: 100px 50px; }'))).toEqual(['none', px(100), px(50)]);
  });

  it('refuses on every target auto where size containment applies, and a value it does not read anywhere', () => {
    const at = (d: string): string[] => errors(compile(`.a { ${d}; }`)).map((m) => m.replace(/: [^:]* on <div> a is unsupported: .*/, ''));
    expect(at('contain: strict; contain-intrinsic-size: auto 40px')).toHaveLength(6);
    expect(errors(compile('.a { contain: strict; contain-intrinsic-width: auto none; }'))).toEqual(['android', 'ios', 'web'].map((t) => `${t} contain-intrinsic-width: auto none on <div> a is unsupported: auto takes the box's last remembered size once it has been laid out without size containment, which Dragon does not track`));
    expect(at('container-type: inline-size; contain-intrinsic-width: auto 5px')).toHaveLength(3);
    for (const d of ['contain-intrinsic-width: 10%', 'contain-intrinsic-height: calc(1px + 1px)', 'contain-intrinsic-width: auto']) expect(at(d), d).toHaveLength(3);
    // The flow-relative longhands stay at their initial values (analysis/scroll-containment.ts).
    expect(errors(compile('.a { contain: strict; contain-intrinsic-inline-size: 30px; }'))[0]).toContain('contain-intrinsic-inline-size: 30px on <div> a is unsupported');
  });

  it('refuses auto on a box that a reachable state size-contains, though it is not contained at first', () => {
    const input = (css: string): FrontEndResult => {
      const base = inputFor(`${FONT} ${css}`, (r) => {
        const d = el(r, 'a', 'div', ['a'], [text(r, 't', 'XX')]);
        const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: d.origin };
        return [{ ...d, classes: [...d.classes, on] }];
      });
      const tree = base.tree as DraftTree;
      const root = tree.components[0] as DraftTree['components'][number];
      return { ...base, tree: { ...tree, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } };
    };
    const run = (css: string) => project(NO_FAULTS).compile(input(css)).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(run('.a { contain-intrinsic-size: auto 40px; } .a.on { contain: strict; }').length).toBeGreaterThan(0);
    expect(run('.a { contain-intrinsic-size: 40px; } .a.on { contain: strict; }')).toEqual([]);
  });

  it('the planted faults: intrinsicSizeDropped lowers none, intrinsicAutoAccepted lets auto through', () => {
    expect(lowered(compile('.a { contain: strict; contain-intrinsic-size: 40px 30px; }', { ...NO_FAULTS, intrinsicSizeDropped: true }))).toEqual(['size', NONE, NONE]);
    expect(errors(compile('.a { contain: strict; contain-intrinsic-size: auto 40px; }', { ...NO_FAULTS, intrinsicAutoAccepted: true }))).toEqual([]);
  });
});
