// Apart from native-compare.ts, so the lanes.json readers (lanes-file.ts, targets.ts) never load the dump checks.

/** The dump faults the checks must catch, the same on every native target (native-strategy.md 3.1, 3.3; T009 P3 item 6). */
export const DUMP_FAULTS = ['edge-plus-2-device-px', 'edge-plus-1-device-px', 'applied-changed', 'applied-missing', 'channel-delta-1', 'missing-node', 'snap-disabled', 'break-shifted'] as const;
export type DumpFault = (typeof DUMP_FAULTS)[number];
