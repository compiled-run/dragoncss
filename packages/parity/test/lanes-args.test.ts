// T132: pnpm run parity:lanes -- --run-host (the documented command) passes pnpm's -- through; one leading -- is accepted.
import { describe, expect, it } from 'vitest';
import { lanesArgs } from '../src/device-jobs.ts';

describe('parity:lanes arguments: the pnpm separator', () => {
  it('a single leading -- is skipped, so the documented commands parse as without it', () => {
    expect(lanesArgs(['--', '--run-host'])).toEqual(lanesArgs(['--run-host']));
    expect(lanesArgs(['--', '--run-host', '--run-device', '--target', 'android'])).toEqual(lanesArgs(['--run-host', '--run-device', '--target', 'android']));
    expect(lanesArgs(['--'])).toEqual(lanesArgs([]));
  });
  it('a -- anywhere else, or a second one, is still an unknown argument; a value of -- is still a missing value', () => {
    expect(lanesArgs(['--run-host', '--'])).toEqual({ error: 'unknown argument "--"' });
    expect(lanesArgs(['--', '--'])).toEqual({ error: 'unknown argument "--"' });
    expect(lanesArgs(['--', '--run-host', '--', '--run-device'])).toEqual({ error: 'unknown argument "--"' });
    expect(lanesArgs(['--target', '--'])).toEqual({ error: '--target needs a value' });
    expect(lanesArgs(['--', '--own-exit'])).toEqual({ error: 'unknown argument "--own-exit"' });
  });
});
