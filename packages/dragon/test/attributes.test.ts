// Attributes as element data (notes/T025 §2 TREE items 1-3): the rendering-neutral table and its Chrome proof pairs, the refusals
// that name the package owning an attribute's effect, HTML's case-insensitive attribute list against Chrome's observed behaviour,
// and the Chrome selector-validity table against the north-star stylesheet.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import type { ElementNode } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { attributeRefusal, NEUTRAL_ATTRIBUTES, neutralAttribute } from '../src/attributes.ts';
import { dimensionRefusal, parseDimension, presentationalHints } from '../src/analysis/elements/replaced.ts';
import { HTML_CASE_INSENSITIVE_ATTRIBUTES } from '../src/analysis/match.ts';
import { OBSERVED_ATTRIBUTE_CASE_INSENSITIVE, PSEUDO_CLASS_VALID, PSEUDO_ELEMENT_VALID, SELECTOR_VALIDITY_CHROME } from '../src/css/selector-validity.generated.ts';
import { always, div, expectCatalogued, inputFor } from './helpers.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');

describe('the rendering-neutral attribute table', () => {
  it('each entry cites HTML and names an attr-neutral fixture registered in both directions', () => {
    const group = read('packages/parity/src/fixture-groups/attributes.ts');
    for (const e of [...NEUTRAL_ATTRIBUTES.map((x) => x.proof), 'attr-neutral-none']) {
      expect(existsSync(join(REPO, `packages/parity/fixtures/${e}.html`)), e).toBe(true);
      expect(group, e).toContain(`both('${e}')`);
    }
    for (const e of NEUTRAL_ATTRIBUTES) expect(e.html, e.name).toMatch(/HTML §/);
  });

  it('each proof fixture carries its attribute on the root, body, block elements and headings, and equals the pair without it', () => {
    const none = read('packages/parity/fixtures/attr-neutral-none.html');
    for (const e of NEUTRAL_ATTRIBUTES) {
      const html = read(`packages/parity/fixtures/${e.proof}.html`);
      const tags = [...html.matchAll(/<([a-z0-9]+) data-dragon-id="[^"]*"[^>]*?((?: [a-z-]+="[^"]*")*)>/g)];
      for (const t of ['html', 'body', 'div', 'p', 'section', 'h1', 'h2', 'h4']) {
        const hit = tags.find((m) => m[1] === t);
        expect(hit?.[2] !== undefined && [...(hit[2] as string).matchAll(/ ([a-z-]+)=/g)].some((a) => neutralAttribute(t, a[1] as string) === e), `${e.proof} <${t}>`).toBe(true);
      }
      // Removing the attribute gives exactly the pair.
      const bare = html.replace(new RegExp(` ${e.name.endsWith('-') ? `${e.name}(?!dragon-id)[a-z-]+` : e.name}="[^"]*"`, 'g'), '');
      expect(bare, e.proof).toBe(none);
      for (const suffix of ['', '-rtl']) {
        const capture = (id: string): string => read(`packages/parity/expected/darwin-arm64/${id}${suffix}.web.json`).replaceAll(id, '<fixture>');
        expect(capture(e.proof), `${e.proof}${suffix}: Chrome must render it exactly as attr-neutral-none`).toBe(capture('attr-neutral-none'));
      }
    }
  });

  it('admits families and exact names, except rel and target on hyperlink tags', () => {
    expect(neutralAttribute('div', 'data-video-id')?.name).toBe('data-');
    expect(neutralAttribute('div', 'data-')).toBeUndefined();
    expect(neutralAttribute('div', 'aria-label')?.name).toBe('aria-');
    expect(neutralAttribute('div', 'rel')?.name).toBe('rel');
    expect(neutralAttribute('a', 'rel')).toBeUndefined();
    expect(neutralAttribute('link', 'target')).toBeUndefined();
    expect(neutralAttribute('div', 'titles')).toBeUndefined();
    // HTML lowercases attribute names; a mixed-case name would miss its lowercased selector.
    expect(neutralAttribute('div', 'data-X')).toBeUndefined();
    expect(neutralAttribute('div', 'ID')).toBeUndefined();
  });
});

