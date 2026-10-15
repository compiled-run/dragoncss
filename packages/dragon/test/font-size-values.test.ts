// font-size percentages and <absolute-size> keywords, computed to px at compile time as Chrome 145 computes them (analysis/computed.ts
// computeLengths), and the refusal of a relative size Chrome would clamp to its minimum logical font size (computed-checks.ts). The
// Chrome cases are text-font-size-values-ahem and reject-text-font-size-minimum (packages/parity/fixtures); this file holds the
// arithmetic and the three txt-fs plants.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import type { Longhand } from '../src/css/properties.ts';
import type { ResolvedValue } from '../src/analysis/computed.ts';
import { computeLengths, parseValueText, valueToString } from '../src/analysis/computed.ts';
import { TXT_FS_FAULTS } from '../src/faults/txt-fs.ts';
import type { TxtFsFaults } from '../src/faults/txt-fs.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

/** The computed font-size of a declared value under a parent of `parent` px and a root of `root` px. */
function computed(declared: string, parent: number, root: number = 16, faults: TxtFsFaults = TXT_FS_FAULTS): string {
  const value = parseValueText('font-size', declared);
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

  it('plant keywordMinimumUnchecked: the clamped size is accepted', () => {
    expect(errors('', 'x-small', '50%', { ...NO_FAULTS, keywordMinimumUnchecked: true })).toEqual([]);
  });
});
