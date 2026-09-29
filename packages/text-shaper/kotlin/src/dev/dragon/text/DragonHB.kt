// Kotlin over dragon_hb's C ABI through the JNI glue (src/dragon_hb_jni.zig), linked only into libdragon_hb.so on
// Android and the host JNI dylib (zig build host-jni). Handles are Longs; shape returns GLYPH_STRIDE ints per glyph
// (glyph id, cluster, x advance, y advance, x offset, y offset, flags; positions 16.16).
package dev.dragon.text

object DragonHB {
    const val GLYPH_STRIDE = 7
    const val GLYPH_FLAG_UNSAFE_TO_BREAK = 1

    /** Loads the shim: an absolute path (host JVM, device harness), or System.loadLibrary("dragon_hb") (an app). */
    fun load(path: String? = null) {
        if (path != null) System.load(path) else System.loadLibrary("dragon_hb")
    }

    fun tag(s: String): Int {
        require(s.length == 4 && s.all { it.code < 0x80 }) { "OpenType tag must have 4 ASCII characters: $s" }
        return (s[0].code shl 24) or (s[1].code shl 16) or (s[2].code shl 8) or s[3].code
    }

    /** Copies the bytes; 0 on failure. */
    @JvmStatic external fun faceCreate(data: ByteArray, index: Int): Long
    @JvmStatic external fun faceDestroy(face: Long)
    @JvmStatic external fun faceUpem(face: Long): Int

    /** variationTags and variationValues are parallel (null for none); 0 on failure. */
    @JvmStatic external fun fontCreate(
        face: Long, size: Float, specifiedSize: Float, weight: Float, width: Float, slope: Float,
        opticalSizingAuto: Boolean, variationTags: IntArray?, variationValues: FloatArray?,
    ): Long
    @JvmStatic external fun fontDestroy(font: Long)

    /** The 16.16 advance HarfBuzz gets from the shim's advance function. */
    @JvmStatic external fun glyphAdvance(font: Long, glyph: Int): Int
    @JvmStatic external fun nominalGlyph(font: Long, codepoint: Int): Int

    @JvmStatic external fun shaperCreate(): Long
    @JvmStatic external fun shaperDestroy(shaper: Long)

    /**
     * Shapes text[offset, offset + length) with the whole text as context. script is an ISO 15924 tag (see tag());
     * features holds 4 ints per feature {tag, value, start, end} or is null. Null on allocation failure.
     */
    @JvmStatic external fun shape(
        shaper: Long, font: Long, text: String, offset: Int, length: Int, script: Int, rtl: Boolean,
        language: String, features: IntArray?,
    ): IntArray?
}
