// MQ-R2 (notes/T067-mq-r-spec.md R9, §4): Dragon's port of the Android pointer and hover rule (rt-band.ts androidPointerReadings)
// against Chromium's own Java rule over every recorded input device set (packages/layout/rt-vectors/pointer/cases.json, written by
// parity:pointer-vectors from packages/parity/java/PointerRule.java). The translate corpus's pointer suite holds Swift and Kotlin
// to the TypeScript port on the same sets.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rtBand } from '@dragon/layout';
import type { JavaReadings } from '../src/pointer-vectors.ts';
import { POINTER_VECTORS_PATH, POINTER_VECTORS_SCHEMA, pointerDeviceSets, RULE_SOURCES } from '../src/pointer-vectors.ts';
import { repoPath } from '../src/paths.ts';

const vectors = JSON.parse(readFileSync(repoPath(POINTER_VECTORS_PATH), 'utf8')) as { schema: string; cases: { devices: number[]; java: JavaReadings }[] };
const port = (devices: readonly number[], faults: rtBand.BandFaults = rtBand.NO_BAND_FAULTS): JavaReadings => {
  const r = rtBand.androidPointerReadings(devices, faults);
  return [r.pointer, r.hover, r.anyCoarse, r.anyFine, r.anyHover];
};

describe('the Android pointer and hover port against Chromium\'s Java rule', () => {
  it('records every device set the vectors cover: none, one device over nine sources, two over the rule\'s five', () => {
    expect(vectors.schema).toBe(POINTER_VECTORS_SCHEMA);
    expect(vectors.cases.map((c) => c.devices)).toEqual(pointerDeviceSets());
    expect(vectors.cases.length).toBe(1 + 512 + 1024);
  });
  it('gives the Java rule\'s readings for every set', () => {
    const wrong = vectors.cases.filter((c) => JSON.stringify(port(c.devices)) !== JSON.stringify(c.java)).map((c) => `${c.devices.join(',')}: ${JSON.stringify(port(c.devices))} != Java ${JSON.stringify(c.java)}`);
    expect(wrong.slice(0, 5)).toEqual([]);
  });
  it('covers every reading the rule can give, a touch screen with a mouse included (coarse primary, hover)', () => {
    const seen = new Set(vectors.cases.map((c) => JSON.stringify(c.java)));
    expect(seen.has(JSON.stringify(['coarse', true, true, true, true]))).toBe(true);
    expect(seen.has(JSON.stringify(['fine', false, false, true, false]))).toBe(true);
    expect(seen.has(JSON.stringify(['none', false, false, false, false]))).toBe(true);
    expect(seen.size).toBe(6);
  });
  it('the planted primaryPointerFineFirst (the desktop rule) is caught by the vectors', () => {
    const planted = { ...rtBand.NO_BAND_FAULTS, primaryPointerFineFirst: true };
    expect(vectors.cases.filter((c) => JSON.stringify(port(c.devices, planted)) !== JSON.stringify(c.java)).length).toBeGreaterThan(0);
    expect(port([rtBand.SOURCE_TOUCHSCREEN, rtBand.SOURCE_MOUSE], planted)[0]).toBe('fine');
  });
  it('reads a source only when every one of its bits is set (TouchDevice.hasSource)', () => {
    // SOURCE_MOUSE is SOURCE_CLASS_POINTER | 0x2000: a touch screen (0x1002) shares the class bit, not the mouse bit.
    expect(rtBand.hasSource(rtBand.SOURCE_TOUCHSCREEN, rtBand.SOURCE_MOUSE)).toBe(false);
    expect(RULE_SOURCES.every((s) => rtBand.hasSource(s, s))).toBe(true);
    expect(() => rtBand.hasSource(-1, rtBand.SOURCE_MOUSE)).toThrow(rtBand.BandError);
  });
});
