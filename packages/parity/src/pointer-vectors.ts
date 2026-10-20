// MQ-R2 (notes/T067-mq-r-spec.md R9, §4): the pointer suite's vectors (packages/layout/rt-vectors/pointer/cases.json). Every set of
// input devices over the sources the Android rule reads, with the readings Chromium's own Java rule gives them
// (packages/parity/java/PointerRule.java, compiled and run on the host's JDK): one device with every combination of nine sources
// (the five the rule reads and four it ignores, some sharing their class bits), no device, and two devices over every
// combination of the five. The translate corpus runs the sets on Dragon's port (rt-band.ts androidPointerReadings) in TypeScript,
// Swift and Kotlin, and pointer-vectors.test.ts holds the port to the Java answers. The Java answers are recorded, so neither the
// corpus nor the test needs a JDK.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rtBand } from '@dragon/layout';
import { repoPath } from './paths.ts';

export const POINTER_VECTORS_PATH = 'packages/layout/rt-vectors/pointer/cases.json';
export const POINTER_VECTORS_SCHEMA = 'dragon-pointer-vectors/1';
export const POINTER_RULE_JAVA = 'packages/parity/java/PointerRule.java';

/** The sources the rule reads, and four it ignores (keyboard, d-pad, relative mouse, Bluetooth stylus), as android.view.InputDevice has them. */
export const RULE_SOURCES: readonly number[] = [rtBand.SOURCE_TOUCHSCREEN, rtBand.SOURCE_MOUSE, rtBand.SOURCE_STYLUS, rtBand.SOURCE_TRACKBALL, rtBand.SOURCE_TOUCHPAD];
export const OTHER_SOURCES: readonly number[] = [0x00000101, 0x00000201, 0x00020004, 0x0000c002];

/** The readings, as the Java rule prints them and the vectors hold them. */
export type JavaReadings = readonly [string, boolean, boolean, boolean, boolean];

const or = (bits: readonly number[]): number => bits.reduce((a, b) => a | b, 0);
const subsets = (xs: readonly number[]): number[][] => Array.from({ length: 1 << xs.length }, (_, m) => xs.filter((_, i) => (m & (1 << i)) !== 0));

/** Every device set the vectors cover, in a fixed order. */
export function pointerDeviceSets(): number[][] {
  const one = subsets([...RULE_SOURCES, ...OTHER_SOURCES]).map((s) => [or(s)]);
  const five = subsets(RULE_SOURCES).map(or);
  const two = five.flatMap((a) => five.map((b) => [a, b]));
  return [[], ...one, ...two];
}

/** Runs Chromium's Java rule on every device set: compiled into a temporary directory with the host's javac and run with java. */
export function javaReadings(sets: readonly (readonly number[])[], javaHome: string): JavaReadings[] {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-pointer-rule-'));
  try {
    execFileSync(join(javaHome, 'bin', 'javac'), ['-d', dir, repoPath(POINTER_RULE_JAVA)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = execFileSync(join(javaHome, 'bin', 'java'), ['-cp', dir, 'PointerRule'], { input: `${sets.map((s) => s.join(' ')).join('\n')}\n`, encoding: 'utf8', maxBuffer: 64 << 20 });
    const lines = out.trimEnd().split('\n');
    if (lines.length !== sets.length) throw new Error(`the Java rule answered ${lines.length} lines for ${sets.length} device sets`);
    return lines.map((l, i) => {
      const [pointer, ...flags] = l.split(' ');
      if ((pointer !== 'none' && pointer !== 'coarse' && pointer !== 'fine') || flags.length !== 4 || flags.some((f) => f !== 'true' && f !== 'false')) throw new Error(`line ${i}: the Java rule answered ${JSON.stringify(l)}`);
      return [pointer, flags[0] === 'true', flags[1] === 'true', flags[2] === 'true', flags[3] === 'true'] as const;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const view = new DataView(new ArrayBuffer(8));
/** A double's bit pattern as 16 hex digits, as the translate corpus writes numbers (translate/harness/host.ts bitsHex). */
function bitsHex(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

/** The vectors file: each device set's sources as bits and its sources as numbers, with the Java rule's readings. */
export function pointerVectorsJson(javaHome: string): string {
  const sets = pointerDeviceSets();
  const java = javaReadings(sets, javaHome);
  const cases = sets.map((s, i) => ({ devices: s, sources: s.map(bitsHex), java: java[i] }));
  return `${JSON.stringify({ schema: POINTER_VECTORS_SCHEMA, rule: 'TouchDevice.availablePointerAndHoverTypes and pointer_device_android.cc at 145.0.7632.6', cases }, null, 1)}\n`;
}
