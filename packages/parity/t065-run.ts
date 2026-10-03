import { animCasesOf, animFixtures, frameScript, runFrameScript } from './src/anim-cases.ts';
import { rtInterpolate } from '@dragon/layout';
for (const fx of animFixtures()) {
  for (const c of animCasesOf(fx)) {
    const steps = frameScript(c);
    const dumps = runFrameScript(c, steps);
    const show = (d: (typeof dumps)[number]) => [...d.frame].map(([k, v]) => `${k}=${rtInterpolate.serializeValue(v, 0, 0, { sin: Math.sin, cos: Math.cos })}`).join(' ');
    console.log(c.id, 'steps', steps.length, 'dumps', dumps.length, 'slots', c.ap.slots.length, 'anims', c.ap.animations.length, '|', show(dumps[Math.min(3, dumps.length - 1)]!).slice(0, 160));
  }
}
