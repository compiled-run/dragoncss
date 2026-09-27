import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultOrigin, parseValueText, resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { INHERITED, LONGHANDS } from '../src/css/properties.ts';
import { properties, webrefVersion } from '../src/css/grammar.generated.ts';
import { NO_FAULTS } from '../src/faults.ts';
import { borderWidthKeywords, chromeVersion, computed, userAgentLonghands } from '../src/ua/chrome-145.generated.ts';
import type { LinkedElement } from '../src/analysis/link.ts';

describe('captured Chrome defaults and the webref grammar', () => {
  it('pin Chrome 145.0.7632.6 and @webref/css 8.7.5', () => {
    expect(chromeVersion).toBe('145.0.7632.6');
    expect(webrefVersion).toBe('8.7.5');
  });
  it('cover every longhand for html, body, div and an element with no UA rules', () => {
    for (const tag of ['html', 'body', 'div', 'dragon-unstyled'] as const) {
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
      'dragon-unstyled': [],
    });
  });

  const origin = { kind: 'unlocated', reason: 'test' } as const;
  const el = (id: string, tag: string, children: LinkedElement[] = []): LinkedElement => ({
    kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: [], attributes: new Map(), children,
    node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
  });
  const root = resolveTree(el('html', 'html', [el('body', 'body', [el('div', 'div')])]), [], NO_FAULTS);
  const body = root.children[0];
  const div = body !== undefined && body.kind === 'element' ? body.children[0] : undefined;
  const byTag = { html: root, body, div } as const;
  for (const tag of ['html', 'body', 'div'] as const) {
    it(`${tag}: every longhand's origin and value with no author rules`, () => {
      const r = byTag[tag];
      if (r === undefined || r.kind !== 'element') throw new Error(tag);
      for (const p of LONGHANDS) {
        const v = r.props.get(p);
        const expected = defaultOrigin(tag, p, tag === 'html');
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
      "import { LONGHANDS } from '../css/properties.ts';",
      "import type { CssValue } from '../css/stylesheet.ts';",
      "import type { GeneratedFile } from '../types.ts';",
    ]);
    expect(text).not.toMatch(/selectorMatches|compoundMatches|\.selectors|\.classes|\.attributes|parseStylesheet|resolveTree/);
  });
  it('diagnostics are built only from the catalogue: no other source file sets a severity or a why', () => {
    for (const f of files(src)) {
      if (f.endsWith(join('diagnostics', 'catalogue.ts')) || f.endsWith('types.ts')) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/severity: '(error|warning|info)'|\bwhy: '/);
    }
  });
  it('colour conversion and rounding live only in css/color.ts', () => {
    for (const f of files(src)) {
      if (f.endsWith(join('css', 'color.ts'))) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.(round|floor|ceil|trunc|fround)|toFixed|toPrecision/);
    }
  });
  it('the core imports @dragon/layout for types only and uses no Node built-ins or Playwright', () => {
    for (const f of files(src)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/^import (?!type )[^;]*from '@dragon\/layout'/m);
      expect(text, f).not.toMatch(/from '(node:[^']*|fs|path|child_process|url|module|playwright)'/);
    }
  });
});