describe('refused attributes name the package that owns their effect', () => {
  it.each([
    ['input', 'type', 'FORM-a'], ['input', 'min', 'FORM-a'], ['input', 'max', 'FORM-a'], ['input', 'value', 'FORM-a'],
    ['div', 'src', 'REPL'], ['div', 'alt', 'REPL'], ['div', 'width', 'REPL'], ['div', 'height', 'REPL'], ['iframe', 'alt', 'REPL'],
    ['a', 'href', 'INL1'], ['a', 'rel', 'INL1'], ['a', 'target', 'INL1'], ['html', 'lang', 'TXT1-C'], ['div', 'dir', 'bidi'],
    ['div', 'hidden', 'display'], ['div', 'style', 'SOV'], ['div', 'tabindex', 'not proven neutral'],
    ['div', 'constructor', 'not proven neutral'], ['div', 'toString', 'not proven neutral'],
  ])('<%s %s> names %s', (tag, name, owner) => {
    expect(attributeRefusal(tag, name)).toContain(owner);
  });

  it('REPL-a handles src, alt, width and height on img, and width and height on iframe', () => {
    for (const name of ['src', 'alt', 'width', 'height']) expect(attributeRefusal('img', name), name).toBeNull();
    for (const name of ['width', 'height']) expect(attributeRefusal('iframe', name), name).toBeNull();
  });

  it('refuses an iframe src until Phase B loads it in the web view (Macroscope 4164413918), rather than dropping it', () => {
    expect(attributeRefusal('iframe', 'src')).toContain('REPL-a Phase B');
  });

  it('compiles neutral attributes silently and refuses the others with the owner in the message', () => {
    const attr = (name: string, value: string) => ({ name, value: [{ when: always, value }], origin: { kind: 'unlocated', reason: 'test' } as const });
    const tree = (attrs: [string, string][]) => inputFor('.a { width: 1px; }', (r) => [{ ...div(r, 'a', ['a']), attributes: attrs.map(([n, v]) => attr(n, v)) } as ElementNode]);
    const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
    expect(project.compile(tree([['id', 'x'], ['data-x', '1'], ['aria-label', 'l'], ['role', 'note'], ['title', 't'], ['ui-x', '1'], ['rel', 'r'], ['target', '_blank']])).diagnostics).toEqual([]);
    const c = project.compile(tree([['href', '#'], ['lang', 'en']]));
    expect(c.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['DRAGON_UNSUPPORTED_ATTRIBUTE', 'attribute href on a is not supported: its rendering effect belongs to the inline and link package INL1 (an href makes the :link UA rules apply)'],
      ['DRAGON_UNSUPPORTED_ATTRIBUTE', 'attribute lang on a is not supported: its rendering effect belongs to the text package TXT1-C (lang feeds locale font fallback)'],
    ]);
    expectCatalogued(c.diagnostics);
  });
});

