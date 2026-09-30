// T029: the device replay passes only on the exact expected output. A crash, a partial run or a wrong mismatch is never
// read as "equal" or as "plant caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeDeviceRun, offByOneMismatch, transcriptCounts } from '../scripts/replay-device.ts';
import { GATE_TRANSCRIPT_PATH, PACKAGE_DIR } from '../scripts/replay.ts';
import { parseTranscript, sha256Hex } from '../src/index.ts';

const t = parseTranscript(readFileSync(GATE_TRANSCRIPT_PATH, 'utf8'));
const n = transcriptCounts(t);
const summary = (calls: number, mismatches: number): string =>
  `replay swift (ios simulator, arm64): ${calls} calls (${n.shapeCalls} shape, ${n.glyphs} glyphs), ${mismatches} mismatches\n`;

describe('judgeDeviceRun', () => {
  it('counts the gate transcript the way the Swift and Kotlin replays report it', () => {
    expect(n).toEqual({ calls: 4820, shapeCalls: 1100, glyphs: 45544 });
  });

  it('passes an unplanted run with every call replayed and no mismatch', () => {
    expect(judgeDeviceRun(t, undefined, 0, summary(n.calls, 0))).toBeNull();
  });

  it('fails an unplanted run that is short, mismatched, noisy, errored or exits non-zero', () => {
    expect(judgeDeviceRun(t, undefined, 0, summary(n.calls - 1, 0))).toMatch(/replayed 4819 calls/);
    expect(judgeDeviceRun(t, undefined, 1, summary(n.calls, 1) + offByOneMismatch(t))).toMatch(/exit 1, 1 mismatches/);
    expect(judgeDeviceRun(t, undefined, 0, `${summary(n.calls, 0)}stray line\n`)).not.toBeNull();
    expect(judgeDeviceRun(t, undefined, 0, `${summary(n.calls, 0)}${summary(n.calls, 0)}`)).toMatch(/one summary line, got 2/);
    expect(judgeDeviceRun(t, undefined, 1, 'replay swift (ios simulator, arm64): error: bad transcript: format\n')).toMatch(/one summary line, got 0/);
    expect(judgeDeviceRun(t, undefined, 139, summary(n.calls, 0))).toMatch(/exit 139/);
    expect(judgeDeviceRun(t, undefined, 0, '')).not.toBeNull();
  });

  it('passes the off-by-one plant only when exactly the planted integer mismatches', () => {
    const line = offByOneMismatch(t);
    expect(line).toMatch(/^ {2}MISMATCH call \d+ shape: int 2: -?\d+, expected -?\d+$/);
    expect(judgeDeviceRun(t, 'off-by-one', 1, `${summary(n.calls, 1)}${line}\n`)).toBeNull();
    // Caught somewhere else, caught twice, a crash, or a zero exit: none of these is the plant being caught.
    expect(judgeDeviceRun(t, 'off-by-one', 1, `${summary(n.calls, 1)}${line.replace(/call \d+/, 'call 99999')}\n`)).not.toBeNull();
    expect(judgeDeviceRun(t, 'off-by-one', 1, `${summary(n.calls, 2)}${line}\n${line}\n`)).not.toBeNull();
    expect(judgeDeviceRun(t, 'off-by-one', 1, 'replay swift (ios simulator, arm64): error: EXC_BAD_ACCESS\n')).not.toBeNull();
    expect(judgeDeviceRun(t, 'off-by-one', 0, `${summary(n.calls, 1)}${line}\n`)).toMatch(/exit 0/);
    expect(judgeDeviceRun(t, 'off-by-one', 1, `${summary(n.calls - 1, 1)}${line}\n`)).toMatch(/replayed 4819 calls/);
  });

  it('passes the bad-index and fractional-index plants only on the refusal naming them', () => {
    const f = t.fonts.length;
    expect(judgeDeviceRun(t, 'bad-index', 1, `replay kotlin (android, aarch64): error: java.lang.IllegalArgumentException: bad transcript: call.font ${f} of ${f}\n`)).toBeNull();
    expect(judgeDeviceRun(t, 'bad-index', 1, 'replay kotlin (android, aarch64): error: java.lang.OutOfMemoryError\n')).not.toBeNull();
    expect(judgeDeviceRun(t, 'bad-index', 0, `replay x: error: bad transcript: call.font ${f} of ${f}\n`)).toMatch(/exit 0/);
    expect(judgeDeviceRun(t, 'fractional-index', 1, 'replay swift (ios simulator, arm64): error: bad transcript: call.font 0.5\n')).toBeNull();
    expect(judgeDeviceRun(t, 'fractional-index', 1, summary(n.calls, 0))).not.toBeNull();
  });
});

describe('committed device results (transcripts/device)', () => {
  const committed = readFileSync(GATE_TRANSCRIPT_PATH);
  for (const [platform, target] of [['ios', 'swift (ios simulator, arm64)'], ['android', 'kotlin (android, aarch64)']] as const) {
    it(`${platform}: replayed the current transcript on device with every call equal`, () => {
      const lines = readFileSync(join(PACKAGE_DIR, 'transcripts', 'device', `${platform}.txt`), 'utf8').split('\n');
      expect(lines[0]).toBe(`transcript: packages/text-shaper/transcripts/gate.json sha256 ${sha256Hex(committed)}, recorded by dragon_hb.wasm sha256 ${t.wasmSha256}`);
      expect(lines[1]).toMatch(/^device: .+ (simulator|emulator), (arm64|arm64-v8a|x86_64)$/);
      expect(lines.slice(2)).toEqual([`replay ${target}: ${n.calls} calls (${n.shapeCalls} shape, ${n.glyphs} glyphs), 0 mismatches`, '']);
    });
  }
});
