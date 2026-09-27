// parity:platform-check (docs/decisions.md, Linux lane scope): a platform's own Chrome captures against the reference platform's.
// Hard checks: (1) the same cases, node ids, kinds and hasBox; (2) every computed value equal, except the fields that come from the
// keyed UA dataset (the root font-family of fixtures that keep Chrome's UA font); (3) chrome-dual exact on that platform (the CLI,
// live). Geometry deltas against the reference captures and against Dragon under the reference platform's rules are information.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { WebCapture } from './capture.ts';
import { expectedDir } from './committed.ts';

export type Captures = ReadonlyMap<string, WebCapture>;

/** Every committed capture of one platform key, by case id. */
export function readCaptures(platform: string): Map<string, WebCapture> {
  const dir = expectedDir(platform);
  const out = new Map<string, WebCapture>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.web.json')).sort()) out.set(f.slice(0, -'.web.json'.length), JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as WebCapture);
  return out;
}

/** A value the platform may differ in: it comes from the platform's UA dataset, not from the fixture. */
export type Exemption = { readonly case: string; readonly node: string; readonly property: string; readonly reference: string; readonly value: string };

export type GeometryDelta = { readonly case: string; readonly node: string; readonly maxEdgeDeltaPx: number };

export type CaptureCheck = {
  readonly problems: readonly string[];
  readonly exemptions: readonly Exemption[];
  /** Information only: nodes whose edges differ from the reference capture. */
  readonly geometry: readonly GeometryDelta[];
  readonly comparedCases: number;
  readonly comparedNodes: number;
  readonly comparedValues: number;
};

/** The fixture a case id belongs to: "<fixture>", "<fixture>-rtl", "<fixture>#<k>" or "<fixture>#<k>-rtl". */
export const fixtureOfCase = (caseId: string): string => caseId.replace(/-rtl$/, '').replace(/#\d+$/, '');

/**
 * Checks (1) and (2). uaDefaultFixtures: fixtures whose root font-family is Chrome's UA font, the only computed field known to come
 * from the platform's UA dataset (notes/T033-linux-lane.md).
 */
export function checkPlatformCaptures(reference: Captures, target: Captures, uaDefaultFixtures: ReadonlySet<string>): CaptureCheck {
  const problems: string[] = [];
  const exemptions: Exemption[] = [];
  const geometry: GeometryDelta[] = [];
  let comparedNodes = 0;
  let comparedValues = 0;
  const refIds = [...reference.keys()].sort();
  const ids = [...target.keys()].sort();
  for (const id of refIds) if (!target.has(id)) problems.push(`${id}: no capture on this platform`);
  for (const id of ids) if (!reference.has(id)) problems.push(`${id}: not a case of the reference platform`);
  for (const id of refIds) {
    const a = reference.get(id) as WebCapture;
    const b = target.get(id);
    if (b === undefined) continue;
    for (const k of ['fixture', 'chrome', 'viewport', 'devicePixelRatio', 'direction'] as const) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) problems.push(`${id}: ${k} ${JSON.stringify(a[k])} on the reference, ${JSON.stringify(b[k])} here`);
    }
    const bById = new Map(b.nodes.map((n) => [n.id, n]));
    if (a.nodes.map((n) => n.id).join(' ') !== b.nodes.map((n) => n.id).join(' ')) {
      for (const n of a.nodes) if (!bById.has(n.id)) problems.push(`${id}: node ${n.id} is missing`);
      const aIds = new Set(a.nodes.map((n) => n.id));
      for (const n of b.nodes) if (!aIds.has(n.id)) problems.push(`${id}: node ${n.id} is not on the reference`);
      if (a.nodes.length === b.nodes.length) problems.push(`${id}: nodes are in a different order`);
    }
    const uaFont = uaDefaultFixtures.has(fixtureOfCase(id));
    for (const n of a.nodes) {
      const m = bById.get(n.id);
      if (m === undefined) continue;
      comparedNodes++;
      if (n.kind !== m.kind) problems.push(`${id}: ${n.id} kind ${n.kind} on the reference, ${m.kind} here`);
      if (n.hasBox !== m.hasBox) problems.push(`${id}: ${n.id} hasBox ${n.hasBox} on the reference, ${m.hasBox} here`);
      const delta = Math.max(Math.abs(n.x - m.x), Math.abs(n.y - m.y), Math.abs(n.x + n.width - (m.x + m.width)), Math.abs(n.y + n.height - (m.y + m.height)));
      if (delta !== 0) geometry.push({ case: id, node: n.id, maxEdgeDeltaPx: delta });
      if ((n.computed === null) !== (m.computed === null)) {
        problems.push(`${id}: ${n.id} computed values present on one platform only`);
        continue;
      }
      if (n.computed === null || m.computed === null) continue;
      for (const p of Object.keys(n.computed)) {
        comparedValues++;
        const x = n.computed[p] as string;
        const y = m.computed[p];
        if (x === y) continue;
        if (uaFont && p === 'font-family' && y !== undefined) exemptions.push({ case: id, node: n.id, property: p, reference: x, value: y });
        else problems.push(`${id}: ${n.id} ${p} "${x}" on the reference, "${String(y)}" here`);
      }
      for (const p of Object.keys(m.computed)) if (!(p in n.computed)) problems.push(`${id}: ${n.id} ${p} is not captured on the reference`);
    }
  }
  return { problems, exemptions, geometry, comparedCases: refIds.filter((id) => target.has(id)).length, comparedNodes, comparedValues };
}
