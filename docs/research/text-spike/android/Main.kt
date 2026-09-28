// StaticLayout / Minikin line breaking vs Chrome. Runs inside a Gradle-free debug APK (app_process lacks the
// zygote-preloaded system font map, so Typeface.createFromFile NPEs there). Output lands in the app's filesDir.
package dev.dragon.textspike

import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.text.LineBreakConfig
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

val typefaces = HashMap<String, Typeface>()
lateinit var ctx: android.content.Context
fun tf(file: String) = typefaces.getOrPut(file) { Typeface.createFromAsset(ctx.assets, "fonts/$file") }
fun asset(n: String) = ctx.assets.open(n).bufferedReader().readText()
fun isTrailingSpace(c: Char) = c == ' ' || c == '　'

fun paint(file: String, size: Float, lang: String, flags: Int): TextPaint {
  val p = TextPaint(flags); p.typeface = tf(file); p.textSize = size; p.textLocale = Locale.forLanguageTag(lang); return p
}

fun engine(breaks: List<Int>, lines: List<Triple<Int, Int, Double>>) = JSONObject().apply {
  put("breaks", JSONArray(breaks)); put("lines", JSONArray(lines.map { JSONObject().put("start", it.first).put("end", it.second).put("width", it.third) }))
}

fun staticLayout(text: String, p: TextPaint, width: Int, scale: Double, strategy: Int, hyph: Int): JSONObject {
  val b = StaticLayout.Builder.obtain(text, 0, text.length, p, width).setIncludePad(false)
    .setBreakStrategy(strategy).setHyphenationFrequency(hyph)
  val l = b.build()
  val breaks = ArrayList<Int>(); val lines = ArrayList<Triple<Int, Int, Double>>()
  for (i in 0 until l.lineCount) {
    val s = l.getLineStart(i); val e = l.getLineEnd(i)
    if (i > 0) breaks.add(s)
    // getLineWidth() includes trailing spaces in practice; trim them via the caret x of the last non-space char.
    var te = e; while (te > s && isTrailingSpace(text[te - 1])) te--
    val w = if (te < e && te > s) l.getPrimaryHorizontal(te).toDouble() else if (te == s) 0.0 else l.getLineWidth(i).toDouble()
    lines.add(Triple(s, e, w / scale))
  }
  return engine(breaks, lines).put("lineTop1", l.getLineTop(1) / scale).put("baseline0", l.getLineBaseline(0) / scale)
}

fun width(text: String, p: TextPaint, s: Int, e: Int): Double {
  var te = e; while (te > s && isTrailingSpace(text[te - 1])) te--
  // Paint.measureText() ceils to whole px; getRunAdvance() returns the unrounded advance.
  return if (te == s) 0.0 else p.getRunAdvance(text, s, te, s, te, false, te).toDouble()
}

fun greedy(text: String, p: TextPaint, opps: List<Int>, W: Double, scale: Double, hyph: Double): JSONObject {
  val all = opps.filter { it > 0 && it < text.length } + text.length
  var start = 0; val breaks = ArrayList<Int>(); val lines = ArrayList<Triple<Int, Int, Double>>()
  while (start < text.length) {
    var best = -1; var bestW = 0.0
    for (o in all) { if (o <= start) continue
      var w = width(text, p, start, o) / scale
      if (o < text.length && text[o - 1] == '­') w += hyph
      if (Math.ceil(w * 64) / 64 <= W + 1.0 / 64) { best = o; bestW = w } else { if (best < 0) { best = o; bestW = w }; break }
    }
    lines.add(Triple(start, best, bestW)); if (best < text.length) breaks.add(best); start = best
  }
  return engine(breaks, lines)
}

fun icuOpps(text: String, lang: String): List<Int> {
  val bi = android.icu.text.BreakIterator.getLineInstance(android.icu.util.ULocale.forLanguageTag(lang))
  bi.setText(text); val r = ArrayList<Int>(); bi.first()
  while (true) { val n = bi.next(); if (n == android.icu.text.BreakIterator.DONE || n >= text.length) break; r.add(n) }
  return r
}

class SpikeActivity : android.app.Activity() {
  override fun onCreate(b: android.os.Bundle?) {
    super.onCreate(b); ctx = this
    Thread {
      try { for (s in listOf(1.0, 2.625, 3.0)) run(s) ; android.util.Log.i("TextSpike", "DONE") }
      catch (t: Throwable) { android.util.Log.e("TextSpike", "FAILED", t) }
    }.start()
  }
}

