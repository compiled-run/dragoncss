// MQ-R2: the committed pointer vectors (a MANUAL output, scripts/regen-steps/mq-r2.ts) recomputed from Chromium's Java rule on this
// host's JDK and compared byte for byte, so a stale file, or a PointerRule.java change without its vectors, fails here. It finds the
// JDK through the Kotlin toolchain lookup, so it runs on the native shards; with DRAGON_REQUIRE_NATIVE=1 a missing one fails.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';
import { POINTER_VECTORS_PATH, pointerVectorsJson } from '../src/pointer-vectors.ts';

type TranslateNative = {
  readonly kotlinTool: () => { readonly javaHome: string } | null;
  readonly missingToolchain: (subject: string, missing: string) => string;
};
const translateNative = async (): Promise<TranslateNative> => (await import(pathToFileURL(repoPath('packages/translate/src/native.ts')).href)) as TranslateNative;

describe('the pointer vectors against a fresh run of Chromium\'s Java rule', () => {
  it('equal the committed file byte for byte', { timeout: 300_000 }, async () => {
    const t = await translateNative();
    const tool = t.kotlinTool();
    if (tool === null) {
      console.log(t.missingToolchain('pointer vectors', 'no JDK 17+'));
      return;
    }
    const fresh = pointerVectorsJson(tool.javaHome);
    const committed = readFileSync(repoPath(POINTER_VECTORS_PATH), 'utf8');
    expect(fresh === committed, `${POINTER_VECTORS_PATH} is stale: run JAVA_HOME=<a JDK> pnpm run parity:pointer-vectors`).toBe(true);
    // The comparison sees a single flipped answer.
    const stale = committed.replace('"java": [\n    "none",\n    false', '"java": [\n    "none",\n    true');
    expect(stale).not.toBe(committed);
    expect(fresh === stale).toBe(false);
  });
});
