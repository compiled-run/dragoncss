// ENV-SAFE (landing review M5): a native env() row rests on the insets a mount measures from its stage, which no device lane runs
// with nonzero insets yet, so it is derived caveat with the measuredSafeArea note while its web row stays exact.
import { describe, expect, it } from 'vitest';
import { PROFILE_NOTES } from 'dragon';
import type { CaseOutcome } from '../src/pipeline.ts';
import { deriveRows } from '../src/profile-rows.ts';

const outcome = (id: string, keys: readonly string[]): CaseOutcome =>
  ({ id, lanes: { 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' }, features: { ios: keys, web: keys } }) as unknown as CaseOutcome;

describe('env() profile rows', () => {
  const cases = [outcome('env-a', ['padding-top:<env()>@block/ltr', 'padding-top:<length>@block/ltr'])];
  it('are caveat with the measured-insets note on the native targets', () => {
    for (const t of ['ios', 'android'] as const) {
      const env = deriveRows(t, cases).find((r) => r.feature === 'padding-top:<env()>');
      expect(env?.status, t).toBe('caveat');
      expect(env?.note, t).toBe(PROFILE_NOTES.measuredSafeArea);
      const plain = deriveRows(t, cases).find((r) => r.feature === 'padding-top:<length>');
      expect(plain?.status, t).toBe('exact');
      expect(plain?.note, t).toBeUndefined();
    }
  });
  it('stay exact without a note on web, where Chrome applies the insets itself', () => {
    const env = deriveRows('web', cases).find((r) => r.feature === 'padding-top:<env()>');
    expect(env?.status).toBe('exact');
    expect(env?.note).toBeUndefined();
  });
});