fun run(scale: Double) {
  val cases = JSONArray(asset("cases.json"))
  val oppsArr = JSONArray(asset("chrome-opps.json"))
  val oracle = HashMap<String, List<Int>>()
  for (i in 0 until oppsArr.length()) { val o = oppsArr.getJSONObject(i); val a = o.getJSONArray("opps"); oracle[o.getString("lang") + "|" + o.getString("para")] = (0 until a.length()).map { a.getInt(it) } }
  val out = JSONArray()
  for (i in 0 until cases.length()) {
    val c = cases.getJSONObject(i)
    val text = c.getString("text"); val file = c.getString("file"); val lang = c.getString("lang")
    val size = c.getDouble("size"); val W = c.getDouble("width")
    val px = (size * scale).toFloat(); val wpx = Math.floor(W * scale).toInt()
    val pDef = paint(file, px, lang, Paint.ANTI_ALIAS_FLAG)
    val pSub = paint(file, px, lang, Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG or Paint.LINEAR_TEXT_FLAG)
    val pSubOnly = paint(file, px, lang, Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    val pLinOnly = paint(file, px, lang, Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG)
    // Chrome applies font-optical-sizing:auto (opsz = CSS px size); Android does not, so set it explicitly for variable fonts.
    val pOpsz = paint(file, px, lang, Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG or Paint.LINEAR_TEXT_FLAG)
    if (file.contains("VF")) pOpsz.fontVariationSettings = "'opsz' ${size}"
    val hyph = pSub.getRunAdvance("‐", 0, 1, 0, 1, false, 1).toDouble() / scale
    val hyphDef = pDef.getRunAdvance("‐", 0, 1, 0, 1, false, 1).toDouble() / scale
    val fm = pDef.fontMetrics; val fmi = pDef.fontMetricsInt
    val r = JSONObject().put("id", c.getString("id"))
      .put("sl", staticLayout(text, pDef, wpx, scale, Layout.BREAK_STRATEGY_SIMPLE, Layout.HYPHENATION_FREQUENCY_NONE))
      .put("slSubpixel", staticLayout(text, pSub, wpx, scale, Layout.BREAK_STRATEGY_SIMPLE, Layout.HYPHENATION_FREQUENCY_NONE))
      .put("slSubpixelOnly", staticLayout(text, pSubOnly, wpx, scale, Layout.BREAK_STRATEGY_SIMPLE, Layout.HYPHENATION_FREQUENCY_NONE))
      .put("slLinearOnly", staticLayout(text, pLinOnly, wpx, scale, Layout.BREAK_STRATEGY_SIMPLE, Layout.HYPHENATION_FREQUENCY_NONE))
      .put("slHighQuality", staticLayout(text, pSub, wpx, scale, Layout.BREAK_STRATEGY_HIGH_QUALITY, Layout.HYPHENATION_FREQUENCY_NORMAL))
      .put("greedyICU", greedy(text, pSub, icuOpps(text, lang), W, scale, hyph))
      .put("greedyOracle", greedy(text, pSub, oracle["$lang|${c.getString("para")}"]!!, W, scale, hyph))
      .put("slOpsz", staticLayout(text, pOpsz, wpx, scale, Layout.BREAK_STRATEGY_SIMPLE, Layout.HYPHENATION_FREQUENCY_NONE))
      .put("greedyOracleOpsz", greedy(text, pOpsz, oracle["$lang|${c.getString("para")}"]!!, W, scale, hyph))
      .put("nowrapWidthOpsz", pOpsz.getRunAdvance(text, 0, text.length, 0, text.length, false, text.length).toDouble() / scale)
      .put("greedyOracleHinted", greedy(text, pDef, oracle["$lang|${c.getString("para")}"]!!, W, scale, hyphDef))
      .put("nowrapWidthHinted", pDef.getRunAdvance(text, 0, text.length, 0, text.length, false, text.length).toDouble() / scale)
      .put("nowrapWidth", pSub.getRunAdvance(text, 0, text.length, 0, text.length, false, text.length).toDouble() / scale)
      .put("ascent", -fm.ascent / scale).put("descent", fm.descent / scale).put("leading", fm.leading / scale)
      .put("top", -fm.top / scale).put("bottom", fm.bottom / scale)
      .put("ascentInt", -fmi.ascent / scale).put("descentInt", fmi.descent / scale)
      .put("hyphenWidth", hyph)
    out.put(r)
  }
  File(ctx.filesDir, "android-$scale.json").writeText(out.toString())
  // Token-level diagnostic: advances of individual tokens at 24px (unhinted), to localise kerning/ligature deltas.
  if (scale == 1.0) {
    val toks = JSONArray(asset("tokens.json")); val diag = JSONObject()
    for (f in listOf("Roboto-Regular.ttf", "Inter-Regular.ttf", "NotoSans-Regular.ttf")) {
      val p = paint(f, 24f, "en", Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG or Paint.LINEAR_TEXT_FLAG); val o = JSONObject()
      for (i in 0 until toks.length()) { val t = toks.getString(i); o.put(t, p.getRunAdvance(t, 0, t.length, 0, t.length, false, t.length).toDouble()) }
      diag.put(f, o)
    }
    val cases0 = JSONArray(asset("cases.json")); var kt = ""
    for (i in 0 until cases0.length()) if (cases0.getJSONObject(i).getString("para") == "kernlig") { kt = cases0.getJSONObject(i).getString("text"); break }
    val p = paint("Roboto-Regular.ttf", 24f, "en", Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG or Paint.LINEAR_TEXT_FLAG)
    val pg = android.graphics.text.TextRunShaper.shapeTextRun(kt, 0, kt.length, 0, kt.length, 0f, 0f, false, p)
    diag.put("textRunShaperAdvance", pg.advance.toDouble())
    val mt = android.graphics.text.MeasuredText.Builder(kt.toCharArray()).appendStyleRun(p, kt.length, false).build()
    diag.put("measuredTextWidth", mt.getWidth(0, kt.length).toDouble())
    diag.put("prefix", JSONArray((1..kt.length).map { p.getRunAdvance(kt, 0, it, 0, it, false, it).toDouble() }))
    File(ctx.filesDir, "tokens-android.json").writeText(diag.toString())
  }
  android.util.Log.i("TextSpike", "android sdk=${Build.VERSION.SDK_INT} scale=$scale cases=${out.length()}")
}
