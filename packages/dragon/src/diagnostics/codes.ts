// Every diagnostic code Dragon emits (docs/api.md §6.1, §9). Codes are never renamed, removed or reused.
// Each feature owns codes/<feature>.ts (its codes and their catalogue entries) and one line in DIAGNOSTIC_FEATURES, which is
// sorted by feature id. DIAGNOSTIC_CODES lists the LEGACY_FEATURES first (the codes that landed before the per-feature split, in
// landing order, pinned by test/diagnostic-codes.json), then every other feature in id order, each pinned by
// test/diagnostic-codes/<feature>.json.
import { ANIM_B1 } from './codes/anim-b1.ts';
import { REPL_A } from './codes/repl-a.ts';
import { S2 } from './codes/s2.ts';
import { S3A } from './codes/s3a.ts';
import { S4A } from './codes/s4a.ts';
import { S5 } from './codes/s5.ts';
import { TREE } from './codes/tree.ts';
import { TXT1A } from './codes/txt1a.ts';
import { TXT1C } from './codes/txt1c.ts';

export const DIAGNOSTIC_FEATURES = {
  'anim-b1': ANIM_B1,
  'repl-a': REPL_A,
  s2: S2,
  s3a: S3A,
  s4a: S4A,
  s5: S5,
  tree: TREE,
  txt1a: TXT1A,
  txt1c: TXT1C,
} as const;

export type DiagnosticFeatureId = keyof typeof DIAGNOSTIC_FEATURES;
export type DiagnosticCode = (typeof DIAGNOSTIC_FEATURES)[DiagnosticFeatureId]['codes'][number];

/** The features whose codes landed before the split, in landing order. Frozen: a new code goes in a new feature. */
export const LEGACY_FEATURES: readonly DiagnosticFeatureId[] = ['s2', 's3a', 's4a', 's5', 'tree', 'txt1c', 'anim-b1'];

/** Every feature in code order: the legacy features, then the rest by id. */
export const DIAGNOSTIC_FEATURE_ORDER: readonly DiagnosticFeatureId[] = [...LEGACY_FEATURES, ...(Object.keys(DIAGNOSTIC_FEATURES) as DiagnosticFeatureId[]).filter((id) => !LEGACY_FEATURES.includes(id)).sort()];

export const DIAGNOSTIC_CODES: readonly DiagnosticCode[] = DIAGNOSTIC_FEATURE_ORDER.flatMap((id): readonly DiagnosticCode[] => DIAGNOSTIC_FEATURES[id].codes);
