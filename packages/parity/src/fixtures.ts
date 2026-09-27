// The S1 corpus. Every fixture is attempted in every run; none carries its own tolerance.
import type { DiagnosticCode } from 'dragon';

export const VIEWPORT = { width: 400, height: 300 } as const;

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
  { id: 'reject-display-grid', kind: 'reject', expect: { code: 'DRAGON_UNSUPPORTED_VALUE', spanText: 'grid' } },
];