describe('Chrome observations (scripts/capture-selector-validity.ts)', () => {
  it('is captured in the pinned Chrome', () => {
    expect(SELECTOR_VALIDITY_CHROME).toBe('145.0.7632.6');
  });

  it('HTML\'s case-insensitive attribute list is exactly what Chrome folds', () => {
    const observed = Object.entries(OBSERVED_ATTRIBUTE_CASE_INSENSITIVE);
    expect(observed.filter(([, v]) => v).map(([k]) => k).sort()).toEqual([...HTML_CASE_INSENSITIVE_ATTRIBUTES].sort());
    expect(HTML_CASE_INSENSITIVE_ATTRIBUTES.size).toBe(46);
    for (const name of ['id', 'class', 'data-x', 'title', 'role', 'aria-label', 'href', 'value', 'ui-x']) expect(OBSERVED_ATTRIBUTE_CASE_INSENSITIVE[name], name).toBe(false);
  });

  it('covers every non-functional pseudo of the north-star stylesheet; -moz- ones are invalid, the -webkit- ones Chrome keeps', () => {
    const css = read('examples/music-player/styles.css');
    const seen: string[] = [];
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      const node = value as CssNode & { toArray?: () => unknown[] };
      if (typeof node.toArray === 'function') return node.toArray().forEach(visit);
      if ((node.type === 'PseudoElementSelector' || node.type === 'PseudoClassSelector') && node['children'] === null) {
        const table = node.type === 'PseudoElementSelector' ? PSEUDO_ELEMENT_VALID : PSEUDO_CLASS_VALID;
        expect(table[String(node['name']).toLowerCase()], generate(node)).toBeDefined();
        seen.push(generate(node));
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc') visit(v);
    };
    visit(parse(css));
    expect(seen.length).toBeGreaterThan(0);
    expect(PSEUDO_ELEMENT_VALID['-moz-range-thumb']?.valid).toBe(false);
    for (const n of ['-webkit-slider-thumb', '-webkit-scrollbar', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track', 'before']) expect(PSEUDO_ELEMENT_VALID[n]?.valid, n).toBe(true);
    // CSS.supports and rule survival agree on every name but one UA-internal pseudo-element, which a style rule still keeps.
    const disagree = Object.entries({ ...PSEUDO_ELEMENT_VALID }).filter(([, v]) => v.valid !== v.supports).map(([k]) => k);
    expect(disagree).toEqual(['-webkit-outer-spin-button']);
    expect(Object.values(PSEUDO_CLASS_VALID).every((v) => v.valid === v.supports)).toBe(true);
  });
});

describe('REPL-a width and height attributes (HTML §2.3.4.4 dimension values, §15.4.5 hints)', () => {
  const LONG = '9'.repeat(400);

  it('parses lengths and percentages after leading ASCII white space and ignores what follows the number', () => {
    expect(parseDimension('100')).toEqual({ kind: 'length', value: 100 });
    expect(parseDimension(' \t\n50.5px')).toEqual({ kind: 'length', value: 50.5 });
    expect(parseDimension('25%')).toEqual({ kind: 'percentage', value: 25 });
    expect(parseDimension('10.')).toEqual({ kind: 'length', value: 10 });
    expect(parseDimension('1e5')).toEqual({ kind: 'length', value: 1 });
    expect(parseDimension('0')).toEqual({ kind: 'length', value: 0 });
  });

  it('takes no number from a value that does not start with a digit, or whose digits overflow a double', () => {
    for (const t of ['', 'abc', '-5', '+5', '.5', '\u00a07', LONG, `${LONG}%`]) expect(parseDimension(t), t.slice(0, 12)).toBeNull();
  });

  it('maps an img\'s two lengths to auto && ratio, a percentage only to its own property, and nothing on other tags', () => {
    const hints = (tag: string, attrs: Record<string, string>) => Object.fromEntries(presentationalHints(tag, new Map(Object.entries(attrs))));
    expect(hints('img', { width: '90', height: '30' })).toEqual({
      width: { kind: 'length', value: 90, unit: 'px' },
      height: { kind: 'length', value: 30, unit: 'px' },
      'aspect-ratio': { kind: 'ratio', auto: true, width: 90, height: 30 },
    });
    expect(hints('img', { width: '90', height: '25%' })).toEqual({ width: { kind: 'length', value: 90, unit: 'px' }, height: { kind: 'percentage', value: 25 } });
    expect(hints('iframe', { width: '120', height: '40' })).toEqual({ width: { kind: 'length', value: 120, unit: 'px' }, height: { kind: 'length', value: 40, unit: 'px' } });
    expect(hints('div', { width: '90', height: '30' })).toEqual({});
    expect(hints('img', { width: LONG, height: '30' })).toEqual({ height: { kind: 'length', value: 30, unit: 'px' } });
  });

  it('refuses a width or height whose digits overflow a double, on replaced tags only', () => {
    expect(dimensionRefusal('img', 'width', LONG)).toContain('400 digits');
    expect(dimensionRefusal('iframe', 'height', ` ${LONG}.5%`)).toContain('400 digits');
    expect(dimensionRefusal('img', 'width', '99999999')).toBeNull();
    expect(dimensionRefusal('img', 'width', 'abc')).toBeNull();
    expect(dimensionRefusal('img', 'alt', LONG)).toBeNull();
    expect(dimensionRefusal('div', 'width', LONG)).toBeNull();
  });

  it('a compile reports the overflowing attribute as DRAGON_UNSUPPORTED_ATTRIBUTE', () => {
    const attr = (name: string, value: string) => ({ name, value: [{ when: always, value }], origin: { kind: 'unlocated', reason: 'test' } as const });
    const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
    const tree = (w: string) => inputFor('.a { display: block; }', (r) => [{ ...div(r, 'a', ['a']), tag: 'iframe', attributes: [attr('width', w), attr('height', '10')] } as ElementNode]);
    const bad = project.compile(tree(LONG)).diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_ATTRIBUTE');
    expect(bad.map((d) => d.message)).toEqual(['attribute width on a is not supported: its value starts with 400 digits, past the range of a length']);
    expectCatalogued(bad);
    expect(project.compile(tree('99999999')).diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_ATTRIBUTE')).toEqual([]);
  });
});
