import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultOrigin, parseValueText, resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { INHERITED, LONGHANDS } from '../src/css/properties.ts';
import { properties, webrefVersion } from '../src/css/grammar.generated.ts';
import { NO_FAULTS } from '../src/faults.ts';
import { borderWidthKeywords, chromeVersion, computed, platform, userAgentLonghands } from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { elementKeyComputed, elementKeyLonghands } from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { phrasingKeyComputed, phrasingKeyLonghands } from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import type { LinkedElement } from '../src/analysis/link.ts';

describe('captured Chrome defaults and the webref grammar', () => {
  it('pin Chrome 145.0.7632.6 and @webref/css 8.7.5, captured on darwin-arm64', () => {
    expect(chromeVersion).toBe('145.0.7632.6');
    expect(platform).toBe('darwin-arm64');
    expect(webrefVersion).toBe('8.7.5');
  });
  it('cover every longhand for every supported tag and an element with no UA rules', () => {
    for (const tag of Object.keys(computed) as (keyof typeof computed)[]) {
      for (const p of LONGHANDS) expect(computed[tag][p], `${tag} ${p}`).toBeTypeOf('string');
      for (const p of LONGHANDS) expect(properties[p], p).toBeDefined();
    }
    expect(computed.div.display).toBe('block');
    expect(computed.body['margin-top']).toBe('8px');
    expect(computed['dragon-unstyled'].display).toBe('inline');
    expect(borderWidthKeywords).toEqual({ thin: '1px', medium: '3px', thick: '5px' });
  });
});

