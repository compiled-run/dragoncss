// pnpm run native:encoders -- --target swift|kotlin (notes/T013-p3-review-p4-plan.md section 2 item 5): compiles the encoder
// emitted from NATIVE_DUMP_SCHEMA on the host (swiftc for macOS, kotlinc for the JVM) and encodes every layout case's reference dump
// at DPR 3, re-labelled to the language's device lane with deterministic non-null pixels, timing, baseline, start and end. Each
// output must parse, pass validateNativeDump and deep-equal the TS object. Each planted encoder fault must fail with its code.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EncoderFault, EncoderLanguage } from '../native-encoders.ts';
import { ENCODER_FAULT_CODES, ENCODER_FAULTS, encoderSource, plantEncoderFault } from '../native-encoders.ts';
import { relabelledReferenceDumps, runEncoder } from '../native-host.ts';
import { validateNativeDump } from '../native-dump.ts';
import { repoPath } from '../paths.ts';

const args = process.argv.slice(2);
const lang = args[args.indexOf('--target') + 1] as EncoderLanguage;
if (lang !== 'swift' && lang !== 'kotlin') {
  console.error('usage: native:encoders -- --target swift|kotlin');
  process.exit(2);
}
const log = (s: string): void => console.log(`native:encoders ${lang}: ${s}`);

const dumps = relabelledReferenceDumps(lang === 'swift' ? 'ios' : 'android', 3);
const dir = repoPath(`packages/parity/out/native/encoders/${lang}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const lines = runEncoder(lang, encoderSource(lang), dumps, join(dir, 'clean'));
log(`compiled and ran the encoder over ${dumps.length} reference dumps in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
let valid = 0;
let equal = 0;
let ordered = 0;
const problems: string[] = [];
dumps.forEach((want, i) => {
  const text = lines[i];
  if (text === undefined) {
    problems.push(`${want.case.id}: no output`);
    return;
  }
  const got = JSON.parse(text) as unknown;
  const v = validateNativeDump(got);
  if (v.ok) valid++;
  else problems.push(`${want.case.id}: ${v.errors.slice(0, 3).map((e) => `${e.path} ${e.code}`).join('; ')}`);
  if (JSON.stringify(got) === JSON.stringify(want)) equal++;
  else problems.push(`${want.case.id}: the encoded dump differs from the TS object`);
  // Keys in schema order: the TS object is built in schema order, so JSON text equality proves the order.
  if (text === JSON.stringify(want)) ordered++;
});
log(`${valid}/${dumps.length} parse and pass validateNativeDump; ${equal}/${dumps.length} deep-equal the TS object; ${ordered}/${dumps.length} byte-equal JSON.stringify of it (keys in schema order)`);
for (const p of problems.slice(0, 10)) console.error(`native:encoders ${lang}: ${p}`);

let caught = 0;
for (const fault of ENCODER_FAULTS) {
  const want = ENCODER_FAULT_CODES[fault as EncoderFault];
  const out = runEncoder(lang, plantEncoderFault(lang, encoderSource(lang), fault), dumps.slice(0, 1), join(dir, fault));
  const first = out[0];
  const v = first === undefined ? null : validateNativeDump(JSON.parse(first));
  const codes = v === null ? [] : v.ok ? [] : v.errors.map((e) => `${e.path} ${e.code}`);
  const hit = codes.some((c) => c.endsWith(` ${want}`));
  if (hit) caught++;
  log(`planted ${fault}: ${hit ? 'fails' : 'NOT CAUGHT'} with ${codes.slice(0, 3).join('; ') || 'no validation error'} (named code ${want})`);
}
writeFileSync(join(dir, 'summary.txt'), `${valid} ${equal} ${caught}\n`);
const ok = valid === dumps.length && equal === dumps.length && caught === ENCODER_FAULTS.length;
log(`status ${ok ? 'pass' : 'fail'}: ${valid}/${dumps.length} valid, ${equal}/${dumps.length} equal, ${caught}/${ENCODER_FAULTS.length} planted faults caught`);
process.exit(ok ? 0 : 1);
