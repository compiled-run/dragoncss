// The parity corpus. Every fixture is attempted in every run; none carries its own tolerance.
import type { DiagnosticCode, Environment } from 'dragon';

/** The reference environment of every case in this lane (docs/api.md §7): an input to the projection, the engine and Chrome. */
export const ENVIRONMENT: Environment = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1 };

export type FixtureSpec =
  | { readonly id: string; readonly kind: 'layout'; readonly gate: 'default' }
  | { readonly id: string; readonly kind: 'reject'; readonly expect: { readonly code: DiagnosticCode; readonly spanText: string } };

const layout = (id: string): FixtureSpec => ({ id, kind: 'layout', gate: 'default' });

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
  { id: 'reject-display-grid', kind: 'reject', expect: { code: 'DRAGON_UNSUPPORTED_VALUE', spanText: 'grid' } },
  { id: 'reject-color-lab', kind: 'reject', expect: { code: 'DRAGON_UNSUPPORTED_VALUE', spanText: 'lab(50% 40 59)' } },
  { id: 'reject-shorthand-filled', kind: 'reject', expect: { code: 'DRAGON_UNSUPPORTED_VALUE', spanText: '3px' } },
];
