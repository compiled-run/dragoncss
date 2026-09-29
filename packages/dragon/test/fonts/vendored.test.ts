// The vendored OFL fonts: each SHA-256 and byte count matches vendor/fonts/README.md, each family carries its OFL.txt, the
// spec's eight capture faces stay within the ~4 MB budget of notes/T004-txt1c-spec.md §3, and the north star's Lato (T035
// ruling) is exactly its two faces.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vendor = new URL('../../../../vendor/fonts/', import.meta.url);
const readme = readFileSync(new URL('README.md', vendor), 'utf8');
const rows = [...readme.matchAll(/^\| ([A-Za-z]+\/[\w-]+\.ttf) \| `([0-9a-f]{64})` \| ([\d,]+) \|$/gm)].map((m) => ({ file: m[1] as string, sha: m[2] as string, bytes: Number((m[3] as string).replace(/,/g, '')) }));

describe('vendored fonts', () => {
  it('lists the eight OFL faces of the spec and the two Lato faces of the north star', () => {
    expect(rows.map((r) => r.file).sort()).toEqual([
      'Inter/Inter-Bold.ttf', 'Inter/Inter-BoldItalic.ttf', 'Inter/Inter-Italic.ttf', 'Inter/Inter-Light.ttf', 'Inter/Inter-Regular.ttf',
      'Lato/Lato-Bold.ttf', 'Lato/Lato-Regular.ttf',
      'NotoSans/NotoSans-Regular.ttf', 'NotoSansMono/NotoSansMono-Regular.ttf', 'Roboto/Roboto-Regular.ttf',
    ]);
  });

  it.each(rows)('$file matches its README SHA-256 and byte count', ({ file, sha, bytes }) => {
    const data = readFileSync(new URL(file, vendor));
    expect(createHash('sha256').update(data).digest('hex')).toBe(sha);
    expect(data.length).toBe(bytes);
  });

  it('carries an OFL.txt per family and stays within about 4 MB', () => {
    for (const family of new Set(rows.map((r) => r.file.split('/')[0] as string))) {
      expect(readFileSync(new URL(`${family}/OFL.txt`, vendor), 'utf8')).toContain('SIL Open Font License, Version 1.1');
    }
    const size = (rs: typeof rows): number => rs.reduce((n, r) => n + statSync(new URL(r.file, vendor)).size, 0);
    const lato = rows.filter((r) => r.file.startsWith('Lato/'));
    expect(size(rows.filter((r) => !lato.includes(r)))).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(size(lato)).toBe(656_568 + 656_544);
  });
});
