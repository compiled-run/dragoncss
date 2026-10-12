// A catalogue entry (docs/api.md §6.1): a code's severity, message, reason and fix kind, and the helpers the feature files use.
export type CatalogueFix = { readonly kind: 'edit'; readonly title: string } | { readonly kind: 'manual'; readonly title: string; readonly manual: string };

export type CatalogueEntry = {
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly why: string;
  /**
   * The why of a refusal raised on a computed value (analysis/computed-checks.ts) rather than by the support profile: the value
   * may be proven elsewhere, but its computed result or where it applies is outside what milestone 1 lays out.
   */
  readonly computedWhy: string | null;
  readonly fix: CatalogueFix;
};

export const manual = (title: string, text: string): CatalogueFix => ({ kind: 'manual', title, manual: text });
export const edit = (title: string): CatalogueFix => ({ kind: 'edit', title });
export const error = (message: string, why: string, fix: CatalogueFix, computedWhy: string | null = null): CatalogueEntry => ({ severity: 'error', message, why, computedWhy, fix });

/** One feature's diagnostics: its codes in order, and exactly one catalogue entry per code. */
export function diagnosticFeature<const C extends readonly string[]>(codes: C, catalogue: { readonly [K in C[number]]: CatalogueEntry }): { readonly codes: C; readonly catalogue: { readonly [K in C[number]]: CatalogueEntry } } {
  return { codes, catalogue };
}
