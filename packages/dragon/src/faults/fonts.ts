// Fonts: pinned generics, @font-face emission, the font manifest and unmapped families.

export type FontsFaults = {
  /** The web output writes a pinned generic as authored instead of its pinned family. */
  readonly pinnedGenericNotRewritten: boolean;
  /** The web output omits the @font-face rules of the pinned and declared faces. */
  readonly fontFaceNotEmitted: boolean;
  /** The compilation digest leaves out the font manifest. */
  readonly fontManifestOutOfDigest: boolean;
  /** A family that is neither declared nor mapped is accepted without a diagnostic. */
  readonly unmappedFamilyAccepted: boolean;
};

export const FONTS_FAULTS: FontsFaults = { pinnedGenericNotRewritten: false, fontFaceNotEmitted: false, fontManifestOutOfDigest: false, unmappedFamilyAccepted: false };
