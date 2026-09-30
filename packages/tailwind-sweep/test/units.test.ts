// The sweep's parts on small inputs: the shell pre-pass, the rules reader, companions, categories, the Chrome parse condition,
// refusal groups, the snapshot format and the dual comparison. The whole corpus runs in sweep.test.ts.
import { describe, expect, it } from 'vitest';
import { categoryOf } from '../src/categories.ts';
import { checkCaptured, compareCaptures } from '../src/chrome.ts';
import type { Blocker } from '../src/dragon.ts';
import { flatten } from '../src/flatten.ts';
import type { DragonRow } from '../src/pool.ts';
import { utilityRules } from '../src/rules.ts';
import { deserialize, serialize, summarize } from '../src/snapshot.ts';
import type { UtilityRecord } from '../src/sweep.ts';
import { companions, outcomeDiffs, parseCondition, refusalGroup } from '../src/sweep.ts';
import { escapeClass, publishedCss } from '../src/tailwind.ts';

const swept = async (...classes: string[]): Promise<string> => flatten(await publishedCss(classes)).css;

describe('the shell pre-pass', () => {
  it('unwraps the layers, drops @property, puts the fallback first as *, and keeps the utility rules byte for byte', async () => {
    const published = await publishedCss(['space-x-reverse', 'bg-red-500']);
    const f = flatten(published);
    expect(f.shell).toEqual(['host-arm', 'layer-block', 'layer-statement', 'property', 'property-fallback']);
    expect(f.css.startsWith('* {\n      --tw-space-x-reverse: 0;')).toBe(true);
    expect(f.css).not.toMatch(/@layer|@property|@supports|:host|::before/);
    expect(f.css).toContain(':root {\n    --color-red-500: oklch(63.7% 0.237 25.331);\n  }');
    for (const rule of [':where(.space-x-reverse > :not(:last-child)) {\n    --tw-space-x-reverse: 1;\n  }', '.bg-red-500 {\n    background-color: var(--color-red-500);\n  }']) {
      expect(published).toContain(rule);
      expect(f.css).toContain(rule);
    }
  });

  it('a utility with no shell parts is its rule alone', async () => {
    expect(flatten(await publishedCss(['flex']))).toEqual({ css: '.flex {\n    display: flex;\n  }\n', shell: ['layer-block'] });
  });

  it('a shell of another shape throws instead of being judged', async () => {
    const published = await publishedCss(['shadow-md']);
    expect(() => flatten(published.replace('--tw-ring-offset-shadow: 0 0 #0000;\n    }', '}'))).toThrow(/no declaration in the fallback rule/);
    expect(() => flatten(published.replace('@layer utilities', '@layer components'))).toThrow(/unexpected layer/);
    expect(() => flatten(published.replace('(-webkit-hyphens: none)', '(hyphens: none)'))).toThrow(/@supports fallback block/);
    expect(() => flatten(`${published}${published.slice(published.lastIndexOf('@layer properties {'))}`)).toThrow(/two @layer properties blocks/);
    expect(() => flatten('@layer utilities { .a { : red; } }')).toThrow(/does not parse/);
  });
});

describe('the rules reader', () => {
  it('follows var() through the utility\'s own custom declarations, and ignores the shell rules', async () => {
    const ring = utilityRules(await swept('ring-2'));
    expect(ring.properties).toEqual(['box-shadow']);
    expect(ring.reads).toContain('--tw-ring-color');
    expect(ring.reads).toContain('--tw-ring-offset-width');
    const from = utilityRules(await swept('from-red-500'));
    expect(from.properties).toEqual([]);
    expect(from.sets).toEqual(['--tw-gradient-from', '--tw-gradient-stops']);
    expect(from.customReads).toContain('--tw-gradient-from-position');
    expect(utilityRules(await swept('bg-linear-to-r')).reads).toEqual(['--tw-gradient-stops']);
  });
});

