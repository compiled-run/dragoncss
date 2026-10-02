// CI runs packages/dragon without a browser (ci.yml: vitest run packages/layout packages/dragon), so no dragon test may import
// Playwright or launch Chrome; a check that needs Chrome goes to packages/parity/test (as grid-computed.test.ts did in a4c904c1).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/** Every TypeScript file under packages/dragon/test. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.m?ts$/.test(e.name) ? [p] : [];
  });
}

/** A static or dynamic import of Playwright, a browser launch, or parity's Chrome launcher (src/chrome.ts). */
const BROWSER_USE = /from\s+['"](?:playwright|playwright-core|@playwright\/test)['"]|import\(\s*['"`](?:playwright|playwright-core|@playwright\/test)['"`]|\blaunchChrome\b|\bchromium\s*\.\s*launch|['"`/]chrome\.ts['"`]/;

describe('the dragon suite runs without a browser', () => {
  it('no packages/dragon test imports Playwright or launches Chrome', () => {
    const files = sources(TEST_DIR).filter((f) => f !== SELF);
    expect(files.some((f) => f.endsWith('writing-mode.test.ts'))).toBe(true);
    const offenders = files.filter((f) => BROWSER_USE.test(readFileSync(f, 'utf8'))).map((f) => f.slice(TEST_DIR.length));
    expect(offenders).toEqual([]);
  });
  it('the guard catches each way a test reaches Chrome', () => {
    for (const planted of [
      "import { chromium } from 'playwright';",
      "const { chromium } = await import('playwright-core');",
      'const browser = await chromium.launch();',
      'const { launchChrome } = await load(\'chrome.ts\');',
      "await import(new URL('../../parity/src/chrome.ts', import.meta.url).href);",
    ]) expect(BROWSER_USE.test(planted), planted).toBe(true);
    for (const clean of ["import { compareDual } from '../../parity/src/dual.ts';", "expect(text).not.toMatch(/from '(node:[^']*|playwright)'/);"]) {
      expect(BROWSER_USE.test(clean), clean).toBe(false);
    }
  });
});
