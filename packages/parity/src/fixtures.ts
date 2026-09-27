// The parity corpus. Every fixture is attempted in every run; none carries its own tolerance.
import type { DiagnosticCode, Environment } from 'dragon';

/** The reference environment of every case in this lane (docs/api.md §7): an input to the projection, the engine and Chrome. */
export const ENVIRONMENT: Environment = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr' };

/** The same environment right-to-left (docs/api.md §7): every tree fixture case also runs here, as its own case ("<case>-rtl"). */
export const RTL_ENVIRONMENT: Environment = { ...ENVIRONMENT, direction: 'rtl' };

/** The environments a layout fixture's cases run in, from its registry field: tree fixtures run in both directions, HTML fixtures
 * in the directions they declare (left-to-right unless the registry says otherwise). */
export function environmentsOf(spec: FixtureSpec): readonly Environment[] {
  if (spec.kind !== 'layout') return [ENVIRONMENT];
  return spec.environments.map((d) => (d === 'rtl' ? RTL_ENVIRONMENT : ENVIRONMENT));
}

/** The case id suffix of a direction: none for ltr, "-rtl" for rtl. */
export const directionSuffix = (direction: Environment['direction']): string => (direction === 'rtl' ? '-rtl' : '');

export type FixtureSpec =
  | {
      readonly id: string;
      readonly format: 'html' | 'tree';
      readonly kind: 'layout';
      readonly gate: 'default';
      /** The environment directions the fixture runs in, each with its own cases and captures ('<case>-rtl' for rtl). */
      readonly environments: readonly Environment['direction'][];
      /** hand-written, or written by scripts/gen-granularity-fixtures.ts from its committed selection. */
      readonly source: 'hand-written' | 'generated';
    }
  | {
      readonly id: string;
      readonly format: 'html' | 'tree';
      readonly kind: 'reject';
      /** spanText null: the diagnostic is unlocated. */
      readonly expect: { readonly code: DiagnosticCode; readonly spanText: string | null };
    };

const layout = (id: string, environments: readonly Environment['direction'][] = ['ltr']): FixtureSpec => ({ id, format: 'html', kind: 'layout', gate: 'default', environments, source: 'hand-written' });
/** An HTML fixture that runs in both environment directions (every position-* and flex-abspos-* fixture). */
const both = (id: string): FixtureSpec => layout(id, ['ltr', 'rtl']);
const generated = (id: string): FixtureSpec => ({ id, format: 'html', kind: 'layout', gate: 'default', environments: ['ltr', 'rtl'], source: 'generated' });
const tree = (id: string): FixtureSpec => ({ id, format: 'tree', kind: 'layout', gate: 'default', environments: ['ltr', 'rtl'], source: 'hand-written' });
const reject = (id: string, code: DiagnosticCode, spanText: string | null): FixtureSpec => ({ id, format: 'html', kind: 'reject', expect: { code, spanText } });
const rejectTree = (id: string, code: DiagnosticCode, spanText: string | null): FixtureSpec => ({ id, format: 'tree', kind: 'reject', expect: { code, spanText } });

