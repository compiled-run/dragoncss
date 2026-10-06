// Internal fault switches, reachable only through createProjectWith, so the parity harness can prove it fails (docs/api.md §7).
// Each feature owns faults/<feature>.ts: its fault type (one documented field per fault) and its all-off defaults, and one line in
// FAULT_GROUPS, which is sorted by feature id. A fault name belongs to one feature (test/registry-claims.test.ts).
import { BLOCKIFY_FAULTS } from './faults/blockify.ts';
import { CASCADE_VAR_FAULTS } from './faults/cascade-var.ts';
import { ENV_SAFE_FAULTS } from './faults/env-safe.ts';
import { FONTS_FAULTS } from './faults/fonts.ts';
import { GEN_C_FAULTS } from './faults/gen-c.ts';
import { INL1A_FAULTS } from './faults/inl1a.ts';
import { INL2A_FAULTS } from './faults/inl2a.ts';
import { MEDIA_FAULTS } from './faults/media.ts';
import { MILESTONE_1_FAULTS } from './faults/milestone-1.ts';
import { MQ_R0_FAULTS } from './faults/mq-r0.ts';
import { OVFL_FAULTS } from './faults/ovfl.ts';
import { SELD_FAULTS } from './faults/seld.ts';
import { SELD_R2_FAULTS } from './faults/seld-r2.ts';
import { SELECTORS_FAULTS } from './faults/selectors.ts';
import { VALUES_FAULTS } from './faults/values.ts';

export const FAULT_GROUPS = {
  blockify: BLOCKIFY_FAULTS,
  'cascade-var': CASCADE_VAR_FAULTS,
  'env-safe': ENV_SAFE_FAULTS,
  fonts: FONTS_FAULTS,
  'gen-c': GEN_C_FAULTS,
  inl1a: INL1A_FAULTS,
  inl2a: INL2A_FAULTS,
  media: MEDIA_FAULTS,
  'milestone-1': MILESTONE_1_FAULTS,
  'mq-r0': MQ_R0_FAULTS,
  ovfl: OVFL_FAULTS,
  seld: SELD_FAULTS,
  'seld-r2': SELD_R2_FAULTS,
  selectors: SELECTORS_FAULTS,
  values: VALUES_FAULTS,
} as const;

type Intersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;

export type CompilerFaults = Intersection<(typeof FAULT_GROUPS)[keyof typeof FAULT_GROUPS]>;

export const NO_FAULTS: CompilerFaults = Object.assign({}, ...Object.values(FAULT_GROUPS)) as CompilerFaults;

if (Object.values(FAULT_GROUPS).flatMap((g) => Object.keys(g)).length !== Object.keys(NO_FAULTS).length) throw new Error('a fault belongs to two features (faults/<feature>.ts)');
