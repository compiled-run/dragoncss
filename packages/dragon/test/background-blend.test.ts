// compositing-1 §9.2: background-blend-mode is accepted as the single keyword normal alone, on every target; every other value Chrome
// keeps (another mode, or a list) is kept and refused, since no target blends background layers and a blend mode can make text over a
// background unreadable. The Chrome cases are background-blend-initial and reject-background-blend-multiply (packages/parity/fixtures);
// packages/parity/test/background-blend-parse.test.ts pins the parse against Chrome.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS, PROPERTY_ROLE, SHORTHANDS } from '../src/css/properties.ts';
import { BACKGROUND_BLEND_LONGHANDS, BLEND_MODE_LIST_TYPE, isInitialBackgroundBlend } from '../src/css/properties/background-blend.ts';
import { BACKGROUND_LAYERS_LONGHANDS } from '../src/css/properties/background-layers.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, explainOne, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/background-blend.css', revision: 'r1', hash: 'sha256:0' };

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

/** A block .s with a gradient over a colour, holding a block .c (b) with Ahem text over it, and the CSS around them. */
function compile(decl: string, faults: CompilerFaults = NO_FAULTS, child = '', extra = '') {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { width: 60px; background-color: #fa0; background-image: linear-gradient(#05a, #0a5); ${decl}; } .c { ${child} } ${extra}`;
  return project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX XX')])])]));
}

/** Each error as `<target> <code>`. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS, child = '', extra = ''): string[] {
  return compile(decl, faults, child, extra).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

/** The computed background-blend-mode of element a and its child b, on every target. */
function valuesAt(decl: string, child = '', extra = '', faults: CompilerFaults = NO_FAULTS): string[] {
  const c = compile(decl, faults, child, extra);
  return (['web', 'ios', 'android'] as const).flatMap((t) => ['a', 'b'].map((n) => `${t} ${n} ${explainOne(c, t, n, 'background-blend-mode').value}`));
}

const everywhere = (a: string, b: string): string[] => (['web', 'ios', 'android'] as const).flatMap((t) => [`${t} a ${a}`, `${t} b ${b}`]);

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];
const PLANTED = { ...NO_FAULTS, backgroundBlendAccepted: true };

