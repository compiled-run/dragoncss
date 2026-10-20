// @charset (css-syntax-3 §3.2, css/at-rules/charset.ts): `@charset "utf-8";` at the very start of a sheet, and any @charset the
// encoding sniffer does not read, are a no-op on every target, as Chrome drops them; the sniffed form with another encoding is refused. The parity group charset proves the no-op against Chrome:
// each accepted fixture's committed capture equals charset-none's, in both directions.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const SRC = { uri: 's.css', revision: 'r', hash: 'h' };

function parse(text: string): { rules: number; diagnostics: string[] } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics);
  return { rules: rules.length, diagnostics: diagnostics.map((d) => `${d.code} ${d.message}`) };
}

describe('@charset', () => {
  it('accepts "utf-8" at the very start, the label ASCII case-insensitive, with no rule and no diagnostic', () => {
    for (const label of ['utf-8', 'UTF-8', 'Utf-8']) expect(parse(`@charset "${label}";\n.a { width: 1px; }`), label).toEqual({ rules: 1, diagnostics: [] });
  });
  it('refuses only the sniffed form at the very start with an encoding other than UTF-8', () => {
    const refused = (text: string): string => {
      const d = parse(text).diagnostics;
      expect(d.length, text).toBe(1);
      return d[0] as string;
    };
    expect(refused('@charset "iso-8859-1";')).toContain('its encoding iso-8859-1 is not UTF-8');
    expect(refused('@charset "utf8";')).toContain('its encoding utf8 is not UTF-8');
  });
  it('drops every @charset the encoding sniffer does not read, wherever it is, with no diagnostic', () => {
    for (const t of ["@charset 'utf-8';", '@CHARSET "iso-8859-1";', '@charset  "utf-8";', '@charset "utf-8" ;', '@charset utf-8;', ' @charset "iso-8859-1";', '\n@charset "utf-8";', '.a { width: 1px; } @charset "iso-8859-1";', '@media (min-width: 1px) { @charset "utf-8"; }', '@supports (display: flex) { @charset "utf-8"; }', '.a { @charset "utf-8"; width: 1px; }']) expect(parse(t).diagnostics, t).toEqual([]);
    expect(parse('.a { width: 1px; } @charset "iso-8859-1"; .b { width: 2px; }').rules).toBe(2);
  });
  it('renders in Chrome exactly as the same sheet without it (committed captures, both directions)', () => {
    const none = read('packages/parity/fixtures/charset-none.html');
    const forms: readonly (readonly [string, string, string])[] = [
      ['charset-utf8', '<style>@charset "utf-8";\n', '<style>\n'], ['charset-utf8-upper', '<style>@charset "UTF-8";\n', '<style>\n'],
      ['charset-late', '<style> @charset "utf-8";\n', '<style>\n'], ['charset-single-quotes', "<style>@charset 'utf-8';\n", '<style>\n'],
      ['charset-after-rules', '@charset "iso-8859-1";\n@media (min-width: 1px) { @charset "utf-8"; }\n</style>', '</style>'],
    ];
    for (const [id, line, without] of forms) {
      expect(read(`packages/parity/fixtures/${id}.html`).replace(line, without), id).toBe(none);
      for (const suffix of ['', '-rtl']) {
        const capture = (f: string): string => read(`packages/parity/expected/darwin-arm64/${f}${suffix}.web.json`).replaceAll(f, '<fixture>');
        expect(capture(id), `${id}${suffix}`).toBe(capture('charset-none'));
      }
    }
  });
});
