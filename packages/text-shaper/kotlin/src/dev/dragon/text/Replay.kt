// Replays a dragon-shape-transcript/1 (packages/text-shaper/src/transcript.ts) through the JNI bridge and compares
// every integer. Host: java -cp <jar> dev.dragon.text.ReplayKt --lib <libdragon_hb> <transcript.json> <repo root>.
// The Android device harness (device/android) runs the same main under app_process.
package dev.dragon.text

import java.io.File
import java.security.MessageDigest
import kotlin.system.exitProcess

class ReplayMismatch(val call: Int, val op: String, val detail: String)

class ReplayReport {
    var calls = 0
    var shapeCalls = 0
    var glyphs = 0
    val mismatches = ArrayList<ReplayMismatch>()
    val summary: String get() = "$calls calls ($shapeCalls shape, $glyphs glyphs), ${mismatches.size} mismatches"
}

@Suppress("UNCHECKED_CAST")
private fun obj(v: Any?): Map<String, Any?> = v as Map<String, Any?>
@Suppress("UNCHECKED_CAST")
private fun arr(v: Any?): List<Any?> = v as List<Any?>
private fun long(v: Any?): Long = (v as JsonNumber).toLong()
/** Unsigned or signed 32-bit JSON values (feature tag, value, start, end) as the Int the JNI passes through. */
private fun u32(v: Any?): Int = long(v).toInt()
private fun f32(v: Any?): Float = (v as JsonNumber).toF32()
/** A transcript index into items: out of range (negative included) is a bad transcript, not an IndexOutOfBounds. */
private fun <T> at(items: List<T>, v: Any?, what: String): T {
    val i = long(v)
    require(i >= 0 && i < items.size) { "bad transcript: $what $i of ${items.size}" }
    return items[i.toInt()]
}
/** A value the shim takes as uint32 (codepoint, glyph id): outside 0..2^32-1 is a bad transcript. */
private fun u32of(v: Any?, what: String): Int {
    val i = long(v)
    require(i in 0L..0xFFFFFFFFL) { "bad transcript: $what $i" }
    return i.toInt()
}

fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Face files are read from root/<face.file>; their sha256 must equal the transcript's. */
fun replayTranscript(json: String, root: File): ReplayReport {
    val t = obj(JsonReader(json).parse())
    require(t["format"] == "dragon-shape-transcript/1") { "not a dragon-shape-transcript/1" }
    val shaper = DragonHB.shaperCreate()
    check(shaper != 0L) { "shaperCreate failed" }
    val faces = arr(t["faces"]).map {
        val f = obj(it)
        val file = f["file"] as String
        val bytes = File(root, file).readBytes()
        val sha = sha256Hex(bytes)
        check(sha == f["sha256"]) { "face $file: sha256 $sha, transcript ${f["sha256"]}" }
        DragonHB.faceCreate(bytes, 0).also { h -> check(h != 0L) { "faceCreate failed for $file" } }
    }
    val fonts = arr(t["fonts"]).map {
        val f = obj(it)
        DragonHB.fontCreate(
            at(faces, f["face"], "font.face"), f32(f["size"]), f32(f["specifiedSize"]), f32(f["weight"]), f32(f["width"]), f32(f["slope"]),
            f["opticalSizingAuto"] as Boolean, null, null,
        ).also { h -> check(h != 0L) { "fontCreate failed" } }
    }
    val texts = arr(t["texts"]).map { it as String }
    val report = ReplayReport()
    arr(t["calls"]).forEachIndexed { i, c ->
        val call = obj(c)
        val font = at(fonts, call["font"], "call.font")
        report.calls++
        when (val op = call["op"] as String) {
            "shape" -> {
                report.shapeCalls++
                val feats = arr(call["features"])
                val features = if (feats.isEmpty()) null else IntArray(feats.size * 4).also { out ->
                    feats.forEachIndexed { j, f ->
                        val a = arr(f)
                        out[j * 4] = u32(a[0])
                        out[j * 4 + 1] = u32(a[1])
                        out[j * 4 + 2] = u32(a[2])
                        out[j * 4 + 3] = u32(a[3])
                    }
                }
                val text = at(texts, call["text"], "call.text")
                val start = long(call["start"])
                val end = long(call["end"])
                require(start >= 0 && start <= end && end <= text.length) { "bad transcript: call.start $start, call.end $end of text length ${text.length}" }
                val got = DragonHB.shape(
                    shaper, font, text, start.toInt(), (end - start).toInt(),
                    DragonHB.tag(call["script"] as String), call["rtl"] as Boolean, call["language"] as String, features,
                ) ?: throw IllegalStateException("shape: out of memory")
                val expected = arr(call["glyphs"]).map { long(it) }
                report.glyphs += got.size / DragonHB.GLYPH_STRIDE
                if (got.size != expected.size) {
                    report.mismatches.add(ReplayMismatch(i, op, "length ${got.size}, expected ${expected.size}"))
                } else {
                    val at = got.indices.firstOrNull { got[it].toLong() != expected[it] }
                    if (at != null) report.mismatches.add(ReplayMismatch(i, op, "int $at: ${got[at]}, expected ${expected[at]}"))
                }
            }
            "nominal" -> {
                val cp = u32of(call["codepoint"], "codepoint")
                val got = DragonHB.nominalGlyph(font, cp).toLong() and 0xFFFFFFFFL
                val expected = long(call["glyph"])
                if (got != expected) report.mismatches.add(ReplayMismatch(i, op, "U+${cp.toString(16)}: $got, expected $expected"))
            }
            "advance" -> {
                val glyph = u32of(call["glyph"], "glyph")
                val got = DragonHB.glyphAdvance(font, glyph).toLong()
                val expected = long(call["advance"])
                if (got != expected) report.mismatches.add(ReplayMismatch(i, op, "glyph $glyph: $got, expected $expected"))
            }
            else -> throw IllegalArgumentException("op $op")
        }
    }
    fonts.forEach { DragonHB.fontDestroy(it) }
    faces.forEach { DragonHB.faceDestroy(it) }
    DragonHB.shaperDestroy(shaper)
    return report
}

/** The replay CLI shared by the host JVM and the Android harness: prints the report, returns the exit code. */
fun replayMain(target: String, args: Array<String>): Int {
    val rest = args.toMutableList()
    val li = rest.indexOf("--lib")
    val lib = if (li >= 0) rest[li + 1].also { rest.removeAt(li + 1); rest.removeAt(li) } else null
    if (rest.size != 2) {
        System.err.println("usage: [--lib <libdragon_hb>] <transcript.json> <repo root>")
        return 2
    }
    return try {
        DragonHB.load(lib)
        val report = replayTranscript(File(rest[0]).readText(), File(rest[1]))
        println("replay $target: ${report.summary}")
        report.mismatches.take(5).forEach { println("  MISMATCH call ${it.call} ${it.op}: ${it.detail}") }
        if (report.mismatches.isEmpty()) 0 else 1
    } catch (e: Throwable) {
        println("replay $target: error: $e")
        1
    }
}

fun main(args: Array<String>) {
    exitProcess(replayMain("kotlin (jvm, aarch64-macos)", args))
}
