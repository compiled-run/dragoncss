// pnpm evidence:stamp [--compare <ref>]: the device evidence stamp of this tree (device-evidence.ts), per native target.
// --compare exits 0 when the device evidence committed on <ref> (its lanes.json) is current for this tree, so a device run here
// would be judged with the same lane code, reference data and app; 1 when it is not (each reason printed); 2 on any error.
// The landing driver (scripts/land.ts) runs the device lanes only on exit 1.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { deviceEvidence } from '../packages/parity/src/device-evidence.ts';
import { LANES_JSON, type LanesFile, staleEvidence, staleLanes } from '../packages/parity/src/lanes.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { NATIVE_TARGETS, nativeTargets } from '../packages/parity/src/targets.ts';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): boolean => v === null || (isObject(v) && ['laneCode', 'referenceData', 'app'].every((k) => typeof v[k] === 'string'));

/** Checks the parts of a lanes.json the comparison reads; anything else is an error, never a "differs". */
export const parseLanesForStamp = (v: unknown, what: string): LanesFile => {
  const bad = (why: string): never => {
    throw new Error(`evidence-stamp: ${what}: ${why}`);
  };
  if (!isObject(v) || !Array.isArray(v.targets)) return bad('not { targets: [...] }');
  for (const t of v.targets) {
    if (!isObject(t) || typeof t.target !== 'string' || !Array.isArray(t.lanes)) return bad('a target is not { target, lanes }');
    for (const l of t.lanes) {
      if (!isObject(l) || typeof l.lane !== 'string' || typeof l.where !== 'string' || typeof l.state !== 'string' || typeof l.caseListSha256 !== 'string') {
        return bad(`a ${t.target} lane is not { lane, where, state, caseListSha256 }`);
      }
      if (!isStamp(l.evidence)) return bad(`${t.target} ${l.lane}: evidence is not null or { laneCode, referenceData, app }`);
    }
  }
  return v as unknown as LanesFile;
};

/**
 * Why the device evidence committed in `file` is not current for this tree; empty when every device lane that ran carries this
 * tree's stamp, the file describes the current lane configuration, and every native target has device evidence at all.
 */
export const stampProblems = (file: LanesFile): string[] => {
  const problems = [...staleLanes(file, nativeTargets()), ...staleEvidence(file)];
  for (const target of NATIVE_TARGETS) {
    const t = file.targets.find((x) => x.target === target);
    if (t !== undefined && !t.lanes.some((l) => l.where === 'device' && l.state !== 'not run')) problems.push(`${LANES_JSON}: ${target} has no device lane that ran`);
  }
  return problems;
};

const main = (argv: string[]): number => {
  const stamps = Object.fromEntries(NATIVE_TARGETS.map((t) => [t, deviceEvidence(t)]));
  if (argv.length === 0) {
    console.log(JSON.stringify(stamps, null, 2));
    return 0;
  }
  const [flag, ref, ...rest] = argv;
  if (flag !== '--compare' || ref === undefined || ref.startsWith('-') || rest.length > 0) throw new Error('usage: pnpm evidence:stamp [--compare <ref>]');
  const text = execFileSync('git', ['show', `${ref}:${LANES_JSON}`], { cwd: repoPath('.'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  const problems = stampProblems(parseLanesForStamp(JSON.parse(text), `${ref}:${LANES_JSON}`));
  console.log(`this tree: ${JSON.stringify(stamps)}`);
  if (problems.length === 0) {
    console.log(`evidence-stamp: equal: the device evidence on ${ref} is current for this tree`);
    return 0;
  }
  console.log(`evidence-stamp: differs from ${ref}:\n  ${problems.join('\n  ')}`);
  return 1;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
