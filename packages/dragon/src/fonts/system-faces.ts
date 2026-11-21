// System faces (docs/decisions.md, "System fonts on Markless native targets", owner 2026-11-18): with system fonts on, a native
// compile resolves an unquoted platform generic of the font map (system-ui, sans-serif, serif, monospace), and a text whose
// font-family is the initial value (no font-family anywhere), to a system face: the platform's own font for that role, weight and
// style, which each target's build-time provider measures (Core Text on the Mac for iOS, the SDK image's font files for Android).
// A system face is named by its request alone, so the one native lowering serves every target; nothing is bundled.

/** The roles a system face plays: a generic family, or the browser's default font for a text with no font-family. */
export const SYSTEM_FACE_ROLES = ['system-ui', 'sans-serif', 'serif', 'monospace', 'default'] as const;
export type SystemFaceRole = (typeof SYSTEM_FACE_ROLES)[number];

/** The computed font-weights a system face is requested at: the nine named weights. */
export const SYSTEM_FACE_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type SystemFaceWeight = (typeof SYSTEM_FACE_WEIGHTS)[number];

export type SystemFaceRequest = { readonly role: SystemFaceRole; readonly weight: SystemFaceWeight; readonly style: 'normal' | 'italic' };

const idOf = (r: SystemFaceRequest): string => `system:${r.role}:${r.weight}${r.style === 'italic' ? ':italic' : ''}`;

/** Every system face by the face id the engine and the export name it with. */
export const SYSTEM_FACES: ReadonlyMap<string, SystemFaceRequest> = new Map(
  SYSTEM_FACE_ROLES.flatMap((role) => SYSTEM_FACE_WEIGHTS.flatMap((weight) => (['normal', 'italic'] as const).map((style) => {
    const r = { role, weight, style };
    return [idOf(r), r] as const;
  }))),
);

const BY_REQUEST: ReadonlyMap<string, string> = new Map([...SYSTEM_FACES].map(([id, r]) => [`${r.role}|${r.weight}|${r.style}`, id]));

/** The face id of a system face request, or null for a weight that is not one of the nine named weights. */
export function systemFaceId(role: SystemFaceRole, weight: number, style: 'normal' | 'italic'): string | null {
  return BY_REQUEST.get(`${role}|${weight}|${style}`) ?? null;
}

export const isSystemFaceRole = (key: string): key is SystemFaceRole => (SYSTEM_FACE_ROLES as readonly string[]).includes(key);