describe('companions of custom-property-only utilities', () => {
  it('a direct reader, a reader through a feeding modifier, and none', async () => {
    const names = ['-bg-linear-45', 'bg-linear-to-r', 'from-red-500', 'from-0%', 'ring-2', 'ring-red-500', 'p-4'];
    const rows = new Map<string, DragonRow>();
    for (const n of names) rows.set(n, { key: n, shell: [], sweptCss: await swept(n), published: null, result: null, crashes: [] });
    rows.set('lonely', { key: 'lonely', shell: [], sweptCss: '.lonely { --nobody-reads: 1; }', published: null, result: null, crashes: [] });
    const list = [...names, 'lonely'].map((name) => ({ name, root: name, colour: false }));
    expect(Object.fromEntries(companions(list, rows))).toEqual({
      'from-red-500': ['bg-linear-to-r'],
      'from-0%': ['bg-linear-to-r', 'from-red-500'],
      'ring-red-500': ['ring-2'],
      lonely: null,
    });
  });
});

describe('categories', () => {
  it('colour values first, then the name table, then the first property; an unknown property throws', () => {
    expect(categoryOf('bg-red-500', true, ['background-color'])).toBe('colours');
    expect(categoryOf('sr-only', false, ['position'])).toBe('accessibility');
    expect(categoryOf('p-4', false, ['padding'])).toBe('spacing');
    expect(() => categoryOf('x', false, ['no-such-property'])).toThrow(/no entry for no-such-property/);
    expect(() => categoryOf('x', false, [])).toThrow(/no standard property/);
  });
});

describe('the Chrome parse condition and refusal groups', () => {
  const b = (code: string, context: string | null, at = '', message = ''): Blocker => ({ code, at, message, fix: '', context });
  it('a declaration without var(), without !important; a selector; null when Chrome cannot judge it', () => {
    expect(parseCondition(b('DRAGON_CSS_INVALID_VALUE', 'justify-content: baseline !important'))).toBe('justify-content: baseline');
    expect(parseCondition(b('DRAGON_SELECTOR_DROPPED', '.a:foo'))).toBe('selector(.a:foo)');
    expect(parseCondition(b('DRAGON_CSS_INVALID_VALUE', 'width: var(--x)'))).toBeNull();
    expect(parseCondition(b('DRAGON_CSS_INVALID_VALUE', null))).toBeNull();
  });
  it.each([
    ['DRAGON_UNSUPPORTED_PROPERTY', 'box-shadow: 0 0', 'box-shadow is not supported in milestone 1', 'property box-shadow'],
    ['DRAGON_UNSUPPORTED_AT_RULE', '', '@supports in a rule block is not supported in milestone 1', 'at-rule @supports'],
    ['DRAGON_UNSUPPORTED_SELECTOR', '::placeholder', 'pseudo-element ::placeholder is not supported: pseudo-elements generate boxes', 'selector pseudo-element ::placeholder'],
    ['DRAGON_UNSUPPORTED_VALUE', 'var(--c)', 'background-color: var(--c) substitutes to "oklch(1 0 0)", and oklch(1 0 0) is unsupported: oklch() colours are not supported', 'value oklch()'],
    ['DRAGON_UNSUPPORTED_VALUE', 'x', 'width: 1vw is unsupported: viewport units resolve against the device viewport', 'value viewport units'],
    ['DRAGON_UNSUPPORTED_VALUE', 'var(--t)', 'font-size: var(--t) substitutes to 1.125rem on u; font-size:<length-rem> is unsupported (support profile m1-s5)', 'profile font-size:<length-rem>'],
    ['DRAGON_UNSUPPORTED_VALUE', 'display:flex', 'display: flex is unsupported (support profile m1-s5); no display value is proven in block/ltr', 'profile display:flex'],
    ['DRAGON_UNSUPPORTED_VALUE', 'x', 'width: fit-content (set by inline-size: fit-content) is unsupported (support profile m1-s5); in block/ltr use auto', 'profile width:fit-content'],
    ['DRAGON_UNSUPPORTED_VALUE', 'x', 'multi-token value "safe center" for align-items is not supported in milestone 1', 'value multi-token align-items'],
    ['DRAGON_UNSUPPORTED_VALUE', 'x', 'overflow-y computes to auto on u (css-overflow-3 §3.1)', 'value overflow-y computes to auto'],
    ['DRAGON_UNSUPPORTED_VALUE', 'x', 'max-width: 65ch is unsupported: it is measured from the primary font at its rendered size', 'value font-relative units'],
    ['DRAGON_UNSUPPORTED_VALUE', 'x', 'something new', 'value something new'],
    ['DRAGON_UNPROVEN_CONTEXT', 'bottom:<length-px>', 'bottom:<length-px> on u is used in the block/ltr context', 'unproven context bottom:<length-px>'],
  ])('%s: %s', (code, at, message, group) => {
    expect(refusalGroup({ code, at, message })).toBe(group);
  });
});

