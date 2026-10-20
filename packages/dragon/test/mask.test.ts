// MASK-CLIP: the mask layer longhands, mask and mask-position are accepted at their initial values alone, on every target, through
// the -webkit-mask-* aliases too; every other value is kept and refused where it applies, since no target draws masks yet and a mask
// image can hide text. The Chrome cases are mask-initial and reject-mask-image (packages/parity/fixtures);
// packages/parity/test/mask-parse.test.ts pins the parse against Chrome.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue, valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { KeyframesSource } from '../src/css/at-rules/keyframes.ts';
import { parseKeyframesRules } from '../src/css/at-rules/keyframes.ts';
import { MASK_INITIAL, MASK_LONGHANDS } from '../src/css/properties/mask.ts';
import { BORDER_IMAGE_LONGHANDS } from '../src/css/properties/border-image.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/mask.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostics as `code`. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

/** The value kind of each longhand one declaration sets. */
function kindsOf(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, []);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => l.value.kind);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text in a child of the element the declarations are on. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

/** Each longhand's initial spelling, as webref and Chrome's InitialValue give it. */
const INITIAL_DECLS = ['mask-image: none', '-webkit-mask-position-x: 0%', '-webkit-mask-position-y: 0%', 'mask-size: auto', 'mask-repeat: repeat', 'mask-origin: border-box', 'mask-clip: border-box', 'mask-composite: add', 'mask-mode: match-source'];

