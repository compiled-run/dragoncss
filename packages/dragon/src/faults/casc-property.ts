// CASC 2: @property registrations (css-properties-values-api-1).

export type CascPropertyFaults = {
  /** Every registration inherits, as a resolver that ignored inherits: false would (analysis/variables.ts). */
  readonly propertyInheritsIgnored: boolean;
  /** No registration has an initial value, as a resolver that ignored initial-value would: an unset name is guaranteed-invalid. */
  readonly propertyInitialIgnored: boolean;
};

export const CASC_PROPERTY_FAULTS: CascPropertyFaults = { propertyInheritsIgnored: false, propertyInitialIgnored: false };
