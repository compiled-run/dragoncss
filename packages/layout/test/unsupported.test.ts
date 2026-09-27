import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('LayoutUnsupported codes (M6)', () => {
  it('every UnsupportedCode is raised by the engine, so the union carries no dead code', () => {
    const declared = [...readFileSync(join(src, 'unsupported.ts'), 'utf8').matchAll(/^ {2}\| '([a-z-]+)'$/gm)].map((m) => m[1] as string);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).not.toContain('margin-collapse');
    const engine = readdirSync(src).filter((f) => f.endsWith('.ts') && f !== 'unsupported.ts').map((f) => readFileSync(join(src, f), 'utf8')).join('\n');
    for (const code of declared) expect(engine.includes(`unsupported('${code}'`), code).toBe(true);
  });
});
