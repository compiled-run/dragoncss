// @charset (css-syntax-3 §3.2, css/at-rules/charset.ts): `@charset "utf-8";` at the very start of a sheet is a no-op
// on every target, as Chrome drops it; every other form is refused. The parity group charset proves the no-op against Chrome:
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
  it('refuses another encoding, a form the encoding sniffer does not read, and any @charset not at the start', () => {
    const refused = (text: string): string => {
      const d = parse(text).diagnostics;
      expect(d.length, text).toBe(1);
      return d[0] as string;
    };
    expect(refused('@charset "iso-8859-1";')).toContain('its encoding iso-8859-1 is not UTF-8');
    expect(refused('@charset "utf8";')).toContain('its encoding utf8 is not UTF-8');
    for (const t of ["@charset 'utf-8';", '@CHARSET "utf-8";', '@charset  "utf-8";', '@charset "utf-8" ;', '@charset utf-8;']) expect(refused(t), t).toContain('as the encoding sniffer requires');
    for (const t of [' @charset "utf-8";', '\n@charset "utf-8";', '.a { width: 1px; } @charset "utf-8";', '@media (min-width: 1px) { @charset "utf-8"; }']) expect(refused(t), t).toContain('not at the very start');
  });
  it('renders in Chrome exactly as the same sheet without it (committed captures, both directions)', () => {
    const none = read('packages/parity/fixtures/charset-none.html');
    for (const [id, line] of [['charset-utf8', '@charset "utf-8";'], ['charset-utf8-upper', '@charset "UTF-8";']] as const) {
      expect(read(`packages/parity/fixtures/${id}.html`).replace(`<style>${line}\n`, '<style>\n'), id).toBe(none);
      for (const suffix of ['', '-rtl']) {
        const capture = (f: string): string => read(`packages/parity/expected/darwin-arm64/${f}${suffix}.web.json`).replaceAll(f, '<fixture>');
        expect(capture(id), `${id}${suffix}`).toBe(capture('charset-none'));
      }
    }
  });
});
