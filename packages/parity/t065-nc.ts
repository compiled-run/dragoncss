import { animCasesOf, animFixtures, frameScript, runFrameScript } from './src/anim-cases.ts';
import { rtInterpolate } from '@dragon/layout';
const fx = animFixtures().find((f) => f.id === process.argv[2])!;
const c = animCasesOf(fx)[0]!;
console.log(JSON.stringify(c.ap.bases), JSON.stringify(c.ap.animations).slice(0, 300));
const steps = frameScript(c);
for (const d of runFrameScript(c, steps)) console.log(d.at, d.assignment, [...d.frame].map(([k, v]) => `${k}=${rtInterpolate.serializeValue(v, 0, 0, { sin: Math.sin, cos: Math.cos })}`).join(' '));
