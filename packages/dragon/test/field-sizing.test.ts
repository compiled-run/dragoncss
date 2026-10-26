// field-sizing (css-ui-4 §7.5): fixed and content compile on every target on every element Dragon lays out but a replaced element or
// a form control, since Chrome applies content to form controls alone; content on img, iframe, svg, video, button or input is refused. Parsed as
// Chrome 145 parses it (the two keywords, any ASCII case). The Chrome cases are field-sizing-values and reject-field-sizing-img
// (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each non-info diagnostic as `<target> <code>` with the declarations on a div holding a child with Ahem text. */
function at(decl: string, child = '', faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; } .c { ${child} }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity !== 'info').map((d) => `${String(d.target)} ${d.code}`).sort();
}

/** The same for an svg with the declarations (a replaced element Dragon lays out without an asset). */
function onSvg(decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `.s { display: block; width: 20px; height: 10px; ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'svg', ['s'])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.message}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('field-sizing', () => {
  it('is a registered longhand after speak, not inherited, with no aspect, initial fixed and discrete in animations', () => {
    expect(LONGHANDS[LONGHANDS.indexOf('field-sizing') - 1]).toBe('speak');
    expect(INHERITED.has('field-sizing')).toBe(false);
    expect(PROPERTY_ASPECTS['field-sizing']).toEqual({ layout: false, paint: false });
    expect(initialValue('field-sizing', referenceDataset())).toEqual({ kind: 'keyword', value: 'fixed' });
    expect(ANIMATION_KINDS['field-sizing']).toBe(DISCRETE);
  });
  it('compiles both keywords on every target, in any case and through var() and the CSS-wide keywords', () => {
    for (const v of ['fixed', 'content', 'CONTENT', 'Fixed', 'initial', 'unset', 'revert', 'var(--f, content)']) expect(at(`field-sizing: ${v}`), v).toEqual([]);
    expect(at('field-sizing: content', 'field-sizing: inherit')).toEqual([]);
    expect(at('display: flex; field-sizing: content', 'field-sizing: content')).toEqual([]);
  });
  it('drops what Chrome drops', () => {
    for (const v of ['auto', 'none', 'content fixed', '1px', 'stretch']) expect(at(`field-sizing: ${v}`), v).toEqual(['null DRAGON_CSS_INVALID_VALUE']);
  });
  it('refuses content on a replaced element on every target, and fixed compiles there', () => {
    expect(onSvg('field-sizing: fixed')).toEqual([]);
    const refused = onSvg('field-sizing: content');
    expect(refused.map((m) => m.split(' ')[0])).toEqual(['android', 'ios', 'web']);
    for (const m of refused) expect(m).toContain('field-sizing: content on <svg> a is unsupported');
  });
  it('refuses content on a button and an input on every target, and fixed adds no refusal there', () => {
    for (const tag of ['button', 'input']) {
      const css = `.s { display: block; appearance: none; width: 20px; height: 10px; field-sizing: VALUE; }`;
      const run = (v: string): string[] => {
        const c = project(NO_FAULTS).compile(inputFor(css.replace('VALUE', v), (r) => [el(r, 'a', tag, ['s'])]));
        return c.diagnostics.filter((d) => d.message.startsWith('field-sizing')).map((d) => `${String(d.target)} ${d.code}`).sort();
      };
      expect(run('fixed'), tag).toEqual([]);
      expect(run('content'), tag).toEqual(REFUSED);
    }
  });
  it('plants its fault: content compiles on a replaced element', () => {
    expect(onSvg('field-sizing: content', { ...NO_FAULTS, fieldSizingReplacedAccepted: true })).toEqual([]);
    expect(at('field-sizing: content', '', { ...NO_FAULTS, fieldSizingReplacedAccepted: true })).toEqual([]);
    void REFUSED;
  });
});
