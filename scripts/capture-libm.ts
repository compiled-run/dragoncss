// pnpm run libm:capture [--check] (notes/T074-bg2-spec.md R3): the capture host's libm results that Chrome's gradient code reads, as
// measured data. Blink's EndPointsFromAngle calls tan(float) of Deg2rad(90 - a) (WTF's d * (kPiFloat / 180.0f)) and Skia's
// SkMatrix::setRotate calls sinf and cosf of SkDegreesToRadians (degrees * (SK_ScalarPI / 180)); on the capture host (darwin-arm64,
// the machine class of the Chrome captures) those are Apple's libsystem_m, which is not correctly rounded. A small C probe compiled
// with the host cc prints, as float bits, every tanf input and output for a = k/100 degrees, k in [0, 36000), and every sinf and
// cosf input and output for a = k/100, k in [-36000, 36000]. The entries that differ from Math.fround of V8's Math.tan, Math.sin
// or Math.cos (fdlibm ports, the same on every host) are written to packages/dragon/src/paint-data/libm-darwin-arm64.generated.ts,
// with the host, the macOS build and libsystem_m's UUID. This is a black-box observation, like a Chrome capture; no libm code is
// ported. --check runs the probe and exits 1 when the committed table differs from it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIBM_TABLE_PATH = 'packages/dragon/src/paint-data/libm-darwin-arm64.generated.ts';

const PROBE = String.raw`#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>

static uint32_t bits(float f) { uint32_t u; memcpy(&u, &f, 4); return u; }

/* The UUID of the loaded libsystem_m image, from its LC_UUID load command. */
static void print_uuid(void) {
  for (uint32_t i = 0; i < _dyld_image_count(); i++) {
    const char *name = _dyld_get_image_name(i);
    if (name == NULL || strstr(name, "/libsystem_m.dylib") == NULL) continue;
    const struct mach_header_64 *h = (const struct mach_header_64 *)_dyld_get_image_header(i);
    const uint8_t *p = (const uint8_t *)(h + 1);
    for (uint32_t c = 0; c < h->ncmds; c++) {
      const struct load_command *lc = (const struct load_command *)p;
      if (lc->cmd == LC_UUID) {
        const uint8_t *u = ((const struct uuid_command *)lc)->uuid;
        printf("uuid ");
        for (int k = 0; k < 16; k++) printf("%02X%s", u[k], (k == 3 || k == 5 || k == 7 || k == 9) ? "-" : "");
        printf("\n");
        return;
      }
      p += lc->cmdsize;
    }
  }
  printf("uuid none\n");
}

int main(void) {
  /* volatile keeps the compiler from folding a call it could evaluate itself. */
  volatile float pi = 3.14159265358979323846f;
  print_uuid();
  for (int k = 0; k < 36000; k++) {
    float a = (float)(k / 100.0);
    a = fmodf(a, 360);
    if (a < 0) a += 360;
    volatile float x = (90 - a) * (pi / 180.0f);
    float t = tanf(x);
    printf("t %08x %08x\n", bits(x), bits(t));
  }
  for (int k = -36000; k <= 36000; k++) {
    float d = (float)(k / 100.0);
    volatile float r = d * (pi / 180);
    float s = sinf(r);
    float c = cosf(r);
    printf("s %08x %08x %08x\n", bits(r), bits(s), bits(c));
  }
  return 0;
}
`;

const f32 = Math.fround;
const view = new DataView(new ArrayBuffer(4));
const fromBits = (u: number): number => {
  view.setUint32(0, u);
  return view.getFloat32(0);
};
const toBits = (f: number): number => {
  view.setFloat32(0, f);
  return view.getUint32(0);
};

/** [input bits, host output bits] where the host's result differs from Math.fround of the fdlibm one. */
export type LibmDiff = readonly [number, number];
export type LibmCapture = { readonly host: string; readonly macos: string; readonly build: string; readonly uuid: string; readonly tan: LibmDiff[]; readonly sin: LibmDiff[]; readonly cos: LibmDiff[]; readonly counts: { readonly tan: number; readonly sinCos: number } };

