// font-size percentages and <absolute-size> keywords, computed to px at compile time as Chrome 145 computes them (analysis/computed.ts
// computeLengths), and the refusal of a relative size Chrome would clamp to its minimum logical font size (computed-checks.ts). The
// Chrome cases are text-font-size-values-ahem and reject-text-font-size-minimum (packages/parity/fixtures); this file holds the
// arithmetic and the four txt-fs plants.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import type { Longhand } from '../src/css/properties.ts';
import type { CssValue } from '../src/css/stylesheet.ts';
import { toValue } from '../src/css/values.ts';
import type { ResolvedValue } from '../src/analysis/computed.ts';
import { computeLengths, parseValueText, valueToString } from '../src/analysis/computed.ts';
import { TXT_FS_FAULTS } from '../src/faults/txt-fs.ts';
import type { TxtFsFaults } from '../src/faults/txt-fs.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

/** A one-token declared value as the stylesheet parses it (css/values.ts toValue): a math function goes through css/math.ts. */
function declaredValue(property: Longhand, declared: string): CssValue {
  const node = parse(declared, { context: 'value' });
  const only = (node['children'] as { toArray(): CssNode[] }).toArray()[0] as CssNode;
  return only.type === 'Function' ? toValue(only, property) : parseValueText(property, declared);
}

/** The computed font-size of a declared value under a parent of `parent` px and a root of `root` px. */
function computed(declared: string, parent: number, root: number = 16, faults: TxtFsFaults = TXT_FS_FAULTS): string {
  const value = declaredValue('font-size', declared);
  const props = new Map<Longhand, ResolvedValue>([['font-size', { value, origin: 'author', span: null, declaration: null, declared: value } as unknown as ResolvedValue]]);
  computeLengths(props, parent, root, faults);
  return valueToString((props.get('font-size') as ResolvedValue).value);
}

describe('font-size percentages and keywords', () => {
  it('takes a percentage of the parent computed size', () => {
    expect([computed('120%', 10), computed('50%', 13), computed('250%', 10), computed('75%', 18, 10), computed('0%', 10)]).toEqual(['12px', '6.5px', '25px', '13.5px', '0px']);
  });

  it("takes Chrome's keyword table at a medium of 16px, whatever the parent", () => {
    const keywords = ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large'];
    expect(keywords.map((k) => computed(k, 10))).toEqual(['9px', '10px', '13px', '16px', '18px', '24px', '32px', '48px']);
    expect(keywords.map((k) => computed(k, 40))).toEqual(keywords.map((k) => computed(k, 10)));
  });

  it('plant absoluteSizeSpecTable: the spec scaling factors move xx-small, x-small, small and large', () => {
    const plant = { ...TXT_FS_FAULTS, absoluteSizeSpecTable: true };
    expect(['xx-small', 'x-small', 'small', 'large'].map((k) => computed(k, 10, 16, plant))).toEqual(['9.6px', '12px', `${128 / 9}px`, '19.2px']);
  });

  it('plant fontSizePercentOfRoot: a percentage follows the root size, not the parent size', () => {
    expect(computed('50%', 13, 10, { ...TXT_FS_FAULTS, fontSizePercentOfRoot: true })).toBe('5px');
  });
});

/** The computed line-height of a declared value on an element whose own font-size is `own` px, under a root of `root` px. */
function computedLineHeight(declared: string, own: number, root: number = 16, faults: TxtFsFaults = TXT_FS_FAULTS): string {
  const size = parseValueText('font-size', `${own}px`);
  const value = declaredValue('line-height', declared);
  const props = new Map<Longhand, ResolvedValue>([
    ['font-size', { value: size, origin: 'author', span: null, declaration: null, declared: size } as unknown as ResolvedValue],
    ['line-height', { value, origin: 'author', span: null, declaration: null, declared: value } as unknown as ResolvedValue],
  ]);
  computeLengths(props, own, root, faults);
  return valueToString((props.get('line-height') as ResolvedValue).value);
}

