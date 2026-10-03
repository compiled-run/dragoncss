// T065 R13: the animation kind of every Dragon longhand agrees with Chrome 145's interpolable flags (the committed snapshot,
// scripts/capture-interpolable.ts), and the snapshot is what the script derives from the file at the tag.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { json5ToJson } from '../../../scripts/capture-interpolable.ts';
import { admitted, ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { LONGHANDS } from '../src/css/properties.ts';

type Snapshot = { readonly sha256: string; readonly properties: readonly string[]; readonly interpolable: readonly string[]; readonly notValidForKeyframe: readonly string[] };
const snapshot = JSON.parse(readFileSync(new URL('./data/chrome-145-interpolable.json', import.meta.url), 'utf8')) as Snapshot;

describe('animation kinds', () => {
  it('names every Dragon longhand once, and each is a Chrome 145 property', () => {
    expect(Object.keys(ANIMATION_KINDS).sort()).toEqual([...LONGHANDS].sort());
    expect(LONGHANDS.filter((p) => !snapshot.properties.includes(p))).toEqual([]);
  });

  it('is discrete exactly where Chrome says interpolable: false', () => {
    const wrong = LONGHANDS.filter((p) => (ANIMATION_KINDS[p].kind === 'discrete') === snapshot.interpolable.includes(p));
    expect(wrong).toEqual([]);
  });

  it('admits colour and length only (ANIM-b1)', () => {
    const kinds = new Set(LONGHANDS.filter((p) => admitted(ANIMATION_KINDS[p])).map((p) => ANIMATION_KINDS[p].kind));
    expect([...kinds].sort()).toEqual(['color', 'length']);
    expect(ANIMATION_KINDS['padding-left']).toEqual({ kind: 'length', range: 'non-negative' });
    expect(ANIMATION_KINDS['margin-left']).toEqual({ kind: 'length', range: 'all' });
  });

  it('holds sorted, duplicate-free lists from the pinned file', () => {
    expect(snapshot.sha256).toBe('abdc48ff9bf1815acd8f01907eecb26cc788f44ecd6163dd9821521d815f71e3');
    for (const list of [snapshot.properties, snapshot.interpolable, snapshot.notValidForKeyframe]) {
      expect([...list].sort()).toEqual(list);
      expect(new Set(list).size).toBe(list.length);
    }
    expect(snapshot.interpolable.filter((p) => !snapshot.properties.includes(p))).toEqual([]);
    expect(snapshot.notValidForKeyframe).toContain('animation-name');
  });

  it('reads JSON5 comments, unquoted keys, single quotes and trailing commas', () => {
    const text = "{\n  // a comment\n  data: [ { name: 'a-b', interpolable: true, /* x */ }, ],\n}";
    expect(JSON.parse(json5ToJson(text))).toEqual({ data: [{ name: 'a-b', interpolable: true }] });
    expect(() => json5ToJson("{ name: 'open }")).toThrow(/unterminated string/);
  });
});
