// TXT2-tj: text-justify parses as Chrome 145 parses it (distribute is inter-character; css-text-4's ruby and no-compress are
// invalid), and every value compiles over justified Ahem text but inter-character where no Chrome case measures it: in a real face,
// over a character outside Latin-1 or a soft hyphen, and after a text with no justification opportunity after its last character.
// The Chrome case is text-justify-values-ahem (packages/parity/fixtures, text-justify-values.test.ts).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ElementNode, FontMap, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/text-justify.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value` (! when implicit), or its diagnostic codes. */
function parsed(value: string): string[] {
  const css = `.a { text-justify: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}${l.explicit ? '' : '!'}`);
}

const vendor = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../vendor/fonts/${file}`, import.meta.url)));
const LATO = vendor('Lato/Lato-Regular.ttf');
const MAP: FontMap = { generics: {}, families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: 'fonts/Lato-Regular.ttf', weight: '400' }] } } } as unknown as FontMap;
const withLato = (base: FrontEndResult): FrontEndResult => ({
  ...base,
  snapshot: { ...base.snapshot, assets: [{ id: 'fonts/Lato-Regular.ttf', hash: `sha256:${createHash('sha256').update(LATO).digest('hex')}`, bytes: LATO }] },
});

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/**
 * The text-justify refusals, as `<target> <message>`, of a 55px div d in the family with the given text-align, holding the text t0,
 * then a span s with class s holding the text t1 and then the text t2 (addressed d:text0, s:text0 and d:text1); css styles .d and .s.
 */
function refusals(family: string, css: string, t0: string, t1: string, t2: string): string[] {
  const sheet = `body { font-family: ${family}; font-size: 10px; } .d { width: 55px; } ${css}`;
  const p = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} }, fonts: MAP }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
  const c = p.compile(withLato(inputFor(sheet, (r) => [el(r, 'd', 'div', ['d'], [text(r, 't0', t0), el(r, 's', 'span', ['s'], [text(r, 't1', t1)]), text(r, 't2', t2)])])));
  return c.diagnostics.filter((d) => d.message.startsWith('text-justify')).map((d) => `${String(d.target)} ${d.message}`);
}

const both = (message: string): string[] => [`ios ${message}`, `web ${message}`];

describe('text-justify (TXT2-tj)', () => {
  it('parses as Chrome does', () => {
    for (const v of ['auto', 'none', 'inter-word', 'inter-character', 'NONE']) expect(parsed(v), v).toEqual([`text-justify: ${v.toLowerCase()}`]);
    expect(parsed('distribute')).toEqual(['text-justify: inter-character']);
    for (const v of ['ruby', 'no-compress', 'inter-word inter-character', 'normal', '0']) expect(parsed(v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles every value over justified Ahem text, inter-character after a text with an opportunity after it', () => {
    for (const v of ['auto', 'none', 'inter-word', 'inter-character', 'distribute']) expect(refusals('Ahem', `.d { text-align: justify; text-justify: ${v}; }`, 'XX ', 'XX X', ' XXX X'), v).toEqual([]);
    // After an auto text ending in a space, after a none text and an auto one under an unjustified block.
    expect(refusals('Ahem', '.d { text-align: justify; } .s { text-justify: inter-character; }', 'XX ', 'XX X', ' XXX')).toEqual([]);
    expect(refusals('Ahem', '.d { text-justify: none; } .s { text-justify: inter-character; }', 'XX', 'XX X', 'XXX')).toEqual([]);
    // inter-character over Latin-1 Ahem text.
    expect(refusals('Ahem', '.d { text-align: justify; text-justify: inter-character; }', 'XéX X', 'XX', ' X X')).toEqual([]);
  });

  it('refuses inter-character where no Chrome case measures it, on every target', () => {
    const at = (t: string, why: string): string[] => both(`text-justify: inter-character on ${t} ${why}, in the justified d, is not laid out yet`);
    expect(refusals('Lato', '.d { text-align: justify; } .s { text-justify: inter-character; }', 'Ab ', 'Cd', ' Ef')).toEqual(at('s:text0', 'in a real face'));
    expect(refusals('Ahem', '.d { text-align: justify; } .s { text-justify: inter-character; }', 'XX ', 'XĀX', ' X')).toEqual(at('s:text0', 'holding a character outside Latin-1 or a soft hyphen'));
    expect(refusals('Ahem', '.d { text-align: justify; } .s { text-justify: inter-character; }', 'XX ', 'X­X', ' X')).toEqual(at('s:text0', 'holding a character outside Latin-1 or a soft hyphen'));
    expect(refusals('Ahem', '.d { text-align: justify; } .s { text-justify: inter-character; }', 'XX', 'XX X', ' X')).toEqual(at('s:text0', 'after d:text0, whose text-justify auto leaves no opportunity after its last character'));
    expect(refusals('Ahem', '.d { text-align: justify; text-justify: inter-character; } .s { text-justify: none; }', 'XX ', 'XX ', 'X')).toEqual(at('d:text1', 'after s:text0, whose text-justify none leaves no opportunity after its last character'));
  });
});
