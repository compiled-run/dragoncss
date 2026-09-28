// The DPR lane (docs/research/native-strategy.md section 2; notes/T010-p2-triage.md P2b): every milestone-1 layout case and the
// three P2b fixtures captured in Chrome at DPR 2, 3 and 2.625 (the Android extra), compared with the engine at the one milestone-1
// gate, every node exact in zoomed LU, and the DPR deviation registry. No Chrome runs here: the committed DPR captures are read.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dprChromeDeviations } from '@dragon/layout';
import type { WebCapture } from '../src/capture.ts';
import { CHROME_ARGS, chromeArgsAt } from '../src/chrome.ts';
import { expectedDir } from '../src/committed.ts';
import { exactInZoomedLu, GATE_DEVICE_PX } from '../src/compare.ts';
import type { DprCaseOutcome } from '../src/dpr.ts';
import { DPR_GATE_DEVICE_PX, DPRS, dprRegistryRows, EXTRA_DPRS, expectedDprDir, layoutCases, registryRowPasses, runDprCase, runDprLane, SHARED_DPRS, ZOOM_GUARD } from '../src/dpr.ts';
import { declaredLayoutCaseCount } from '../src/case-count.ts';
import { repoPath } from '../src/paths.ts';
import { compileFixture } from '../src/pipeline.ts';

const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));

describe('DPR lane constants', () => {
  it('shared ratios 2 and 3, the Android extra 2.625 named with its platform, never a substitute', () => {
    expect(SHARED_DPRS).toEqual([2, 3]);
    expect(EXTRA_DPRS).toEqual([{ dpr: 2.625, name: 'android-extra-420dpi', platform: 'android' }]);
    expect(DPRS).toEqual([2, 3, 2.625]);
    expect([...ZOOM_GUARD.entries()]).toEqual([[2, '0.5px'], [3, '0.333333px'], [2.625, '0.380952px']]);
  });

  it('the gate is the imported milestone-1 constant, 1 device px, never a literal', () => {
    expect(DPR_GATE_DEVICE_PX).toBe(GATE_DEVICE_PX);
    expect(GATE_DEVICE_PX).toBe(1);
    const src = readFileSync(repoPath('packages/parity/src/dpr.ts'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\bGATE_DEVICE_PX\b[^}]*\} from '\.\/compare\.ts';/);
    expect(src).toContain('export const DPR_GATE_DEVICE_PX = GATE_DEVICE_PX;');
  });

  it('only --force-device-scale-factor changes between launches; the milestone-1 flags are unchanged', () => {
    expect(CHROME_ARGS).toContain('--force-device-scale-factor=1');
    for (const n of DPRS) expect(chromeArgsAt(n)).toEqual(CHROME_ARGS.map((a) => (a === '--force-device-scale-factor=1' ? `--force-device-scale-factor=${n}` : a)));
  });

  it('exactness in zoomed LU: the LU nearest px x 64 x DPR, within 1/16 LU of float readback', () => {
    expect(exactInZoomedLu(7910 / 192, 7910, 3)).toBe(true);
    expect(exactInZoomedLu(7911 / 192, 7910, 3)).toBe(false);
    expect(exactInZoomedLu(0.380952, 64, 2.625)).toBe(true);
  });
});

