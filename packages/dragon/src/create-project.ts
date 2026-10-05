// The public createProject: the compiler with the committed lanes verdict (profiles/native-lanes.ts), loaded here at the edge
// rather than in project.ts, so only what compiles through this entry reads the verdict.
import { NO_FAULTS } from './faults.ts';
import { NATIVE_LANES } from './profiles/native-lanes.ts';
import type { Configured, Project, ProjectConfig, Targets } from './types.ts';
import { createProjectWith } from './project.ts';

export function createProject<const T extends Targets>(config: ProjectConfig<T>): Project<Configured<T>> {
  return createProjectWith(config, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', nativeLanes: NATIVE_LANES });
}
