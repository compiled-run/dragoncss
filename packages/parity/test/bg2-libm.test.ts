// BG2 R3 (notes/T074-bg2-spec.md): the measured libm table. The probe's output is checked line by line before it becomes data, and
// the committed table is well formed: sorted unique inputs, results that differ from fdlibm, and the angles the bg2 Worker measured
// on the capture host with a separate C program (35 tanf slopes of whole and fractional degrees) reproduce from it.
import { describe, expect, it } from 'vitest';
import { COSF_DIFFS, LIBM_HOST, SINF_DIFFS, TANF_DIFFS } from '../../dragon/src/paint-data/libm-darwin-arm64.generated.ts';
import { parseProbe, tableText } from '../../../scripts/capture-libm.ts';

const view = new DataView(new ArrayBuffer(4));
const bitsOf = (f: number): number => {
  view.setFloat32(0, f);
  return view.getUint32(0);
};
const fromBits = (u: number): number => {
  view.setUint32(0, u);
  return view.getFloat32(0);
};

const UUID = 'uuid B54FBE99-DB0B-32C7-ABDD-C2206DF606A4';
const tanLines = (): string[] => Array.from({ length: 36000 }, (_, k) => {
  let a = Math.fround(k / 100) % 360;
  if (a < 0) a += 360;
  const x = Math.fround(Math.fround(90 - Math.fround(a)) * Math.fround(Math.fround(Math.PI) / 180));
  return `t ${bitsOf(x).toString(16).padStart(8, '0')} ${bitsOf(Math.fround(Math.tan(x))).toString(16).padStart(8, '0')}`;
});
const sinLines = (): string[] => Array.from({ length: 72001 }, (_, i) => {
  const r = Math.fround(Math.fround((i - 36000) / 100) * Math.fround(Math.fround(Math.PI) / 180));
  const h = (v: number): string => bitsOf(Math.fround(v)).toString(16).padStart(8, '0');
  return `s ${h(r)} ${h(Math.sin(r))} ${h(Math.cos(r))}`;
});

describe('libm:capture: the probe output', () => {
  const host = { macos: '26.6.2', build: '25G83' };
  it('turns a probe that agrees with fdlibm everywhere into an empty table', () => {
    const c = parseProbe([UUID, ...tanLines(), ...sinLines()].join('\n'), host);
    expect([c.tan.length, c.sin.length, c.cos.length, c.uuid]).toEqual([0, 0, 0, 'B54FBE99-DB0B-32C7-ABDD-C2206DF606A4']);
    expect(tableText(c)).toContain("export const LIBM_HOST = { platform: 'darwin-arm64', macos: '26.6.2', build: '25G83', libsystemM: 'B54FBE99-DB0B-32C7-ABDD-C2206DF606A4' } as const;");
  });
  it('keeps a result that differs from fdlibm, as input and output bits', () => {
    const t = tanLines();
    t[3500] = `${(t[3500] as string).slice(0, 11)}3f800001`;
    const c = parseProbe([UUID, ...t, ...sinLines()].join('\n'), host);
    expect(c.tan).toEqual([[Number.parseInt((t[3500] as string).slice(2, 10), 16), 0x3f800001]]);
  });
  it('refuses a probe without the libsystem_m UUID, with a malformed line, with lines missing, or with two results for one input', () => {
    expect(() => parseProbe(['uuid none', ...tanLines(), ...sinLines()].join('\n'), host)).toThrow(/found no libsystem_m UUID/);
    expect(() => parseProbe([UUID, ...tanLines(), 'x 1', ...sinLines()].join('\n'), host)).toThrow(/unexpected probe line "x 1"/);
    expect(() => parseProbe([UUID, ...tanLines().slice(1), ...sinLines()].join('\n'), host)).toThrow(/printed 35999 tan and 72001 sin\/cos lines/);
    const t = tanLines();
    const x = (t[0] as string).slice(2, 10);
    t[0] = `t ${x} 00000002`;
    t[1] = `t ${x} 00000001`;
    expect(() => parseProbe([UUID, ...t, ...sinLines()].join('\n'), host)).toThrow(`input ${Number.parseInt(x, 16).toString(16)} gave two results`);
  });
});