export const FIXTURES: readonly FixtureSpec[] = [
  layout('block-ua-divs'),
  layout('block-content-box-padding-border'),
  layout('block-border-box'),
  layout('block-percent-width-padding'),
  layout('block-min-max'),
  layout('block-auto-margin-center'),
  layout('flex-row-grow-shrink-basis'),
  layout('flex-min-max-freeze'),
  layout('flex-column'),
  layout('flex-wrap-gap-align-content'),
  layout('flex-justify-content'),
  layout('flex-align-items-stretch-center'),
  layout('text-ahem-single-line'),
  layout('color-syntax'),
  layout('color-border-sides'),
  layout('cascade-compound-variants'),
  layout('block-fractional-values'),
  layout('percent-height-chain'),
  layout('margin-collapse-siblings'),
  layout('margin-collapse-parent-child'),
  layout('margin-collapse-through'),
  layout('margin-collapse-min-height'),
  layout('margin-collapse-body'),
  layout('flex-auto-margins-main'),
  layout('flex-auto-margins-cross'),
  layout('flex-auto-margins-negative'),
  layout('flex-align-content-remaining'),
  layout('flex-align-content-odd'),
  layout('flex-wrap-line-grow'),
  layout('flex-intrinsic-wrap-column'),
  layout('intrinsic-percent'),
  layout('flex-nested'),
  layout('flex-percent-definite'),
  layout('flex-stretch-percent-minmax'),
  layout('flex-distribution-grid'),
  layout('text-wrap-spaces'),
  layout('text-wrap-zwsp'),
  layout('text-align-multi-line'),
  layout('text-line-height-multi-line'),
  layout('text-unbreakable-overflow'),
  layout('text-whitespace-collapse'),
  layout('text-anonymous-block-mixed'),
  layout('flex-text-anonymous-item'),
  layout('flex-text-min-content-shrink'),
  layout('flex-column-text-wrap'),
  layout('text-fractional-font-size'),
  layout('rtl-block-auto-margins'),
  layout('rtl-text-align-multi-line'),
  layout('rtl-flex-row-justify'),
  layout('rtl-flex-wrap'),
  layout('rtl-text-anonymous'),
  layout('rtl-flex-column-align'),
  layout('direction-mixed-subtree'),
  layout('flex-order'),
  layout('flex-row-reverse'),
  layout('flex-column-reverse'),
  layout('flex-reverse-start-end'),
  layout('flex-wrap-reverse'),
  layout('flex-baseline-text'),
  layout('flex-baseline-synthesized'),
  layout('flex-baseline-nested'),
  layout('flex-align-self-baseline-wrap'),
  layout('flex-baseline-column-fallback'),
  layout('overflow-hidden-bfc'),
  layout('overflow-hidden-flex-min-size'),
  both('position-relative-block'),
  both('position-relative-percent'),
  both('position-relative-flow'),
  both('position-relative-flex'),
  both('position-relative-flex-baseline'),
  both('position-absolute-containing-block'),
  both('position-absolute-static-block'),
  both('position-absolute-static-direction'),
  both('position-absolute-initial-containing-block'),
  both('position-absolute-shrink-to-fit'),
  both('position-absolute-auto-margins'),
  both('position-absolute-over-constrained'),
  both('position-absolute-min-max'),
  both('position-absolute-height'),
  both('position-absolute-percent'),
  both('position-absolute-out-of-flow'),
  both('position-absolute-scroll-container'),
  both('position-absolute-flex-container'),
  both('position-absolute-nested'),
  both('flex-abspos-justify'),
  both('flex-abspos-align'),
  both('flex-abspos-column'),
  both('flex-abspos-reverse'),
  both('flex-abspos-wrap-reverse'),
  both('flex-abspos-center-shrink'),
  both('flex-abspos-insets'),
  both('flex-abspos-excluded'),
  layout('flex-baseline-nested-reverse'),
  layout('flex-auto-margins-reverse-overflow'),
  layout('flex-order-baseline-wrap-reverse'),
  generated('profile-initial-values-box'),
  generated('profile-initial-values-text'),
  generated('gap-contexts'),
  generated('color-syntax-matrix'),
  tree('tree-switch-two-instances'),
  tree('tree-correlated-state'),
  tree('tree-controlled-aliases'),
  tree('tree-branch-arms'),
  tree('tree-slot-projection'),
  tree('tree-shared-class-one-module'),
  tree('tree-colliding-modules'),
  tree('tree-ordered-sheets'),
  tree('tree-ordered-sheets-reversed'),
  tree('tree-param-args'),
  tree('tree-nested-instances'),
  tree('tree-attribute-equality'),
  tree('tree-projected-text'),
  tree('tree-whitespace-leaves'),
  tree('tree-position-toggle'),
  reject('reject-display-grid', 'DRAGON_UNSUPPORTED_VALUE', 'grid'),
  reject('reject-color-lab', 'DRAGON_UNSUPPORTED_VALUE', 'lab(50% 40 59)'),
  reject('reject-shorthand-filled', 'DRAGON_UNPROVEN_CONTEXT', '3px'),
  reject('reject-unproven-context', 'DRAGON_UNPROVEN_CONTEXT', 'auto'),
  rejectTree('reject-tree-alias-cycle', 'DRAGON_ALIAS_CYCLE', '<Toggle a checked={doc/b.checked} />'),
  rejectTree('reject-tree-choice-overlap', 'DRAGON_CHOICE_OVERLAP', "{checked ? 'on' : ''} {checked || true ? 'off' : ''}"),
  rejectTree('reject-tree-unknown-state', 'DRAGON_STATE_UNKNOWN', "hovered ? 'on' : ''"),
  rejectTree('reject-tree-initial-domain', 'DRAGON_STATE_VALUE_DOMAIN', 'checked: boolean = "false"'),
  rejectTree('reject-tree-producer-error', 'DRAGON_PRODUCER_ERROR', '<div broken class="'),
  rejectTree('reject-tree-raw-html', 'DRAGON_TREE_RAW_HTML', '{@html "<b>bold</b>"}'),
  reject('reject-white-space-pre', 'DRAGON_UNSUPPORTED_VALUE', 'pre'),
  reject('reject-nesting-ampersand', 'DRAGON_UNSUPPORTED_NESTED_RULE', '& .b { width: 5px; }'),
  reject('reject-nested-media', 'DRAGON_UNSUPPORTED_AT_RULE', '@media (min-width: 1px) { width: 30px; }'),
  reject('reject-overflow-single-axis', 'DRAGON_UNSUPPORTED_VALUE', 'hidden'),
  reject('reject-overflow-body', 'DRAGON_UNSUPPORTED_VALUE', 'hidden'),
  reject('reject-overflow-scroll', 'DRAGON_UNSUPPORTED_VALUE', 'scroll'),
  reject('reject-last-baseline', 'DRAGON_UNSUPPORTED_VALUE', 'last baseline'),
  reject('reject-bidi-neutral', 'DRAGON_UNSUPPORTED_BIDI', 'AB 12.'),
  reject('reject-position-fixed', 'DRAGON_UNSUPPORTED_VALUE', 'fixed'),
  reject('reject-position-sticky', 'DRAGON_UNSUPPORTED_VALUE', 'sticky'),
  reject('reject-abspos-in-inline', 'DRAGON_UNSUPPORTED_VALUE', 'absolute'),
];