describe('DPR captures (packages/parity/expected-dpr/darwin-arm64/dpr-<N>)', () => {
  it(`every DPR set holds the same ${ids.length} case ids as DPR 1, outside expected/darwin-arm64`, () => {
    expect(ids.length).toBe(declaredLayoutCaseCount());
    for (const dpr of DPRS) {
      const dir = expectedDprDir(dpr);
      expect(dir.startsWith(expectedDir())).toBe(false);
      expect(readdirSync(dir).filter((f) => f.endsWith('.web.json')).map((f) => f.replace(/\.web\.json$/, '')).sort()).toEqual([...ids].sort());
    }
    // platform.test.ts reads every entry of expected/darwin-arm64 as a file: no DPR folder there.
    expect(readdirSync(expectedDir(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)).toEqual([]);
  });

  it('every capture records its DPR, the reference platform and the case direction', () => {
    for (const dpr of DPRS) {
      for (const id of ids) {
        const c = JSON.parse(readFileSync(`${expectedDprDir(dpr)}/${id}.web.json`, 'utf8')) as WebCapture;
        expect([c.devicePixelRatio, c.platform, c.direction], `${id} @${dpr}`).toEqual([dpr, 'darwin-arm64', id.endsWith('-rtl') ? 'rtl' : 'ltr']);
      }
    }
  });
});

describe(`DPR lane: ${3 * declaredLayoutCaseCount()} cases against the committed captures`, () => {
  const lane = runDprLane();

  for (const s of lane) {
    it(`DPR ${s.dpr} (${s.role}): ${declaredLayoutCaseCount()}/${declaredLayoutCaseCount()} cases pass the ${DPR_GATE_DEVICE_PX} device px gate and every compared node is exact in zoomed LU`, () => {
      const failing = s.outcomes.filter((o) => o.status !== 'pass').map((o) => `${o.id}: ${o.reason ?? ''}`.slice(0, 300));
      expect(failing).toEqual([]);
      expect([s.cases, s.pass]).toEqual([declaredLayoutCaseCount(), declaredLayoutCaseCount()]);
      expect(s.exact).toBe(s.nodes);
      expect(s.nodes).toBeGreaterThan(8000);
      expect(s.role).toBe(SHARED_DPRS.includes(s.dpr) ? 'shared' : 'extra');
    });
  }

  it('the lane compares every node: a capture moved by 1 LU is not exact, and one moved by 1.5 device px fails the gate', () => {
    const f = layoutCases().find((x) => x.spec.id === 'border-initial-width');
    if (f === undefined) throw new Error('no border-initial-width');
    const c = f.cases[0];
    if (c === undefined) throw new Error('no case');
    const compiled = compileFixture(f.spec).compiled;
    const capture = JSON.parse(readFileSync(`${expectedDprDir(3)}/${c.id}.web.json`, 'utf8')) as WebCapture;
    const moved = (dx: number): DprCaseOutcome => runDprCase(c, compiled, 3, { ...capture, nodes: capture.nodes.map((n) => (n.id === 'i1' ? { ...n, x: n.x + dx } : n)) });
    expect(runDprCase(c, compiled, 3, capture).status).toBe('pass');
    const oneLu = moved(1 / 192);
    expect([oneLu.status, oneLu.exact, oneLu.nodes - oneLu.exact]).toEqual(['fail', oneLu.nodes - 1, 1]);
    expect(oneLu.comparison?.pass).toBe(true);
    const over = moved(1.5 / 3);
    expect(over.comparison?.pass).toBe(false);
  });
});

describe('DPR deviation registry (chrome-deviations-dpr.ts) in the DPR lane', () => {
  it('every node is exact and non-exact under the spec-reading fault; every control is exact and held; every branch has nodes at 2, 3 and 2.625', () => {
    const rows = dprRegistryRows();
    expect(rows.filter((r) => !registryRowPasses(r))).toEqual([]);
    for (const d of dprChromeDeviations) {
      const nodes = rows.filter((r) => r.deviation === d.id && r.kind === 'node');
      expect(nodes.length).toBe(d.nodes.length);
      for (const b of d.branches) for (const dpr of DPRS) expect(nodes.some((r) => r.detail === b.id && r.dpr === dpr), `${b.id} @${dpr}`).toBe(true);
      // The spec reading moves every registered node by more than the gate.
      for (const r of nodes) expect(r.gapUnderFault, `${r.node} @${r.dpr}`).toBeGreaterThan(DPR_GATE_DEVICE_PX);
      expect(rows.filter((r) => r.deviation === d.id && r.kind === 'control').length).toBe(d.controls.length);
    }
  });
});
