// P4 item 5 (notes/T013-p3-review-p4-plan.md section 2): the Swift and Kotlin dump encoders are emitted from NATIVE_DUMP_SCHEMA:
// adding a field to a copy of the schema changes both emitted encoders; every described key is written in schema order; device
// lanes are non-nullable where the schema says 'reference-lane'; each planted encoder fault changes the emitted source. The host
// compile and encode of every reference dump (pnpm run native:encoders) runs at the end, for both languages.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { Field, FieldType } from '../src/native-dump.ts';
import { NATIVE_DUMP_SCHEMA, validateNativeDump } from '../src/native-dump.ts';
import { relabelledReferenceDumps } from '../src/native-host.ts';
import { repoPath } from '../src/paths.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { ENCODER_FAULT_CODES, ENCODER_FAULTS, encoderKotlin, encoderSource, encoderSwift, plantEncoderFault, schemaClasses } from '../src/native-encoders.ts';

type Obj = Extract<FieldType, { kind: 'object' }>;

describe('dump encoders from NATIVE_DUMP_SCHEMA', () => {
  it('a copy of the schema with one more field changes both emitted encoders, which then write it', () => {
    const extra: Field = { name: 'probeField', type: { kind: 'string', nonEmpty: true }, required: true, nullable: 'never', doc: 'test' };
    const device = NATIVE_DUMP_SCHEMA.fields.find((f) => f.name === 'device') as Field;
    const copy: Obj = { kind: 'object', fields: NATIVE_DUMP_SCHEMA.fields.map((f) => (f === device ? { ...f, type: { kind: 'object', fields: [...(f.type as Obj).fields, extra] } } : f)) };
    for (const lang of ['swift', 'kotlin'] as const) {
      const base = encoderSource(lang);
      const changed = encoderSource(lang, copy);
      expect(changed).not.toBe(base);
      expect(base).not.toContain('probeField');
      expect(changed).toContain('w.key("probeField")');
      expect(changed).toContain(lang === 'swift' ? 'public let probeField: String' : 'val probeField: String,');
    }
  });
  it('every described key of every object is written, in schema order, by both languages', () => {
    for (const c of schemaClasses()) {
      for (const src of [encoderSwift(), encoderKotlin()]) {
        const start = Math.max(src.indexOf(`class ${c.name} {`), src.indexOf(`class ${c.name}(`));
        expect(start, c.name).toBeGreaterThanOrEqual(0);
        const body = src.slice(start, src.indexOf('\n}\n', start));
        const keys = [...body.matchAll(/w\.key\("([^"]+)"\)/g)].map((m) => m[1]);
        expect(keys).toEqual(c.fields.map((f) => f.name));
      }
    }
  });
  it('reference-lane fields are non-optional on device; only always-nullable fields may be null', () => {
    const swift = encoderSwift();
    const kotlin = encoderKotlin();
    expect(swift).toContain('public let parent: String?');
    expect(swift).toContain('public let pixels: DumpPixels\n');
    expect(swift).toContain('public let expectedDigest: String\n');
    expect(kotlin).toContain('val parent: String?,');
    expect(kotlin).toContain('val timing: DumpTiming,');
    expect(swift).not.toMatch(/Codable|JSONEncoder|JSONSerialization/);
    expect(kotlin).not.toMatch(/kotlinx|org\.json|JSONObject/);
  });
  it('each planted encoder fault changes the emitted source and names its validator code', () => {
    for (const lang of ['swift', 'kotlin'] as const) {
      const src = encoderSource(lang);
      for (const f of ENCODER_FAULTS) {
        expect(plantEncoderFault(lang, src, f)).not.toBe(src);
        expect(ENCODER_FAULT_CODES[f]).toMatch(/^(missing-key|extra-key|not-integer|null-not-allowed)$/);
      }
    }
  });
});

// S12 inside pnpm test: the dumps native:encoders feeds the encoders validate on the TS side, and the host compile and encode itself
// passes for both languages (a failing native:encoders fails here).
describe('the encoder inputs and the host encode (S12)', () => {
  it.each([['ios', 3], ['android', 3], ['ios', 2], ['android', 2.625]] as const)('every relabelled reference dump for %s at DPR %s passes validateNativeDump', (target, dpr) => {
    const bad = relabelledReferenceDumps(target, dpr).flatMap((d) => {
      const v = validateNativeDump(d);
      return v.ok ? [] : [`${d.case.id}: ${v.errors.slice(0, 2).map((e) => `${e.path} ${e.code}`).join('; ')}`];
    });
    expect(bad).toEqual([]);
  });
  it.each(['swift', 'kotlin'] as const)('pnpm run native:encoders -- --target %s passes', (lang) => {
    requireReferencePlatform(hostPlatform());
    const r = spawnSync(process.execPath, ['--conditions=dragon-internal', repoPath('packages/parity/src/cli/native-encoders.ts'), '--target', lang], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 1 << 26 });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, out.slice(-3000)).toBe(0);
    expect(out).toMatch(new RegExp(`native:encoders ${lang}: status pass: (\\d+)/\\1 valid, \\1/\\1 equal, (\\d+)/\\2 planted faults caught`));
  }, 600_000);
});
