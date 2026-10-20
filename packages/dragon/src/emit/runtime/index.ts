// The runtime module registry (notes/T047-runtime-spec.md RT-12): each runtime package registers its support sources here, and
// emit/native-support.ts appends them to the support file list of each backend, in this order.
import type { NativeBackend } from '../../lower/native-program.ts';
import type { GeneratedFile } from '../../types.ts';
import { animSupport } from './anim.ts';
import { clockSupport } from './clock.ts';
import { interactionSupport } from './interaction.ts';
import { interactionGlueSupport } from './interaction-glue.ts';
import { stateSupport } from './state.ts';

/** The registered runtime modules, in support-file order. */
export const RUNTIME_MODULES: readonly { readonly id: string; readonly support: (backend: NativeBackend, header: (what: string) => string) => GeneratedFile }[] = [
  { id: 'clock', support: clockSupport },
  { id: 'state', support: stateSupport },
  { id: 'anim', support: animSupport },
  { id: 'interaction', support: interactionSupport },
  { id: 'interaction-glue', support: interactionGlueSupport },
];

/** The runtime support files of a backend. */
export function runtimeSupportFiles(backend: NativeBackend, header: (what: string) => string): GeneratedFile[] {
  return RUNTIME_MODULES.map((m) => m.support(backend, header));
}
