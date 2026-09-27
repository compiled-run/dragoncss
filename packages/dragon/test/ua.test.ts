import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LONGHANDS } from '../src/css/properties.ts';
import { properties, webrefVersion } from '../src/css/grammar.generated.ts';
import { borderWidthKeywords, chromeVersion, computed } from '../src/ua/chrome-145.generated.ts';

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

describe('dependency boundaries', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
  it('the core imports @dragon/layout for types only and uses no Node built-ins or Playwright', () => {
    for (const f of files(src)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/^import (?!type )[^;]*from '@dragon\/layout'/m);
      expect(text, f).not.toMatch(/from '(node:[^']*|fs|path|child_process|url|module|playwright)'/);
    }
  });
});