/** Parses the probe's output into the differing entries, checking every line and the counts. */
export function parseProbe(out: string, host: { readonly macos: string; readonly build: string }): LibmCapture {
  const lines = out.split('\n').filter((l) => l !== '');
  const uuidLine = lines[0] ?? '';
  const um = /^uuid ([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/.exec(uuidLine);
  if (um === null) throw new Error(`libm:capture: the probe found no libsystem_m UUID (${JSON.stringify(uuidLine)})`);
  const tan: LibmDiff[] = [];
  const sin: LibmDiff[] = [];
  const cos: LibmDiff[] = [];
  let nt = 0;
  let ns = 0;
  for (const l of lines.slice(1)) {
    const t = /^t ([0-9a-f]{8}) ([0-9a-f]{8})$/.exec(l);
    if (t !== null) {
      const x = Number.parseInt(t[1] as string, 16);
      const host = Number.parseInt(t[2] as string, 16);
      if (toBits(f32(Math.tan(fromBits(x)))) !== host) tan.push([x, host]);
      nt++;
      continue;
    }
    const s = /^s ([0-9a-f]{8}) ([0-9a-f]{8}) ([0-9a-f]{8})$/.exec(l);
    if (s === null) throw new Error(`libm:capture: unexpected probe line ${JSON.stringify(l)}`);
    const x = Number.parseInt(s[1] as string, 16);
    const hs = Number.parseInt(s[2] as string, 16);
    const hc = Number.parseInt(s[3] as string, 16);
    if (toBits(f32(Math.sin(fromBits(x)))) !== hs) sin.push([x, hs]);
    if (toBits(f32(Math.cos(fromBits(x)))) !== hc) cos.push([x, hc]);
    ns++;
  }
  if (nt !== 36000 || ns !== 72001) throw new Error(`libm:capture: the probe printed ${nt} tan and ${ns} sin/cos lines, not 36000 and 72001`);
  // Two grid angles can share a tanf input; their entries must then agree.
  const dedupe = (d: LibmDiff[]): LibmDiff[] => {
    const m = new Map<number, number>();
    for (const [x, y] of d) {
      const seen = m.get(x);
      if (seen !== undefined && seen !== y) throw new Error(`libm:capture: input ${x.toString(16)} gave two results`);
      m.set(x, y);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  };
  return { host: 'darwin-arm64', macos: host.macos, build: host.build, uuid: um[1] as string, tan: dedupe(tan), sin: dedupe(sin), cos: dedupe(cos), counts: { tan: nt, sinCos: ns } };
}

const hex = (n: number): string => `0x${n.toString(16).padStart(8, '0')}`;

/** The generated table source of a capture. */
export function tableText(c: LibmCapture): string {
  const list = (name: string, doc: string, d: readonly LibmDiff[]): string => {
    const rows: string[] = [];
    for (let i = 0; i < d.length; i += 6) rows.push(`  ${d.slice(i, i + 6).map(([x, y]) => `[${hex(x)}, ${hex(y)}]`).join(', ')},`);
    return `/** ${doc} */\nexport const ${name}: readonly (readonly [number, number])[] = [\n${rows.join('\n')}\n];\n`;
  };
  return [
    `// Generated by scripts/capture-libm.ts (pnpm run libm:capture) on ${c.host}, macOS ${c.macos} (${c.build}), libsystem_m ${c.uuid}. Do not edit.`,
    "// The capture host's tanf, sinf and cosf as [input, output] float bits wherever they differ from Math.fround of V8's Math.tan,",
    `// Math.sin or Math.cos (notes/T074-bg2-spec.md R3); every other probed input gives the fdlibm result. Probed: ${c.counts.tan} tanf and ${c.counts.sinCos} sinf/cosf inputs.`,
    '',
    `export const LIBM_HOST = { platform: '${c.host}', macos: '${c.macos}', build: '${c.build}', libsystemM: '${c.uuid}' } as const;`,
    '',
    list('TANF_DIFFS', 'tanf(x), x = DegToRad(90 - a) in float, a = k/100 degrees for k in [0, 36000).', c.tan),
    list('SINF_DIFFS', 'sinf(x), x = SkDegreesToRadians(a) in float, a = k/100 degrees for k in [-36000, 36000].', c.sin),
    list('COSF_DIFFS', 'cosf(x), for the same inputs as SINF_DIFFS.', c.cos),
  ].join('\n');
}

/** Compiles and runs the probe with the host cc. */
function runProbe(): string {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error(`libm:capture runs on the capture host (darwin-arm64), not ${process.platform}-${process.arch}`);
  const dir = mkdtempSync(join(tmpdir(), 'dragon-libm-'));
  try {
    writeFileSync(join(dir, 'probe.c'), PROBE);
    execFileSync('cc', ['-O0', '-ffp-contract=off', '-o', join(dir, 'probe'), join(dir, 'probe.c')], { stdio: 'pipe' });
    return execFileSync(join(dir, 'probe'), { encoding: 'utf8', maxBuffer: 1 << 26 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sw = (flag: string): string => execFileSync('sw_vers', [flag], { encoding: 'utf8' }).trim();
  const capture = parseProbe(runProbe(), { macos: sw('-productVersion'), build: sw('-buildVersion') });
  const text = tableText(capture);
  const path = join(root, LIBM_TABLE_PATH);
  if (process.argv.includes('--check')) {
    const committed = readFileSync(path, 'utf8');
    if (committed !== text) {
      console.log(`libm:capture --check: ${LIBM_TABLE_PATH} differs from this host's probe (${capture.tan.length} tan, ${capture.sin.length} sin, ${capture.cos.length} cos entries; libsystem_m ${capture.uuid})`);
      process.exitCode = 1;
      return;
    }
    console.log(`libm:capture --check: ${LIBM_TABLE_PATH} equals this host's probe`);
    return;
  }
  writeFileSync(path, text);
  console.log(`libm:capture: wrote ${LIBM_TABLE_PATH}: ${capture.tan.length} tan, ${capture.sin.length} sin and ${capture.cos.length} cos entries (libsystem_m ${capture.uuid})`);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
