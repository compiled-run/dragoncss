// statusOf and provenContexts read a frozen profile through a per-feature row index; it must answer exactly as a scan of the rows.
import { describe, expect, it } from 'vitest';
import type { ProfileRow, SupportProfile } from '../src/profiles/types.ts';
import { provenContexts, statusOf } from '../src/profiles/types.ts';
import { COMMITTED_PROFILES } from '../src/internal.ts';

const scanStatus = (p: SupportProfile, feature: string, context: string): string => p.rows.find((r) => r.feature === feature && r.context === context)?.status ?? 'unsupported';
const scanContexts = (p: SupportProfile, feature: string): string[] => p.rows.filter((r) => r.feature === feature && r.status !== 'unsupported').map((r) => r.context);
const row = (feature: string, context: string, status: ProfileRow['status']): ProfileRow => ({ feature, context, status, proofs: [] });

describe('the profile row index', () => {
  it('answers every row, every feature and every context of the committed profiles as a scan does', () => {
    for (const p of Object.values(COMMITTED_PROFILES)) {
      expect(Object.isFrozen(p.rows)).toBe(true);
      const features = [...new Set(p.rows.map((r) => r.feature))];
      const contexts = [...new Set(p.rows.map((r) => r.context))];
      for (const r of p.rows) expect(statusOf(p, r.feature, r.context)).toBe(scanStatus(p, r.feature, r.context));
      for (const f of features) expect(provenContexts(p, f)).toEqual(scanContexts(p, f));
      for (const c of contexts) expect(statusOf(p, 'no-such-property:x', c)).toBe('unsupported');
      expect(provenContexts(p, 'no-such-property:x')).toEqual([]);
    }
  });

  it('keeps the first of duplicate rows and the row order of contexts', () => {
    const rows = [row('a:x', 'block', 'unsupported'), row('a:x', 'flex', 'exact'), row('a:x', 'block', 'exact'), row('b:y', 'block', 'exact')];
    const p: SupportProfile = Object.freeze({ target: 'ios', revision: 't', rows: Object.freeze(rows.map((r) => Object.freeze(r))) });
    expect(statusOf(p, 'a:x', 'block')).toBe('unsupported');
    expect(provenContexts(p, 'a:x')).toEqual(['flex', 'block']);
    expect(statusOf(p, 'b:y', 'flex')).toBe('unsupported');
  });

  it('never caches a profile whose rows can still change', () => {
    const rows = [row('a:x', 'block', 'exact')];
    const p: SupportProfile = { target: 'ios', revision: 't', rows };
    expect(statusOf(p, 'a:x', 'block')).toBe('exact');
    rows.unshift(row('a:x', 'block', 'unsupported'));
    rows.push(row('c:z', 'flex', 'exact'));
    expect(statusOf(p, 'a:x', 'block')).toBe('unsupported');
    expect(provenContexts(p, 'c:z')).toEqual(['flex']);
    // A frozen list of unfrozen rows is scanned too.
    const loose = [row('d:w', 'block', 'exact')];
    const q: SupportProfile = { target: 'ios', revision: 't', rows: Object.freeze(loose) };
    expect(statusOf(q, 'd:w', 'block')).toBe('exact');
    (loose[0] as { status: string }).status = 'unsupported';
    expect(statusOf(q, 'd:w', 'block')).toBe('unsupported');
  });
});