describe('background-blend-mode', () => {
  it('follows the background layer longhands in the registry, is a paint longhand that is not inherited, in no shorthand, and animates discretely', () => {
    expect([...BACKGROUND_BLEND_LONGHANDS]).toEqual(['background-blend-mode']);
    expect(LONGHANDS[LONGHANDS.indexOf('background-blend-mode') - 1]).toBe(BACKGROUND_LAYERS_LONGHANDS[BACKGROUND_LAYERS_LONGHANDS.length - 1]);
    expect(PROPERTY_ROLE['background-blend-mode']).toBe('paint');
    expect(INHERITED.has('background-blend-mode')).toBe(false);
    expect(ANIMATION_KINDS['background-blend-mode']).toBe(DISCRETE);
    expect(SHORTHANDS).not.toContain('background-blend-mode');
    expect(isInitialBackgroundBlend({ kind: 'keyword', value: 'normal' })).toBe(true);
    expect(isInitialBackgroundBlend({ kind: 'keyword', value: 'multiply' })).toBe(false);
    expect(isInitialBackgroundBlend({ kind: 'keyword', value: 'inherit' })).toBe(false);
    expect(isInitialBackgroundBlend({ kind: 'other', type: BLEND_MODE_LIST_TYPE, text: 'normal, normal' })).toBe(false);
  });

  it('parses normal in any case as the keyword, keeps every other Chrome mode and list as written, and drops what Chrome drops', () => {
    expect(parsed('background-blend-mode: normal')).toEqual(['background-blend-mode: normal']);
    expect(parsed('BACKGROUND-BLEND-MODE: NORMAL')).toEqual(['background-blend-mode: normal']);
    expect(parsed('background-blend-mode: Multiply')).toEqual(['background-blend-mode: multiply']);
    expect(parsed('background-blend-mode: normal,NORMAL')).toEqual(['background-blend-mode: normal, normal']);
    expect(parsed('background-blend-mode: screen , luminosity')).toEqual(['background-blend-mode: screen, luminosity']);
    for (const d of ['background-blend-mode: plus-lighter', 'background-blend-mode: plus-darker', 'background-blend-mode: none', 'background-blend-mode: normal normal', 'background-blend-mode: normal,', 'background-blend-mode: 0', 'background-blend-mode: auto', 'background-blend-mode: normal, plus-lighter']) {
      expect(parsed(d), d).toEqual(['dropped']);
    }
  });

  it('accepts normal on every target, through the CSS-wide keywords, var() and inherit', () => {
    expect(errorsAt('background-blend-mode: normal')).toEqual([]);
    expect(errorsAt('background-blend-mode: NORMAL')).toEqual([]);
    expect(errorsAt('background-blend-mode: initial', NO_FAULTS, 'background-blend-mode: unset')).toEqual([]);
    expect(errorsAt('background-blend-mode: revert', NO_FAULTS, 'background-blend-mode: revert-layer')).toEqual([]);
    expect(errorsAt('background-blend-mode: normal', NO_FAULTS, 'background-blend-mode: inherit')).toEqual([]);
    expect(errorsAt('--b: normal; background-blend-mode: var(--b)')).toEqual([]);
    expect(errorsAt('background-blend-mode: var(--missing, normal)')).toEqual([]);
    expect(valuesAt('background-blend-mode: normal', 'background-blend-mode: inherit')).toEqual(everywhere('normal', 'normal'));
    expect(valuesAt('--b: NORMAL; background-blend-mode: var(--b)')).toEqual(everywhere('normal', 'normal'));
    // Not inherited: a child with no declaration takes normal whatever its parent has.
    expect(valuesAt('background-blend-mode: multiply', '', '', PLANTED)).toEqual(everywhere('multiply', 'normal'));
  });

  it('resolves losing declarations and !important as the cascade does, and refuses only a mode that wins', () => {
    // A losing mode is never applied; the committed profiles refuse it as declared (packages/parity fixtures declare none).
    expect(valuesAt('background-blend-mode: multiply; background-blend-mode: normal')).toEqual(everywhere('normal', 'normal'));
    expect(errorsAt('background-blend-mode: multiply; background-blend-mode: normal')).toEqual([]);
    expect(valuesAt('background-blend-mode: normal !important; background-blend-mode: screen')).toEqual(everywhere('normal', 'normal'));
    expect(errorsAt('background-blend-mode: normal !important; background-blend-mode: screen')).toEqual([]);
    // A later rule without !important loses to the earlier important normal.
    expect(valuesAt('background-blend-mode: normal !important', '', '.s { background-blend-mode: overlay; }')).toEqual(everywhere('normal', 'normal'));
    // A value Chrome drops is an invalid declaration, one target-free error whatever it would have lost to.
    expect(errorsAt('background-blend-mode: normal; background-blend-mode: plus-lighter')).toEqual(['null DRAGON_CSS_INVALID_VALUE']);
    // A mode that wins is refused.
    expect(errorsAt('background-blend-mode: normal; background-blend-mode: difference')).toEqual(REFUSED);
    expect(errorsAt('background-blend-mode: normal', NO_FAULTS, '', '.s { background-blend-mode: hue !important; }')).toEqual(REFUSED);
  });

  it('refuses every other value on every target, once per element, through var() and inherit too', () => {
    expect(errorsAt('background-blend-mode: multiply')).toEqual(REFUSED);
    expect(errorsAt('background-blend-mode: normal, normal')).toEqual(REFUSED);
    expect(errorsAt('background-blend-mode: normal, multiply')).toEqual(REFUSED);
    expect(errorsAt('background-blend-mode: normal', NO_FAULTS, 'background-blend-mode: color')).toEqual(REFUSED);
    expect(errorsAt('--b: exclusion; background-blend-mode: var(--b)')).toEqual(REFUSED);
    expect(errorsAt('background-blend-mode: var(--missing, saturation)')).toEqual(REFUSED);
    // display: none does not lift the refusal.
    expect(errorsAt('background-blend-mode: multiply; display: none')).toEqual(REFUSED);
    const c = compile('background-blend-mode: multiply', NO_FAULTS, 'background-blend-mode: inherit');
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors.map((d) => d.message.split(' is unsupported')[0]).sort()).toEqual([
      'background-blend-mode: multiply on <div> a', 'background-blend-mode: multiply on <div> a', 'background-blend-mode: multiply on <div> a',
      'background-blend-mode: multiply on <div> b', 'background-blend-mode: multiply on <div> b', 'background-blend-mode: multiply on <div> b',
    ]);
    for (const d of errors) expect(d.message).toMatch(/is unsupported: .*only normal is accepted$/);
  });

  it('refuses a mode in a :hover state rule as well as the selector native refuses', () => {
    const selector = errorsAt('', NO_FAULTS, '', '.s:hover { color: red; }');
    expect(selector.length).toBeGreaterThan(0);
    expect(errorsAt('', NO_FAULTS, '', '.s:hover { background-blend-mode: normal; }')).toEqual(selector);
    expect(errorsAt('', NO_FAULTS, '', '.s:hover { background-blend-mode: multiply; }')).toEqual([...REFUSED, ...selector].sort());
  });

  it('is refused in @keyframes, where Dragon has no discrete animation writer', () => {
    for (const v of ['background-blend-mode: normal', 'background-blend-mode: multiply']) {
      expect(errorsAt('animation: k 1s', NO_FAULTS, `} @keyframes k { to { ${v}; } } .x {`), v).toEqual(['null DRAGON_UNSUPPORTED_VALUE']);
    }
  });

  it('plant backgroundBlendAccepted: another mode compiles', () => {
    expect(errorsAt('background-blend-mode: multiply', PLANTED)).toEqual([]);
    expect(errorsAt('background-blend-mode: normal, screen', PLANTED)).toEqual([]);
  });
});
