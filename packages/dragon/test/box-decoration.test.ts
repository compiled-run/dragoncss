// css-break-4 §5.4: box-decoration-break is accepted at slice alone, on every target, and -webkit-box-decoration-break resolves to it
// as an alias; clone is kept as Chrome keeps it and refused, since no target lays out or draws cloned fragments. The Chrome cases are
// box-decoration-initial and reject-box-decoration-clone (packages/parity/fixtures); packages/parity/test/box-decoration-parse.test.ts
// pins the parse and the cascade between the two names.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { resolveAlias } from '../src/css/aliases.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS, PROPERTY_ROLE } from '../src/css/properties.ts';
import { BOX_DECORATION_LONGHANDS, isInitialBoxDecoration } from '../src/css/properties/box-decoration.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, explainOne, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/box-decoration.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, `dropped` when Chrome would drop it, or its diagnostics. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.some((d) => d.code === 'DRAGON_CSS_INVALID_VALUE')) return ['dropped'];
  if (diagnostics.length > 0) return diagnostics.map((d) => `${d.code} ${d.message}`);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** A block .s holding a wrapping inline box .c (span b) with Ahem text, and the CSS around them. */
function compile(decl: string, faults: CompilerFaults = NO_FAULTS, child = '', extra = '') {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { width: 30px; ${decl}; } .c { ${child} } ${extra}`;
  return project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'span', ['c'], [text(r, 't', 'XX XX XX')])])]));
}

/** Each error as `<target> <code>`. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS, child = '', extra = ''): string[] {
  return compile(decl, faults, child, extra).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

/** The computed box-decoration-break of element a and its child b, on every target. */
function valuesAt(decl: string, child = '', extra = ''): string[] {
  const c = compile(decl, NO_FAULTS, child, extra);
  return (['web', 'ios', 'android'] as const).flatMap((t) => ['a', 'b'].map((n) => `${t} ${n} ${explainOne(c, t, n, 'box-decoration-break').value}`));
}

const everywhere = (a: string, b: string): string[] => (['web', 'ios', 'android'] as const).flatMap((t) => [`${t} a ${a}`, `${t} b ${b}`]);

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('box-decoration-break', () => {
  it('follows isolation in the registry, is a paint longhand that is not inherited, and animates discretely', () => {
    expect([...BOX_DECORATION_LONGHANDS]).toEqual(['box-decoration-break']);
    expect(LONGHANDS[LONGHANDS.indexOf('box-decoration-break') - 1]).toBe('isolation');
    expect(PROPERTY_ROLE['box-decoration-break']).toBe('paint');
    expect(INHERITED.has('box-decoration-break')).toBe(false);
    expect(ANIMATION_KINDS['box-decoration-break']).toBe(DISCRETE);
    expect(resolveAlias('-webkit-box-decoration-break')).toBe('box-decoration-break');
    expect(isInitialBoxDecoration({ kind: 'keyword', value: 'slice' })).toBe(true);
    expect(isInitialBoxDecoration({ kind: 'keyword', value: 'clone' })).toBe(false);
    expect(isInitialBoxDecoration({ kind: 'keyword', value: 'inherit' })).toBe(false);
    expect(isInitialBoxDecoration({ kind: 'other', type: 'list', text: 'slice' })).toBe(false);
  });

  it('parses Chrome 145\'s two keywords in any case, through the -webkit- name, and drops every other value', () => {
    expect(parsed('box-decoration-break: SLICE')).toEqual(['box-decoration-break: slice']);
    expect(parsed('box-decoration-break: clone')).toEqual(['box-decoration-break: clone']);
    expect(parsed('-webkit-box-decoration-break: Slice')).toEqual(['box-decoration-break: slice']);
    expect(parsed('-WEBKIT-BOX-DECORATION-BREAK: clone')).toEqual(['box-decoration-break: clone']);
    for (const d of ['box-decoration-break: none', 'box-decoration-break: slice clone', 'box-decoration-break: auto', 'box-decoration-break: 0', '-webkit-box-decoration-break: normal']) {
      expect(parsed(d), d).toEqual(['dropped']);
    }
  });

  it('accepts slice on every target, from either name, through the CSS-wide keywords, var() and inherit', () => {
    expect(errorsAt('box-decoration-break: slice')).toEqual([]);
    expect(errorsAt('-webkit-box-decoration-break: slice')).toEqual([]);
    expect(errorsAt('box-decoration-break: initial', NO_FAULTS, 'box-decoration-break: unset')).toEqual([]);
    expect(errorsAt('box-decoration-break: revert', NO_FAULTS, '-webkit-box-decoration-break: revert-layer')).toEqual([]);
    expect(errorsAt('box-decoration-break: slice', NO_FAULTS, 'box-decoration-break: inherit')).toEqual([]);
    expect(errorsAt('--b: slice; box-decoration-break: var(--b)')).toEqual([]);
    expect(errorsAt('box-decoration-break: var(--missing, slice)')).toEqual([]);
    expect(valuesAt('box-decoration-break: slice', 'box-decoration-break: inherit')).toEqual(everywhere('slice', 'slice'));
    expect(valuesAt('--b: SLICE; -webkit-box-decoration-break: var(--b)')).toEqual(everywhere('slice', 'slice'));
  });

  it('resolves the cascade between the two names as Chrome does: the later declaration wins, and !important wins over it', () => {
    // A losing clone is never applied; the profiles refuse it as declared (packages/parity fixtures declare none).
    expect(valuesAt('box-decoration-break: clone; -webkit-box-decoration-break: slice')).toEqual(everywhere('slice', 'slice'));
    expect(errorsAt('box-decoration-break: clone; -webkit-box-decoration-break: slice')).toEqual([]);
    expect(valuesAt('-webkit-box-decoration-break: clone; box-decoration-break: slice')).toEqual(everywhere('slice', 'slice'));
    expect(valuesAt('box-decoration-break: slice !important; -webkit-box-decoration-break: clone')).toEqual(everywhere('slice', 'slice'));
    expect(errorsAt('box-decoration-break: slice !important; -webkit-box-decoration-break: clone')).toEqual([]);
    // A later rule that sets clone without !important loses to the earlier important slice.
    expect(valuesAt('-webkit-box-decoration-break: slice !important', '', '.s { box-decoration-break: clone; }')).toEqual(everywhere('slice', 'slice'));
    // A clone that wins is refused, whichever name sets it.
    expect(errorsAt('-webkit-box-decoration-break: slice; box-decoration-break: clone')).toEqual(REFUSED);
    expect(errorsAt('box-decoration-break: slice; -webkit-box-decoration-break: clone')).toEqual(REFUSED);
    expect(errorsAt('box-decoration-break: slice; -webkit-box-decoration-break: clone !important')).toEqual(REFUSED);
  });

  it('refuses clone on every target, once per element, through var() and inherit too', () => {
    expect(errorsAt('box-decoration-break: clone')).toEqual(REFUSED);
    expect(errorsAt('-webkit-box-decoration-break: clone')).toEqual(REFUSED);
    expect(errorsAt('box-decoration-break: slice', NO_FAULTS, 'box-decoration-break: clone')).toEqual(REFUSED);
    expect(errorsAt('--b: clone; box-decoration-break: var(--b)')).toEqual(REFUSED);
    expect(errorsAt('box-decoration-break: var(--missing, clone)')).toEqual(REFUSED);
    // display: none does not lift the refusal, as for the 3D transform longhands.
    expect(errorsAt('box-decoration-break: clone; display: none')).toEqual(REFUSED);
    const c = compile('box-decoration-break: clone', NO_FAULTS, 'box-decoration-break: inherit');
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['box-decoration-break: clone on <div> a', 'box-decoration-break: clone on <div> a', 'box-decoration-break: clone on <div> a', 'box-decoration-break: clone on <span> b', 'box-decoration-break: clone on <span> b', 'box-decoration-break: clone on <span> b']);
    for (const d of c.diagnostics.filter((x) => x.severity === 'error')) expect(d.message).toMatch(/is unsupported: .*only slice is accepted$/);
  });

  it('refuses clone in a :hover state rule as well as the selector native refuses', () => {
    const selector = errorsAt('', NO_FAULTS, '', '.s:hover { color: red; }');
    expect(selector.length).toBeGreaterThan(0);
    expect(errorsAt('', NO_FAULTS, '', '.s:hover { box-decoration-break: slice; }')).toEqual(selector);
    expect(errorsAt('', NO_FAULTS, '', '.s:hover { -webkit-box-decoration-break: clone; }')).toEqual([...REFUSED, ...selector].sort());
  });

  it('is refused in @keyframes, where Dragon has no discrete animation writer', () => {
    for (const v of ['box-decoration-break: slice', 'box-decoration-break: clone', '-webkit-box-decoration-break: slice']) {
      expect(errorsAt('animation: k 1s', NO_FAULTS, `} @keyframes k { to { ${v}; } } .x {`), v).toEqual(['null DRAGON_UNSUPPORTED_VALUE']);
    }
  });

  it('plant boxDecorationAccepted: clone compiles', () => {
    expect(errorsAt('box-decoration-break: clone', { ...NO_FAULTS, boxDecorationAccepted: true })).toEqual([]);
    expect(errorsAt('-webkit-box-decoration-break: clone', { ...NO_FAULTS, boxDecorationAccepted: true })).toEqual([]);
  });
});