// CALC-2: the Chrome case is text-font-size-calc-ahem; the refusals are values-reject-calc-font-size and -line-height.
describe('calculations in font-size and line-height', () => {
  it('folds a font-size calculation to px: em and % of the parent size, rem of the root size, clamped at 0', () => {
    expect([computed('calc(1rem + 1px)', 10), computed('calc(50% + 7px)', 25), computed('calc(1.3em - 1px)', 25), computed('min(30px, 2em)', 25), computed('min(30px, 2em)', 10)]).toEqual(['17px', '19.5px', '31.5px', '30px', '20px']);
    expect([computed('clamp(11px, 150%, 2rem)', 10), computed('clamp(11px, 150%, 2rem)', 30), computed('calc(12pt - 2px)', 10), computed('calc(1em - 30px)', 10)]).toEqual(['15px', '32px', '14px', '0px']);
    expect(computed('calc(1em * 1.7 / 3 + 0.25rem)', 25)).toBe(`${(25 * 1.7) / 3 + 4}px`);
  });

  it('folds a line-height calculation against the element own size, and keeps a number calculation a number', () => {
    expect([computedLineHeight('calc(1em + 4px)', 20), computedLineHeight('max(120%, 17px)', 10), computedLineHeight('max(120%, 17px)', 25), computedLineHeight('clamp(10px, 1em + 30%, 2rem)', 25)]).toEqual(['24px', '17px', '30px', '32px']);
    expect([computedLineHeight('calc(1.5)', 20), computedLineHeight('calc(0.75rem + 0.5em)', 20, 10)]).toEqual(['1.5', '17.5px']);
  });

  it('refuses a calculation that reads the viewport', () => {
    expect(computed('calc(10px + 1vw)', 10)).toContain('is supported with px, %, em, rem and absolute lengths only');
    expect(computedLineHeight('calc(1em + 1vh)', 10)).toContain('is supported with px, %, em, rem and absolute lengths only');
  });

  it('plant calcPercentOfRoot: a percentage in a calculation follows the root size', () => {
    const plant = { ...TXT_FS_FAULTS, calcPercentOfRoot: true };
    expect([computed('calc(50% + 7px)', 25, 10, plant), computedLineHeight('max(120%, 17px)', 25, 30, plant)]).toEqual(['12px', '36px']);
  });
});

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const body = (r: SourceRef): TreeNode[] => [el(r, 'a', 'div', ['k'], [el(r, 'b', 'div', ['q'], [text(r, 't', 'XX')])])];

/** Each error as `<target> <code>` for Ahem text in .q under .k, below a body rule. */
function errors(bodyRule: string, k: string, q: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; ${bodyRule} } .k { font-size: ${k}; } .q { font-size: ${q}; }`;
  return project(faults).compile(inputFor(css, body)).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const CLAMPED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe("the minimum logical font size Chrome clamps a relative size to", () => {
  it('refuses a percentage or smaller below 6px when no px size is above it, a keyword included', () => {
    expect(errors('', 'x-small', '50%')).toEqual(CLAMPED);
    expect(errors('font-size: 10px;', 'x-small', '50%')).toEqual(CLAMPED);
    expect(errors('', 'xx-small', '60%')).toEqual(CLAMPED);
  });

  it('accepts one at 6px and up, or under a px size', () => {
    expect(errors('', 'x-small', '60%')).toEqual([]);
    expect(errors('', '9px', '50%')).toEqual([]);
    expect(errors('', 'small', '50%')).toEqual([]);
  });

  it('treats an em size like a percentage: it keeps the parent keyword size relative, while rem and px are absolute', () => {
    // Chrome's ConvertFontSize: a font-relative length but rem keeps the parent's absoluteness; any other length is absolute.
    expect(errors('', 'x-small', '0.5em')).toEqual(CLAMPED);
    expect(errors('', 'xx-small', '0.6em')).toEqual(CLAMPED);
    expect(errors('', 'x-small', '0.6em')).toEqual([]);
    expect(errors('', '9px', '0.5em')).toEqual([]);
    expect(errors('', '0.5625em', '50%')).toEqual(CLAMPED);
    expect(errors('font-size: 16px;', '0.5em', '50%')).toEqual([]);
    expect(errors('', 'x-small', '0.3rem')).toEqual([]);
    expect(errors('', 'x-small', '5px')).toEqual([]);
    // A percentage under an em size under the initial medium is still relative to it.
    expect(errors('', '0.5em', '50%')).toEqual(CLAMPED);
  });

  it('treats a calculation whose type is a percentage alone as a percentage, and any other calculation as absolute', () => {
    // Chrome's ConvertFontSize asks IsPercentage of the math value, which is true when its type reduces to a percentage.
    for (const q of ['calc(50%)', 'calc(0.5 * 50%)', 'max(50%, 40%)', 'clamp(1%, 25%, 50%)']) expect(errors('', 'x-small', q), q).toEqual(CLAMPED);
    expect(errors('', 'calc(100%)', '0.25em')).toEqual(CLAMPED);
    expect(errors('', 'x-small', 'calc(60%)')).toEqual([]);
    // 5px, but a length plus a percentage is absolute, as a px size is.
    expect(errors('', 'x-small', 'calc(40% + 1px)')).toEqual([]);
  });

  it('plant keywordMinimumUnchecked: the clamped size is accepted', () => {
    expect(errors('', 'x-small', '50%', { ...NO_FAULTS, keywordMinimumUnchecked: true })).toEqual([]);
  });
});