describe('the snapshot', () => {
  const records: UtilityRecord[] = [
    { utility: 'flex', root: 'flex', category: 'layout', with: null, outcomes: { web: { status: 'supported' }, ios: { status: 'supported' }, android: { status: 'refused', code: 'C', group: 'g', at: 'a', fix: 'f1' } }, published: { web: ['X'], ios: ['X'], android: ['X'] } },
    { utility: 'from-0%', root: 'from', category: 'backgrounds', with: ['bg-linear-to-r', 'from-red-500'], outcomes: { web: { status: 'refused', code: 'C', group: 'g', at: 'a', fix: 'f1', chromeParses: true }, ios: { status: 'invalid', why: 'w' }, android: { status: 'invalid', why: 'w' } }, published: { web: ['X'], ios: ['Y'], android: [] } },
    { utility: 'm', root: 'm', category: 'effects', with: null, outcomes: { web: { status: 'mismatch', problems: ['p1', 'p2'] }, ios: { status: 'mismatch', problems: ['p1', 'p2'] }, android: { status: 'refused', code: 'D', group: 'h', at: 'b', fix: 'f2' } }, published: { web: [], ios: [], android: [] } },
  ];
  it('round-trips every status, the =web and =ios repeats, companions and per-target published codes', () => {
    const text = serialize(records, { chrome: 'c' });
    expect(deserialize(text).records).toEqual(records);
    expect(text.split('\n').filter((l) => l.startsWith('{"u":'))).toHaveLength(3);
    expect(text).toContain('"android":"=ios"');
  });
  it('outcomeDiffs names each utility and target whose outcome changed, and utilities added or removed', () => {
    const changed: UtilityRecord[] = [{ ...records[0] as UtilityRecord, outcomes: { ...(records[0] as UtilityRecord).outcomes, ios: { status: 'refused', code: 'C', group: 'g', at: 'a', fix: 'f1' } } }, records[1] as UtilityRecord];
    expect(outcomeDiffs(records, changed)).toEqual([
      'flex ios: snapshot supported, now refused C a',
      'm: in the snapshot, not in the sweep',
    ]);
    expect(outcomeDiffs(records, records)).toEqual([]);
  });
  it('a malformed snapshot throws, naming the line', () => {
    const text = serialize(records, { chrome: 'c' });
    const bad = (from: string, to: string): (() => unknown) => {
      expect(text).toContain(from);
      return () => deserialize(text.replace(from, to));
    };
    expect(bad('"web":"supported"', '"web":"supportd"')).toThrow(/snapshot line 1: unknown outcome/);
    expect(bad('"web":"supported"', '"web":"=ios"')).toThrow(/snapshot line 1: =ios before that target/);
    expect(bad('"c":"layout"', '"c":"nowhere"')).toThrow(/snapshot line 1: unknown category nowhere/);
    expect(bad('"u":"flex"', '"u":7')).toThrow(/snapshot line 1: a line needs u and r/);
    expect(bad('"published":[]', '"published":{"web":[]}')).toThrow(/snapshot line 3: published must list codes/);
    expect(bad('"with":["bg-linear-to-r","from-red-500"]', '"with":[]')).toThrow(/snapshot line 2: with must list companions/);
    expect(bad('"chrome-parses"', '"chrome-parse"')).toThrow(/snapshot line 2: unknown outcome/);
    expect(bad('["mismatch",["p1","p2"]]', '["mismatch","p1"]')).toThrow(/snapshot line 3: unknown outcome/);
    expect(bad('"android":["refused","D","h","b",1]', '"android":["refused","D","h","b",9]')).toThrow(/snapshot line 3: fix index 9 out of range/);
    expect(bad('"utilities":3', '"utilities":4')).toThrow(/lists 3 utilities, its meta says 4/);
    expect(bad('"chrome":"c"', '"chrome":1')).toThrow(/meta needs tailwind, chrome and a utility count/);
    expect(bad('"u":"m"', '"u":"flex"')).toThrow(/lists a utility twice/);
    expect(() => deserialize('{"meta":{"schema":"dragon/tailwind-sweep@1"}}')).toThrow(/needs meta, fixes and utilities/);
    expect(() => deserialize('[]')).toThrow(/needs meta, fixes and utilities/);
  });
  it('summary counts', () => {
    const s = summarize(records);
    expect(s.byTarget.web).toEqual({ supported: 1, refused: 1, invalid: 0, mismatch: 1 });
    expect(s.byTarget.android).toEqual({ supported: 0, refused: 2, invalid: 1, mismatch: 0 });
    expect(s.publishedCompiles).toEqual({ web: 1, ios: 1, android: 2 });
    expect(s.refusals).toEqual([
      { group: 'g', utilities: { web: 1, ios: 0, android: 1 }, families: 1 },
      { group: 'h', utilities: { web: 0, ios: 0, android: 1 }, families: 0 },
    ]);
  });
});

