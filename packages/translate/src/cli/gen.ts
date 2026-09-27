// pnpm run native:gen: rewrites packages/layout/generated from packages/layout/src, and the corpus lock.
import { writeFileSync } from 'node:fs';
import { LOCK, lockText } from '../check.ts';
import { buildCorpus } from '../corpus.ts';
import { buildExtendedCorpus, EXTENDED_LOCK, extendedLockText } from '../corpus-dpr.ts';
import { KOTLIN_DIR, kotlinFiles, lowerAll, SWIFT_DIR, swiftFiles, writeTree } from '../generate.ts';

const l = lowerAll();
const swift = swiftFiles(l);
const kotlin = kotlinFiles(l);
writeTree(SWIFT_DIR, swift);
writeTree(KOTLIN_DIR, kotlin);
const c = buildCorpus();
writeFileSync(LOCK, lockText(c));
const x = buildExtendedCorpus();
writeFileSync(EXTENDED_LOCK, extendedLockText(x));
console.log(`native:gen: ${swift.size} Swift files, ${kotlin.size} Kotlin files; corpus ${c.suites.map((s) => `${s.name} ${s.lines.length}`).join(', ')}; digest ${c.digest}`);
console.log(`native:gen: extended corpus ${x.suites.map((s) => `${s.name} ${s.lines.length}`).join(', ')}; digest ${x.digest}`);
