// P4 item 5 (notes/T013-p3-review-p4-plan.md section 2): the Swift and Kotlin dump encoders are emitted from NATIVE_DUMP_SCHEMA:
// adding a field to a copy of the schema changes both emitted encoders; every described key is written in schema order; device
// lanes are non-nullable where the schema says 'reference-lane'; each planted encoder fault changes the emitted source. The host
// compile and encode of every reference dump runs in pnpm run native:encoders.
import { describe, expect, it } from 'vitest';
import type { Field, FieldType } from '../src/native-dump.ts';
import { NATIVE_DUMP_SCHEMA } from '../src/native-dump.ts';
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
