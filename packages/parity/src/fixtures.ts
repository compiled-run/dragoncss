// The parity corpus. Every fixture is attempted in every run; none carries its own tolerance.
import type { DiagnosticCode, Environment } from 'dragon';

/** The reference environment of every case in this lane (docs/api.md §7): an input to the projection, the engine and Chrome. */
export const ENVIRONMENT: Environment = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1 };

export type FixtureSpec =
  | { readonly id: string; readonly format: 'html' | 'tree'; readonly kind: 'layout'; readonly gate: 'default' }
  | {
      readonly id: string;
      readonly format: 'html' | 'tree';
      readonly kind: 'reject';
      /** spanText null: the diagnostic is unlocated. */
      readonly expect: { readonly code: DiagnosticCode; readonly spanText: string | null };
    };

const layout = (id: string): FixtureSpec => ({ id, format: 'html', kind: 'layout', gate: 'default' });
const tree = (id: string): FixtureSpec => ({ id, format: 'tree', kind: 'layout', gate: 'default' });
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
  reject('reject-display-grid', 'DRAGON_UNSUPPORTED_VALUE', 'grid'),
  reject('reject-color-lab', 'DRAGON_UNSUPPORTED_VALUE', 'lab(50% 40 59)'),
  reject('reject-shorthand-filled', 'DRAGON_UNSUPPORTED_VALUE', '3px'),
  reject('reject-unproven-context', 'DRAGON_UNPROVEN_CONTEXT', 'auto'),
  rejectTree('reject-tree-alias-cycle', 'DRAGON_ALIAS_CYCLE', '<Toggle a checked={doc/b.checked} />'),
  rejectTree('reject-tree-choice-overlap', 'DRAGON_CHOICE_OVERLAP', "{checked ? 'on' : ''} {checked || true ? 'off' : ''}"),
  rejectTree('reject-tree-unknown-state', 'DRAGON_STATE_UNKNOWN', "hovered ? 'on' : ''"),
  rejectTree('reject-tree-initial-domain', 'DRAGON_STATE_VALUE_DOMAIN', 'checked: boolean = "false"'),
  rejectTree('reject-tree-producer-error', 'DRAGON_PRODUCER_ERROR', '<div broken class="'),
  rejectTree('reject-tree-raw-html', 'DRAGON_TREE_RAW_HTML', '{@html "<b>bold</b>"}'),
  reject('reject-white-space-pre', 'DRAGON_UNSUPPORTED_VALUE', 'pre'),
];