// S1 must-fix 5: the user-agent versus initial origin of every longhand on every captured tag is pinned here, from the
// generated table (Chrome value versus the same element under "<longhand>: initial"), and the resolver must agree.
describe('UA versus initial origin, per tag and longhand', () => {
  it('pins the longhands a Chrome UA rule sets', () => {
    expect(userAgentLonghands).toEqual({
      html: [],
      body: ['display', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top'],
      div: ['display'],
      p: ['display', 'margin-bottom', 'margin-top'],
      h1: ['display', 'font-size', 'margin-bottom', 'margin-top'],
      h2: ['display', 'font-size', 'margin-bottom', 'margin-top'],
      h3: ['display', 'font-size', 'margin-bottom', 'margin-top'],
      h4: ['display', 'margin-bottom', 'margin-top'],
      h5: ['display', 'font-size', 'margin-bottom', 'margin-top'],
      h6: ['display', 'font-size', 'margin-bottom', 'margin-top'],
      section: ['display'],
      article: ['display'],
      header: ['display'],
      footer: ['display'],
      nav: ['display'],
      main: ['display'],
      aside: ['display'],
      ul: ['display', 'margin-bottom', 'margin-top', 'padding-left'],
      // GEN-b (T151 R13): ol's list-style-type: decimal is a modelled UA value now that list-style-type is a longhand.
      ol: ['display', 'list-style-type', 'margin-bottom', 'margin-top', 'padding-left'],
      li: ['display'],
      blockquote: ['display', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top'],
      figure: ['display', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top'],
      figcaption: ['display'],
      address: ['display'],
      hr: ['border-bottom-style', 'border-bottom-width', 'border-left-style', 'border-left-width', 'border-right-style', 'border-right-width', 'border-top-style', 'border-top-width', 'color', 'display', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top', 'overflow-x', 'overflow-y'],
      dl: ['display', 'margin-bottom', 'margin-top'],
      dt: ['display'],
      dd: ['display', 'margin-left'],
      'dragon-unstyled': [],
    });
  });

  const origin = { kind: 'unlocated', reason: 'test' } as const;
  const el = (id: string, tag: string, children: LinkedElement[] = []): LinkedElement => ({
    kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: [], attributes: new Map(), children,
    node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
  });
  const root = resolveTree(el('html', 'html', [el('body', 'body', [el('div', 'div')])]), [], NO_FAULTS, { direction: 'ltr', rootFont: 'ua-default', ua: referenceDataset() });
  const body = root.children[0];
  const div = body !== undefined && body.kind === 'element' ? body.children[0] : undefined;
  const byTag = { html: root, body, div } as const;
  for (const tag of ['html', 'body', 'div'] as const) {
    it(`${tag}: every longhand's origin and value with no author rules`, () => {
      const r = byTag[tag];
      if (r === undefined || r.kind !== 'element') throw new Error(tag);
      for (const p of LONGHANDS) {
        const v = r.props.get(p);
        const expected = defaultOrigin(tag, p, tag === 'html', referenceDataset(), 'ua-default');
        expect(v?.origin, `${tag} ${p}`).toBe(expected);
        expect(expected === 'user-agent', `${tag} ${p}`).toBe(userAgentLonghands[tag].includes(p));
        if (expected === 'user-agent') expect(valueToString(v?.value ?? { kind: 'keyword', value: '?' })).toBe(valueToString(parseValueText(p, computed[tag][p] as string)));
        if (expected === 'inherited') expect(INHERITED.has(p)).toBe(true);
      }
    });
  }
  it('the root display is blockified (css-display-3 §2.7), with initial origin', () => {
    expect(root.props.get('display')).toMatchObject({ value: { kind: 'keyword', value: 'block' }, origin: 'initial' });
  });
  it('the root direction is the environment direction (docs/api.md §7), with origin environment, and it is inherited', () => {
    const rtl = resolveTree(el('html', 'html', [el('body', 'body')]), [], NO_FAULTS, { direction: 'rtl', rootFont: 'ua-default', ua: referenceDataset() });
    expect(rtl.props.get('direction')).toMatchObject({ value: { kind: 'keyword', value: 'rtl' }, origin: 'environment', declaration: null });
    expect(root.props.get('direction')).toMatchObject({ value: { kind: 'keyword', value: 'ltr' }, origin: 'environment', declaration: null });
    const b = rtl.children[0];
    expect(b?.kind === 'element' && b.props.get('direction')).toMatchObject({ value: { kind: 'keyword', value: 'rtl' }, origin: 'inherited' });
  });
});

describe('dependency boundaries', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
  it('the web emitter reads only the resolved result: no ios lowering, no @dragon/layout, and no selector matching', () => {
    const text = readFileSync(join(src, 'emit', 'web-css.ts'), 'utf8');
    expect(text).not.toMatch(/lower\/ios-layout|@dragon\/layout/);
    const imports = [...text.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports).toEqual([
      "import type { ResolvedElement, ResolvedValue } from '../analysis/resolve.ts';",
      "import { serializeColor } from '../css/color.ts';",
      // CSSOM string serialization for family names (PR #28 round 2); no parsing or matching.
      "import { serializeString } from '../css/escapes.ts';",
      "import { LONGHANDS } from '../css/properties.ts';",
      "import type { CssValue } from '../css/stylesheet.ts';",
      // TXT1-C: the font-family rewrite through the font map, from the resolved value alone.
      "import { familyListText } from '../css/values.ts';",
      "import { parseFamilyList } from '../fonts/family-list.ts';",
      "import { outputFamilyName, rewriteFamilyList } from '../fonts/font-map.ts';",
      "import type { FontMap } from '../fonts/font-map.ts';",
      "import type { GeneratedFile } from '../types.ts';",
    ]);
    expect(text).not.toMatch(/selectorMatches|compoundMatches|\.selectors|\.classes|\.attributes|parseStylesheet|resolveTree/);
  });
  it('diagnostics are built only from the catalogue: no other source file sets a severity or a why', () => {
    for (const f of files(src)) {
      // The catalogue is catalogue.ts, its entry helpers (entry.ts) and each feature's entries (diagnostics/codes/<feature>.ts).
      if (f.endsWith(join('diagnostics', 'catalogue.ts')) || f.endsWith(join('diagnostics', 'entry.ts')) || f.includes(`${join('src', 'diagnostics', 'codes')}${sep}`) || f.endsWith('types.ts')) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/severity: '(error|warning|info)'|\bwhy: '/);
    }
  });
  it('colour conversion and rounding live only in css/color.ts', () => {
    for (const f of files(src)) {
      if (f.endsWith(join('css', 'color.ts'))) continue;
      // The font metrics port Blink's float32 arithmetic (Math.fround, floorf), so src/fonts/** is exempt by path.
      if (f.includes(`${join('src', 'fonts')}${sep}`)) continue;
      // The forms port Blink's Decimal and geometry math (LayoutUnit truncation), so src/forms/** is exempt by path.
      if (f.includes(`${join('src', 'forms')}${sep}`)) continue;
      // MQ-R0: media/viewport.ts reproduces Chrome's measured media size (float32 size, device px, int orientation and aspect-ratio read); only that file.
      if (f.endsWith(join('src', 'media', 'viewport.ts'))) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.(round|floor|ceil|trunc|fround)|toFixed|toPrecision/);
    }
  });
  it('the core imports @dragon/layout for types only and uses no Node built-ins or Playwright', () => {
    for (const f of files(src)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/^import (?!type )[^;]*from '@dragon\/layout'/m);
      expect(text, f).not.toMatch(/from '(node:[^']*|fs|path|child_process|url|module|playwright)'/);
      // No runtime module loading (type-only import() is fine). The one documented exception: digest.ts may feature-detect node:crypto as a fast path with an identical-output fallback.
      const dynamic = [...text.matchAll(/getBuiltinModule\(([^)]*)\)|\bawait import\(|\brequire\(/g)].map((m) => m[0]);
      expect(dynamic, f).toEqual(f.endsWith(join('src', 'digest.ts')) ? ["getBuiltinModule('node:crypto')"] : []);
    }
  });
});

// ELB-2: the element keys are captured into tables of their own; the pins above cover only the element-table tags.
describe('UA longhands of the element keys (ELB-2)', () => {
  it('pins the longhands a Chrome UA rule sets per element key', () => {
    expect(elementKeyLonghands).toEqual({
      button: ['background-color', 'border-bottom-style', 'border-bottom-width', 'border-left-style', 'border-left-width', 'border-right-style', 'border-right-width', 'border-top-style', 'border-top-width', 'box-sizing', 'font-family', 'font-size', 'padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'text-align'],
      input: ['background-color', 'border-bottom-color', 'border-bottom-style', 'border-bottom-width', 'border-left-color', 'border-left-style', 'border-left-width', 'border-right-color', 'border-right-style', 'border-right-width', 'border-top-color', 'border-top-style', 'border-top-width', 'font-family', 'font-size', 'padding-bottom', 'padding-left', 'padding-right', 'padding-top'],
      'input[type=range]': ['background-color', 'color', 'font-family', 'font-size', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top'],
      a: [],
      'a[href]': ['color'],
      img: ['overflow-x', 'overflow-y'],
      span: [],
    });
    for (const key of Object.keys(elementKeyComputed) as (keyof typeof elementKeyComputed)[]) {
      for (const p of LONGHANDS) expect(elementKeyComputed[key][p], `${key} ${p}`).toBeTypeOf('string');
    }
  });
});

describe('UA longhands of the phrasing keys (INL-U)', () => {
  it('pins the longhands a Chrome UA rule sets on br, strong, b, em, i, code, small, sub, sup and label', () => {
    expect(phrasingKeyLonghands).toEqual({
      br: [], strong: [], b: [], em: [], i: [], code: ['font-family'], small: ['font-size'], sub: ['font-size'], sup: ['font-size'], label: [],
    });
    for (const key of Object.keys(phrasingKeyComputed) as (keyof typeof phrasingKeyComputed)[]) {
      for (const p of LONGHANDS) expect(phrasingKeyComputed[key][p], `${key} ${p}`).toBeTypeOf('string');
    }
  });
});
