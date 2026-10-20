// GEN-c ::marker: the selector, its cascade onto a list item's marker (inheriting from the item), the declarations it accepts
// (color only), and the marker colour in the native programs, the colour maps the parity lanes compare and the web output.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS, resolvedColors, resolvedTextColors, WEB_CSS_PATH, webClassMap } from '../src/internal.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/marker.css', revision: 'r1', hash: 'sha256:0' };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 16px; } li { color: rgb(10, 20, 30); }';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** A list (class l) of item li (class a) and item li2, each holding text, under extra CSS. */
const compile = (css: string, listClasses: string[] = ['l']) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' })
    .compile(inputFor(`${BASE} ${css}`, (r) => [el(r, 'ul', 'ul', listClasses, [el(r, 'li', 'li', ['a'], [text(r, 't', 'Hi')]), el(r, 'li2', 'li', [], [text(r, 'u', 'X')])])]));

const messages = (c: ReturnType<typeof compile>): string[] => c.diagnostics.map((d) => `${d.code} ${d.message}`);

function parse(css: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

describe('::marker selectors', () => {
  it('parse as a marker pseudo-element with a type selector\'s specificity', () => {
    const diagnostics: Diagnostic[] = [];
    const rules = parseStylesheet('li::marker, .a::MARKER, #b ::marker { color: red; }', { source: SOURCE, start: 0, end: 52 }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
    expect(diagnostics).toEqual([]);
    expect(rules.flatMap((r) => r.selectors).map((s) => [s.pseudoElement?.kind, s.specificity])).toEqual([['marker', [0, 0, 2]], ['marker', [0, 1, 1]], ['marker', [1, 0, 1]]]);
  });

  it('refuse another pseudo after or before ::marker, and a state-dependent ::marker, naming GEN-d6 or GEN-d', () => {
    const refused = (sel: string): string[] => parse(`${sel} { color: red; }`).map((d) => `${d.code} ${d.message}`);
    expect(refused('li::marker:hover')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d8\)$/)]);
    expect(refused('li::marker::before')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d\)$/)]);
    expect(refused('li::before::marker')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d6\)$/)]);
    expect(refused('li:hover::marker')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*interaction state.*GEN-d6\)$/)]);
    expect(refused('ul:has(li:focus) li::marker')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d6\)$/)]);
    expect(refused(':is(li::marker)')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR /)]);
  });
});

describe('::marker declarations', () => {
  it('accept color and refuse every other property, custom properties included, naming GEN-d6', () => {
    expect(messages(compile('li::marker { color: red; }'))).toEqual([]);
    const c = compile("li::marker { color: red; font-size: 20px; content: 'x'; --c: red; } .l { color: blue; }");
    expect(messages(c)).toEqual(['font-size', 'content', '--c'].map((p) => `DRAGON_UNSUPPORTED_PROPERTY ${p} in a rule that styles ::marker is not supported yet: Dragon draws only a marker's color (the list-marker package GEN-d6)`));
  });
});

describe('the marker colour', () => {
  const rgb = (r: number, g: number, b: number) => ({ r, g, b, alpha: 255 });
  const markerColor = (css: string, at = 'li') => resolvedColors(compile(css), [])?.get(`${at}::marker`)?.color;

  it('cascades the ::marker rules onto the marker and inherits from the item otherwise; the item keeps its own colour', () => {
    expect(markerColor('')).toEqual(rgb(10, 20, 30));
    expect(markerColor('li::marker { color: rgb(200, 0, 0); }')).toEqual(rgb(200, 0, 0));
    expect(markerColor('li::marker { color: rgb(200, 0, 0); }', 'li2')).toEqual(rgb(200, 0, 0));
    expect(resolvedColors(compile('li::marker { color: rgb(200, 0, 0); }'), [])?.get('li')?.color).toEqual(rgb(10, 20, 30));
    // The more specific selector wins whatever the order; the losing rule does not reach the marker.
    expect(markerColor('.a::marker { color: rgb(0, 200, 0); } li::marker { color: rgb(200, 0, 0); }')).toEqual(rgb(0, 200, 0));
    expect(markerColor('.a::marker { color: rgb(0, 200, 0); } li::marker { color: rgb(200, 0, 0); }', 'li2')).toEqual(rgb(200, 0, 0));
    // currentcolor and inherit on ::marker take the item's colour.
    expect(markerColor('li::marker { color: rgb(200, 0, 0); } .a::marker { color: currentcolor; }')).toEqual(rgb(10, 20, 30));
    expect(markerColor('li::marker { color: rgb(200, 0, 0); } .a::marker { color: inherit; }')).toEqual(rgb(10, 20, 30));
    // A ::marker rule matches no element.
    expect(resolvedColors(compile('.a::marker { color: rgb(200, 0, 0); }'), [])?.get('li')?.color).toEqual(rgb(10, 20, 30));
  });

  it('is the symbol write and the text marker\'s text colour in the native programs', () => {
    const disc = nativePrograms(compile('li::marker { color: rgb(200, 0, 0); } .a::marker { color: rgb(0, 0, 200); }'), []);
    if (disc.kind !== 'ready') throw new Error(disc.reason);
    for (const p of Object.values(disc.programs)) {
      const write = (id: string) => p.nodes.find((x) => x.id === id)?.writes.find((w) => w.kind === 'list-marker');
      expect(write('li::marker')).toMatchObject({ symbol: 'disc', color: rgb(0, 0, 200) });
      expect(write('li2::marker')).toMatchObject({ symbol: 'disc', color: rgb(200, 0, 0) });
      expect(p.nodes.find((x) => x.id === 'li:text0')?.writes.find((w) => w.kind === 'text-color')).toMatchObject({ color: rgb(10, 20, 30) });
    }
    const css = '.l { list-style-type: decimal; } .a::marker { color: rgb(0, 0, 200); }';
    const decimal = nativePrograms(compile(css), []);
    if (decimal.kind !== 'ready') throw new Error(decimal.reason);
    for (const p of Object.values(decimal.programs)) {
      const color = (id: string) => p.nodes.find((x) => x.id === id)?.writes.find((w) => w.kind === 'text-color');
      expect(color('li::marker:text0')).toMatchObject({ color: rgb(0, 0, 200) });
      expect(color('li2::marker:text0')).toMatchObject({ color: rgb(10, 20, 30) });
      expect(color('li:text0')).toMatchObject({ color: rgb(10, 20, 30) });
    }
    expect(resolvedTextColors(compile(css), [])?.get('li::marker:text0')).toEqual(rgb(0, 0, 200));
  });

  it('is written as .cls::marker on the web only where it is not inherited', () => {
    const c = compile('.a::marker { color: rgb(0, 0, 200); } li::marker { color: currentcolor; }');
    expect(messages(c)).toEqual([]);
    if (c.outputs.web.kind !== 'ready') throw new Error('web blocked');
    const out = (c.outputs.web.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
    const classOf = webClassMap(c, []) as ReadonlyMap<string, string>;
    expect(out).toContain(`\n.${classOf.get('li') as string}::marker {\n  color: rgb(0, 0, 200);\n}`);
    expect(out).not.toContain(`.${classOf.get('li2') as string}::marker`);
    expect((out.match(/::marker/g) ?? []).length).toBe(1);
  });
});
