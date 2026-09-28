// pnpm run native:build -- --target ios|android [--plant ios-16|api-34]: builds the host app with every layout case from the
// generated sources (notes/T013-p3-review-p4-plan.md section 2 items 6 and 7), prints the case count and the sha256 of the source
// tree, and proves the API floor: swiftc availability checking at the iOS 15 target; on Android, every android.* reference of
// classes.dex at or below minSdk 31 (api-versions.xml). A planted fault must fail and name the API.
import { readFileSync } from 'node:fs';
import { checkFloor, parseApiVersions, parseDexdump } from '../api-floor.ts';
import { layoutCases } from '../dpr.ts';
import type { BuildPlant } from '../native-host.ts';
import { buildAndroid, buildIos, NATIVE_CONFIG, run } from '../native-host.ts';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] as string) : null;
};
const target = arg('--target');
const plant = arg('--plant') as BuildPlant | null;
if (target !== 'ios' && target !== 'android') {
  console.error('usage: native:build -- --target ios|android [--plant ios-16|api-34]');
  process.exit(2);
}
if (plant !== null && !(target === 'ios' ? ['ios-16'] : ['api-34']).includes(plant)) {
  console.error(`the ${target} build plants ${target === 'ios' ? 'ios-16' : 'api-34'}`);
  process.exit(2);
}
const declared = layoutCases().reduce((n, f) => n + f.cases.length, 0);

if (target === 'ios') {
  try {
    const r = buildIos({ plant });
    for (const l of r.log) console.log(`native:build ios: ${l}`);
    console.log(`native:build ios: ${r.cases} cases (layoutCases() ${declared}); source sha256 ${r.sourceSha256}`);
    console.log(`native:build ios: ${r.artifact}`);
    if (plant !== null) {
      console.error('native:build ios: the planted iOS 16-only reference built; the floor check did not catch it');
      process.exit(3);
    }
    if (r.cases !== declared) process.exit(1);
    console.log('native:build ios: API floor iOS 15.0: swiftc availability checking passed; status pass');
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    const availability = /is only available in iOS 16\.0 or newer/.exec(text);
    if (plant !== null && availability !== null) {
      const line = text.split('\n').find((l) => l.includes('is only available in iOS 16.0 or newer')) ?? availability[0];
      console.error(`native:build ios: planted ios-16 caught by swiftc availability checking: ${line.trim()}`);
      process.exit(1);
    }
    console.error(`native:build ios: ${text}`);
    process.exit(1);
  }
} else {
  let r: ReturnType<typeof buildAndroid>;
  try {
    r = buildAndroid({ plant });
  } catch (e) {
    console.error(`native:build android: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  for (const l of r.log) console.log(`native:build android: ${l}`);
  const bt = (t: string): string => join(r.tools.buildTools, t);
  const env = { ...process.env, JAVA_HOME: r.tools.javaHome };
  const verify = run(bt('apksigner'), ['verify', '--verbose', r.artifact], { env });
  console.log(`native:build android: apksigner verify: ${verify.status === 0 ? 'pass' : 'FAIL'} (${verify.out.split('\n').filter((l) => /Verified using v\d/.test(l) && /true/.test(l)).join('; ')})`);
  const badging = run(bt('aapt2'), ['dump', 'badging', r.artifact]);
  // aapt2 36.0.0 prints the floor as minSdkVersion:'31' (older aapt printed sdkVersion:'31').
  const sdk = /^(?:min)?[sS]dkVersion:'(\d+)'/m.exec(badging.out)?.[1];
  const targetSdk = /^targetSdkVersion:'(\d+)'/m.exec(badging.out)?.[1];
  const raw = badging.out.split('\n').filter((l) => /^(?:min|target)?[sS]dkVersion:/.test(l)).join(' ');
  console.log(`native:build android: aapt2 dump badging: ${raw} (floor ${sdk}, target ${targetSdk})`);
  console.log(`native:build android: ${r.cases} cases (layoutCases() ${declared}); source sha256 ${r.sourceSha256}`);
  console.log(`native:build android: ${r.artifact}`);
  const api = parseApiVersions(readFileSync(r.tools.apiVersions, 'utf8'));
  const dumps = r.dexes.map((d) => {
    const x = run(bt('dexdump'), ['-d', d]);
    if (x.status !== 0) throw new Error(`dexdump ${d} failed`);
    return x.out;
  });
  const dex = parseDexdump(dumps.join('\n'));
  const floor = checkFloor(api, dex, NATIVE_CONFIG.android.minSdk);
  console.log(`native:build android: API floor: ${floor.checked} android.* references checked in ${r.dexes.length} dex file(s); ${floor.guarded} call(s) into guarded Api<N> classes behind an explicit SDK_INT check; ${floor.violations.length} above API ${NATIVE_CONFIG.android.minSdk}`);
  for (const v of floor.violations) console.error(`native:build android: above the floor: ${v.ref} (${v.reason})`);
  const ok = verify.status === 0 && sdk === String(NATIVE_CONFIG.android.minSdk) && targetSdk === '36' && r.cases === declared && floor.violations.length === 0;
  if (plant !== null) {
    if (floor.violations.length > 0) {
      console.error(`native:build android: planted ${plant} caught: ${floor.violations.map((v) => v.ref).join(', ')}`);
      process.exit(1);
    }
    console.error(`native:build android: the planted ${plant} reference passed the floor check`);
    process.exit(3);
  }
  console.log(`native:build android: status ${ok ? 'pass' : 'fail'}`);
  process.exit(ok ? 0 : 1);
}
