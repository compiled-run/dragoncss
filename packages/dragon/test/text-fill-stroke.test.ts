// TXT-FX: -webkit-text-fill-color, -webkit-text-stroke-width, -webkit-text-stroke-color and the -webkit-text-stroke shorthand. A fill
// of currentcolor and a stroke in px in any colour compile on every target (which strokes iOS and Android draw is text-stroke.test.ts');
// any other fill colour or a stroke width keyword over text is refused. The Chrome cases are text-fill-stroke-initial,
// text-stroke-ahem and reject-text-fill-color (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { UNCAPTURED_LONGHANDS } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/text-fill-stroke.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value` (! when implicit), or its diagnostic codes. */
function parsed(property: string, value: string): string[] {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}${l.explicit ? '' : '!'}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text inheriting the declaration through a child. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('the text fill colour and stroke', () => {
  it('expands -webkit-text-stroke to width and colour, an omitted one at its initial value', () => {
    // A named colour resolves to its channels, as it does under color.
    expect(parsed('color', 'red')).toEqual(['color: rgb(255, 0, 0)']);
    expect(parsed('-webkit-text-stroke', '0')).toEqual(['-webkit-text-stroke-width: 0px', '-webkit-text-stroke-color: currentcolor!']);
    expect(parsed('-webkit-text-stroke', 'red')).toEqual(['-webkit-text-stroke-width: 0px!', '-webkit-text-stroke-color: rgb(255, 0, 0)']);
    expect(parsed('-webkit-text-stroke', 'blue 2px')).toEqual(['-webkit-text-stroke-width: 2px', '-webkit-text-stroke-color: rgb(0, 0, 255)']);
    expect(parsed('-webkit-text-stroke', 'thin')).toEqual(['-webkit-text-stroke-width: thin', '-webkit-text-stroke-color: currentcolor!']);
    for (const v of ['red blue', '1px 2px', '-1px', 'auto']) expect(parsed('-webkit-text-stroke', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('takes a colour function for the colour, in either order, and a calculation for the width', () => {
    const W0 = '-webkit-text-stroke-width: 0px!';
    for (const [v, w, c] of [
      ['rgb(255 0 0)', W0, '-webkit-text-stroke-color: rgb(255, 0, 0)'],
      ['rgb(255 0 0) 1px', '-webkit-text-stroke-width: 1px', '-webkit-text-stroke-color: rgb(255, 0, 0)'],
      ['1px rgb(255 0 0)', '-webkit-text-stroke-width: 1px', '-webkit-text-stroke-color: rgb(255, 0, 0)'],
      ['hsl(120 100% 25%)', W0, '-webkit-text-stroke-color: rgb(0, 128, 0)'],
      ['hsl(120 100% 25%) thin', '-webkit-text-stroke-width: thin', '-webkit-text-stroke-color: rgb(0, 128, 0)'],
      ['thin hsl(120 100% 25%)', '-webkit-text-stroke-width: thin', '-webkit-text-stroke-color: rgb(0, 128, 0)'],
      ['#f00 calc(1px + 1px)', '-webkit-text-stroke-width: calc(1px + 1px)', '-webkit-text-stroke-color: rgb(255, 0, 0)'],
    ] as const) expect(parsed('-webkit-text-stroke', v), v).toEqual([w, c]);
  });

  it('resolves the fill and stroke colour longhands like color, and refuses a colour outside the subset', () => {
    expect(parsed('-webkit-text-fill-color', '#f00')).toEqual(['-webkit-text-fill-color: rgb(255, 0, 0)']);
    expect(parsed('-webkit-text-fill-color', 'hsl(0 100% 50%)')).toEqual(['-webkit-text-fill-color: rgb(255, 0, 0)']);
    expect(parsed('-webkit-text-stroke-color', 'rgb(0 0 255)')).toEqual(['-webkit-text-stroke-color: rgb(0, 0, 255)']);
    expect(parsed('-webkit-text-fill-color', 'currentcolor')).toEqual(['-webkit-text-fill-color: currentcolor']);
    expect(parsed('-webkit-text-fill-color', 'color-mix(in srgb, red, blue)')).toEqual(parsed('color', 'color-mix(in srgb, red, blue)'));
    expect(parsed('-webkit-text-stroke-color', 'oklch(0.6 0.1 30)')).toEqual(parsed('color', 'oklch(0.6 0.1 30)'));
    expect(parsed('color', 'oklch(0.6 0.1 30)')).not.toEqual(['color: oklch(0.6 0.1 30)']);
  });

  it('compiles a stroke colour given as a function in the shorthand, at width 0 and in px (analysis/text-stroke.ts)', () => {
    for (const d of ['-webkit-text-stroke: rgb(255 0 0)', '-webkit-text-stroke: hsl(120 100% 25%) 0', '-webkit-text-stroke: rgb(255 0 0) 1px']) expect(errorsAt(d), d).toEqual([]);
  });

  it('compiles a currentcolor fill and a zero-width stroke of any colour on every target', () => {
    for (const d of ['-webkit-text-fill-color: currentcolor', '-webkit-text-stroke-width: 0', '-webkit-text-stroke: 0 red', '-webkit-text-stroke-color: blue', '-webkit-text-stroke: green', '-webkit-text-fill-color: currentColor; color: red']) expect(errorsAt(d), d).toEqual([]);
  });

  it('leaves the fill and stroke colours out of the UA capture, so text under any color keeps a currentcolor fill', () => {
    // Chrome's getComputedStyle reports the fill as the resolved color (rgb(0, 0, 0) on html), which a UA row would pin.
    for (const p of ['-webkit-text-fill-color', '-webkit-text-stroke-color']) expect(UNCAPTURED_LONGHANDS, p).toContain(p);
    expect(UNCAPTURED_LONGHANDS).not.toContain('-webkit-text-stroke-width');
    for (const d of ['color: red', 'color: blue; -webkit-text-stroke-width: 0']) expect(errorsAt(d), d).toEqual([]);
  });

  it('refuses another fill colour, or a stroke width keyword, over text on every target', () => {
    for (const d of ['-webkit-text-fill-color: red', '-webkit-text-fill-color: transparent', '-webkit-text-stroke: thin', '-webkit-text-stroke-width: medium']) expect(errorsAt(d), d).toEqual(REFUSED);
  });

  it('plants textFillColorAccepted and textStrokeAccepted: each lets its own value compile, and only it', () => {
    expect(errorsAt('-webkit-text-fill-color: red', { ...NO_FAULTS, textFillColorAccepted: true })).toEqual([]);
    expect(errorsAt('-webkit-text-stroke-width: thin', { ...NO_FAULTS, textFillColorAccepted: true })).toEqual(REFUSED);
    expect(errorsAt('-webkit-text-stroke-width: thin', { ...NO_FAULTS, textStrokeAccepted: true })).toEqual([]);
    expect(errorsAt('-webkit-text-fill-color: red', { ...NO_FAULTS, textStrokeAccepted: true })).toEqual(REFUSED);
  });
});