describe('the committed table (libm-darwin-arm64.generated.ts)', () => {
  it('names the capture host and holds sorted, unique inputs whose results differ from fdlibm', () => {
    expect(LIBM_HOST.platform).toBe('darwin-arm64');
    expect(LIBM_HOST.libsystemM).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    for (const [name, table, fn] of [['tan', TANF_DIFFS, Math.tan], ['sin', SINF_DIFFS, Math.sin], ['cos', COSF_DIFFS, Math.cos]] as const) {
      for (let i = 0; i < table.length; i++) {
        const [x, y] = table[i] as readonly [number, number];
        if (i > 0) expect(x, name).toBeGreaterThan((table[i - 1] as readonly [number, number])[0]);
        expect(bitsOf(Math.fround(fn(fromBits(x)))), `${name} ${x.toString(16)}`).not.toBe(y);
      }
    }
    // About 2,100 tan and 1,950 sin and cos entries (the spec's M1 measure; R3).
    expect([TANF_DIFFS.length > 2000, SINF_DIFFS.length + COSF_DIFFS.length > 1800]).toEqual([true, true]);
  });
  it('gives the tanf slopes measured on the capture host by a separate C program (the bg2 Worker\'s probe)', () => {
    const table = new Map(TANF_DIFFS.map(([x, y]) => [x, y]));
    const tanf = (x: number): number => {
      const y = table.get(bitsOf(x));
      return y === undefined ? Math.fround(Math.tan(x)) : fromBits(y);
    };
    const measured: readonly (readonly [number, number])[] = [
      [1.5533430576324463, 57.2900390625], [1.27409029006958, 3.2708518505096436], [1.0471975803375244, 1.732050895690918],
      [0.9948376417160034, 1.5398648977279663], [0.9197885394096375, 1.3126877546310425], [0.7853981852531433, 1],
      [0.008726646192371845, 0.008726867847144604], [-0.01745329238474369, -0.01745506562292576], [-0.3490658402442932, -0.36397022008895874],
      [-0.5838125944137573, -0.6606312394142151], [-0.7853981852531433, -1], [-1.5533430576324463, -57.2900390625],
      [-1.5882495641708374, 57.29014205932617], [-1.919862151145935, 2.7474777698516846], [-2.356194496154785, 1],
      [-2.862339973449707, 0.2867453694343567], [-2.879793167114258, 0.26794928312301636], [-2.96705961227417, 0.17632710933685303],
      [-3.1241393089294434, 0.017455117776989937], [-3.159045934677124, -0.017455052584409714], [-3.263765573501587, -0.12278443574905396],
      [-3.5081117153167725, -0.3838639259338379], [-3.647738218307495, -0.5543091893196106], [-3.665191411972046, -0.5773502588272095],
      [-3.769911050796509, -0.7265422940254211], [-3.9269907474517822, -0.9999998807907104], [-4.066617012023926, -1.3270444869995117],
      [-4.084070205688477, -1.376381278038025], [-4.363323211669922, -2.7474782466888428], [-4.572762489318848, -7.11536169052124],
      [-4.590215682983398, -8.144329071044922], [-4.607669353485107, -9.514375686645508], [-4.6949357986450195, -57.29032516479492],
      [1.5706217288970947, 5727.44580078125], [-4.712214469909668, -5730.31494140625],
    ];
    for (const [x, want] of measured) expect(tanf(x), String(x)).toBe(want);
    // 14 of them are table entries: fdlibm alone would miss them.
    expect(measured.filter(([x]) => table.has(bitsOf(x))).length).toBe(14);
  });
});