describe('mask', () => {
  it('follows clip-path, before the border image family, in Chrome\'s mask shorthand order', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf('clip-path') + 1, LONGHANDS.indexOf(BORDER_IMAGE_LONGHANDS[0]))).toEqual([...MASK_LONGHANDS]);
  });

  it('holds the initial values the resolver takes from the grammar', () => {
    for (const p of MASK_LONGHANDS) expect(MASK_INITIAL[p], p).toEqual(initialValue(p, referenceDataset()));
  });

  it('parses each initial spelling in any case as the initial value, and keeps every other value', () => {
    for (const d of INITIAL_DECLS) expect(parsed(d), d).toEqual([d]);
    expect(parsed('MASK-REPEAT: REPEAT')).toEqual(['mask-repeat: repeat']);
    expect(parsed('-webkit-mask-image: None')).toEqual(['mask-image: none']);
    expect(parsed('-webkit-mask-size: auto')).toEqual(['mask-size: auto']);
    expect(parsed('-webkit-mask-clip: border-box')).toEqual(['mask-clip: border-box']);
    expect(parsed('-webkit-mask-composite: source-over')).toEqual(['mask-composite: source-over']);
    expect(parsed('-webkit-mask-composite: SOURCE-OVER')).toEqual(['mask-composite: source-over']);
    expect(kindsOf('-webkit-mask-composite: source-over')).toEqual(['keyword']);
    expect(parsed('mask-position: 0% 0%')).toEqual(['-webkit-mask-position-x: 0%', '-webkit-mask-position-y: 0%']);
    expect(parsed('-webkit-mask-position: 0% 0%')).toEqual(['-webkit-mask-position-x: 0%', '-webkit-mask-position-y: 0%']);
    expect(parsed('mask: none')).toEqual(INITIAL_DECLS);
    expect(parsed('-webkit-mask: NONE')).toEqual(INITIAL_DECLS);
    // Values the initial spelling does not cover are kept as written, so that they are refused rather than ignored.
    for (const d of ['mask-image: url(m.svg)', 'mask-image: none , none', 'mask-repeat: no-repeat', 'mask-repeat: repeat repeat', 'mask-size: contain', 'mask-clip: no-clip', 'mask-composite: add , add', 'mask-mode: alpha', '-webkit-mask-position-x: 0', '-webkit-mask-position-x: -0%', '-webkit-mask-position-x: left', 'mask-image: bogus']) {
      expect(parsed(d), d).toEqual([d]);
      expect(kindsOf(d), d).toEqual(['other']);
    }
    expect(kindsOf('mask-position: 0%')).toEqual(['other', 'other']);
    expect(kindsOf('mask-position: 0% 0% 0%')).toEqual(['other', 'other']);
    expect(parsed('mask: url(m.svg) no-repeat')[0]).toBe('mask-image: url(m.svg) no-repeat');
    expect(parsed('mask-repeat: inherit')).toEqual(['mask-repeat: inherit']);
  });

  it('accepts the initial values on every target, from every name and through the CSS-wide keywords', () => {
    expect(errorsAt(INITIAL_DECLS.join('; '))).toEqual([]);
    expect(errorsAt('mask: none; -webkit-mask: none; mask-position: 0% 0%; -webkit-mask-position: 0% 0%')).toEqual([]);
    expect(errorsAt('-webkit-mask-image: none; -webkit-mask-repeat: repeat; -webkit-mask-size: auto; -webkit-mask-clip: border-box; -webkit-mask-origin: border-box; -webkit-mask-composite: source-over')).toEqual([]);
    for (const k of ['inherit', 'initial', 'unset']) expect(errorsAt(['mask', 'mask-position', '-webkit-mask-composite', '-webkit-mask-repeat', '-webkit-mask-position-y'].map((p) => `${p}: ${k}`).join('; ')), k).toEqual([]);
    // A later initial value wins over an earlier mask, from either name, as in Chrome.
    expect(errorsAt('mask-repeat: no-repeat; -webkit-mask-repeat: repeat')).toEqual([]);
    expect(errorsAt('-webkit-mask: url(m.svg); mask: none')).toEqual([]);
  });

  it('refuses every other value on every target, once where it applies', () => {
    for (const d of ['mask-image: linear-gradient(transparent, transparent)', 'mask-image: url(m.svg)', 'mask-repeat: no-repeat', 'mask-size: 10px', 'mask-origin: content-box', 'mask-clip: no-clip', 'mask-mode: alpha', 'mask-composite: exclude', '-webkit-mask-position-y: 50%', 'mask-position: center', 'mask: url(m.svg) no-repeat center / contain', '-webkit-mask-image: linear-gradient(black, transparent)']) {
      expect(errorsAt(d), d).toEqual(REFUSED);
    }
    expect(errorsAt('mask-image: url(a.svg); mask-repeat: no-repeat; mask-size: cover')).toEqual(REFUSED);
    // A value that arrives through var() is refused as well, and an initial one through var() is accepted.
    expect(errorsAt('--m: url(m.svg); mask-image: var(--m)')).toEqual(REFUSED);
    expect(errorsAt('--m: none; -webkit-mask-image: var(--m)')).toEqual([]);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { mask-repeat: space; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^mask-repeat: space on <div> a is unsupported: /);
    // The reject-mask-image fixture's message (packages/parity/src/fixture-groups/mask.ts).
    const hidden = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; } .s { mask-image: linear-gradient(transparent, transparent); }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    for (const d of hidden.diagnostics.filter((x) => x.severity === 'error')) expect(d.message).toMatch(/^mask-image: linear-gradient\(transparent,transparent\) on <div> a is unsupported: /);
  });

  it('-webkit-mask-composite parses the prefixed operators, as Chrome does in a style sheet: source-over is accepted, add is dropped', () => {
    // MaskComposite::ParseSingleValue under the alias: a comma-separated list of the operators clear to plus-lighter.
    for (const v of ['add', 'ADD', 'subtract', 'exclude, add', 'bogus', 'highlight', 'source-over,', 'source-over / xor', 'inherit, xor']) {
      expect(parsed(`-webkit-mask-composite: ${v}`), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
    for (const v of ['xor', 'clear', 'plus-lighter', 'destination-atop', 'source-over, source-over', 'source-over, xor', '10px']) {
      expect(kindsOf(`-webkit-mask-composite: ${v}`), v).toEqual(['other']);
      expect(errorsAt(`-webkit-mask-composite: ${v}`), v).toEqual(REFUSED);
    }
    for (const k of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) expect(parsed(`-webkit-mask-composite: ${k}`), k).toEqual([`mask-composite: ${k}`]);
    // Only the alias parses source-over; mask-composite keeps it and refuses it.
    expect(kindsOf('mask-composite: source-over')).toEqual(['other']);
    expect(errorsAt('mask-composite: source-over')).toEqual(REFUSED);
    expect(errorsAt('-webkit-mask-composite: source-over')).toEqual([]);
    expect(errorsAt('-webkit-mask: none; -webkit-mask-composite: source-over')).toEqual([]);
    // A dropped add leaves the earlier declaration in place, as in Chrome.
    const kept = (body: string) => parseStylesheet(`.a { ${body} }`, { source: SOURCE, start: 0, end: body.length + 6 }, { id: 's', owner: 'doc', scope: 'document' }, 0, []).flatMap((r) => r.declarations.map((d) => d.text));
    expect(kept('mask-composite: exclude; -webkit-mask-composite: add;')).toEqual(['exclude']);
    expect(errorsAt('-webkit-mask-composite: xor; -webkit-mask-composite: source-over')).toEqual([]);
    // With any other mask longhand not initial, the element is refused all the same.
    expect(errorsAt('-webkit-mask-composite: source-over; mask-image: url(m.svg)')).toEqual(REFUSED);
    // In a keyframe too, the alias parses the prefixed operators.
    const kf = (body: string) => {
      const diagnostics: Diagnostic[] = [];
      const sources: KeyframesSource[] = [];
      const t = `@keyframes k { from { ${body} } }`;
      parseStylesheet(t, { source: SOURCE, start: 0, end: t.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics, [], [], sources);
      const values = parseKeyframesRules(sources, diagnostics).flatMap((r) => r.blocks.flatMap((b) => b.values.map((x) => `${x.property}: ${valueToString(x.value)}`)));
      return { values, codes: diagnostics.map((d) => d.code) };
    };
    expect(kf('-webkit-mask-composite: source-over')).toEqual({ values: ['mask-composite: source-over'], codes: [] });
    expect(kf('-webkit-mask-composite: add')).toEqual({ values: [], codes: ['DRAGON_CSS_INVALID_VALUE'] });
    expect(kf('mask-composite: add')).toEqual({ values: ['mask-composite: add'], codes: [] });
    // A var() value is parsed after substitution as mask-composite, so source-over is refused through it and add accepted.
    expect(errorsAt('--m: source-over; -webkit-mask-composite: var(--m)')).toEqual(REFUSED);
    expect(errorsAt('--m: add; -webkit-mask-composite: var(--m)')).toEqual([]);
  });

  it('source-over is accepted on a child that inherits it, and a refused operator is refused there too', () => {
    const at = (css: string) => {
      const c = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${css}`, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
      return c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    };
    expect(at('.s { -webkit-mask-composite: source-over; } .c { mask-composite: inherit; }')).toEqual([]);
    expect(at('.s { -webkit-mask-composite: xor; } .c { -webkit-mask-composite: inherit; }')).toEqual([...Array(3).fill('mask-composite: xor on <div> a'), ...Array(3).fill('mask-composite: xor on <div> b')]);
  });

  it('web writes source-over under -webkit-mask-composite, the one name that parses it, with the other mask longhands', () => {
    const webOf = (css: string): string => {
      const c = createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
      const out = c.outputs.web;
      if (out.kind !== 'ready') throw new Error(out.kind);
      return (out.files[0] as { text: string }).text;
    };
    const css = webOf('.s { -webkit-mask-composite: source-over; }');
    expect(css.split('  -webkit-mask-composite: source-over;').length - 1).toBe(1);
    expect(css).not.toMatch(/ {2}mask-composite: /);
    expect(css.split('  mask-image: none;').length - 1).toBe(1);
    expect(webOf('.s { -webkit-mask-composite: source-over; -webkit-mask-composite: initial; }')).not.toMatch(/mask/);
  });

  it('refuses a mask that a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { mask-size: 4px; } .c { mask-size: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['mask-size: 4px on <div> a', 'mask-size: 4px on <div> a', 'mask-size: 4px on <div> a', 'mask-size: 4px on <div> b', 'mask-size: 4px on <div> b', 'mask-size: 4px on <div> b']);
  });

  it('plant maskLayerAccepted: a mask image compiles', () => {
    expect(errorsAt('mask-image: url(m.svg)', { ...NO_FAULTS, maskLayerAccepted: true })).toEqual([]);
  });
});