describe('the dual comparison', () => {
  const node = (id: string, box: number[], computed: [string, string][]) => ({ id, box, computed });
  const base = [node('u', [0, 0, 10, 10], [['display', 'flex'], ['width', '10px']])];
  it('equal renderings agree; a box, a value, a missing property or a different element list is a problem', () => {
    expect(compareCaptures(base, base)).toEqual([]);
    expect(compareCaptures(base, [node('u', [0, 0, 10, 11], [['display', 'flex'], ['width', '10px']])])).toEqual(['u: box authored [0, 0, 10, 10] compiled [0, 0, 10, 11]']);
    expect(compareCaptures(base, [node('u', [0, 0, 10, 10], [['display', 'block'], ['width', '10px']])])).toEqual(['u: display authored "flex" compiled "block"']);
    expect(compareCaptures(base, [node('u', [0, 0, 10, 10], [['display', 'flex']])])).toEqual(['u: 2 authored and 1 compiled computed properties', 'u: width authored "10px" compiled "(missing)"']);
    expect(compareCaptures(base, [node('v', [0, 0, 10, 10], [])])).toEqual(['the renderings have different elements']);
    expect(compareCaptures([], [])).toEqual(['the renderings have no elements']);
  });
  it('a page capture must list every fixture element in order, each with a four-number box and string pairs', () => {
    const all = ['html', 'body', 'u', 'c1', 'c2'].map((id) => node(id, [0, 0, 1, 1], [['display', 'block']]));
    expect(checkCaptured(all)).toEqual(all);
    expect(() => checkCaptured({})).toThrow(/not a list/);
    expect(() => checkCaptured(all.slice(0, 4))).toThrow(/captured elements html body u c1, expected html body u c1 c2/);
    expect(() => checkCaptured([...all.slice(0, 4), node('c2', [0, 0, 1], [])])).toThrow(/malformed/);
    expect(() => checkCaptured([...all.slice(0, 4), { id: null, box: [0, 0, 1, 1], computed: [] }])).toThrow(/malformed/);
    expect(() => checkCaptured([...all.slice(0, 4), { id: 'c2', box: [0, 0, 1, 1], computed: [['display', 1]] }])).toThrow(/malformed/);
  });
});

describe('class escaping', () => {
  it.each([['w-1/2', 'w-1\\/2'], ['-m-0.5', '-m-0\\.5'], ['@container', '\\@container'], ['from-10%', 'from-10\\%'], ['2xl', '\\32 xl'], ['-2', '-\\32 '], ['-', '\\-']])('%s', (name, escaped) => {
    expect(escapeClass(name)).toBe(escaped);
  });
});
