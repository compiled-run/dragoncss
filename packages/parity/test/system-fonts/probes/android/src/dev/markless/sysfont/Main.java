package dev.markless.sysfont;

import android.app.Activity;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.fonts.Font;
import android.graphics.fonts.FontVariationAxis;
import android.graphics.fonts.SystemFonts;
import android.graphics.text.PositionedGlyphs;
import android.graphics.text.TextRunShaper;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class Main extends Activity {
    static final String TAG = "SYSFONT";
    static final String BASE = "http://10.0.2.2:8766";
    static final int[] SIZES = {12, 16, 17, 24, 28};
    static final String[] STRINGS = {"Hamburgefonstiv", "The quick brown fox jumps over the lazy dog", "Waffles, quays and fjords", "0123456789", "AVATAR Type office", "iiiii WWWWW"};

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        WebView.setWebContentsDebuggingEnabled(true);
        WebView wv = new WebView(this);
        wv.getSettings().setJavaScriptEnabled(true);
        wv.getSettings().setTextZoom(100);
        wv.getSettings().setUseWideViewPort(true);
        wv.getSettings().setLoadWithOverviewMode(false);
        wv.setWebViewClient(new WebViewClient());
        wv.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) { Log.i(TAG, "console: " + m.message()); return true; }
        });
        wv.addJavascriptInterface(new Bridge(), "SysfontBridge");
        setContentView(wv);
        wv.loadUrl(BASE + "/?name=android-webview");
        new Thread(() -> {
            try {
                String json = paintJson().toString();
                post("android-paint", json);
                Log.i(TAG, "paint posted " + json.length());
            } catch (Throwable t) { Log.e(TAG, "paint failed", t); }
        }).start();
    }

    static class Bridge {
        @JavascriptInterface public void chunk(String name, int off, String s) { Log.i(TAG, "chunk " + name + " " + off + " " + s.length()); }
        @JavascriptInterface public void done(String name, int len) { Log.i(TAG, "webview done " + name + " " + len); }
    }

    static void post(String name, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + "/result?name=" + name).openConnection();
        c.setRequestMethod("POST"); c.setDoOutput(true);
        c.setRequestProperty("content-type", "text/plain");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        c.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream o = c.getOutputStream()) { o.write(bytes); }
        Log.i(TAG, "post " + name + " -> " + c.getResponseCode());
        c.disconnect();
    }

    static JSONObject fontJson(Font f) throws Exception {
        JSONObject o = new JSONObject();
        o.put("file", f.getFile() == null ? JSONObject.NULL : f.getFile().getPath());
        o.put("ttcIndex", f.getTtcIndex());
        o.put("weight", f.getStyle().getWeight());
        o.put("slant", f.getStyle().getSlant());
        JSONArray ax = new JSONArray();
        FontVariationAxis[] axes = f.getAxes();
        if (axes != null) for (FontVariationAxis a : axes) ax.put(a.getTag() + "=" + a.getStyleValue());
        o.put("axes", ax);
        return o;
    }

    JSONObject paintJson() throws Exception {
        float density = getResources().getDisplayMetrics().density;
        JSONObject root = new JSONObject();
        root.put("density", (double) density);
        root.put("densityDpi", getResources().getDisplayMetrics().densityDpi);
        root.put("fingerprint", Build.FINGERPRINT);
        root.put("sdk", Build.VERSION.SDK_INT);
        JSONArray sys = new JSONArray();
        for (Font f : SystemFonts.getAvailableFonts()) sys.put(fontJson(f));
        root.put("systemFonts", sys);

        String[] names = {"DEFAULT", "DEFAULT_BOLD", "SANS_SERIF", "SERIF", "MONOSPACE",
            "create(sans-serif,NORMAL)", "create(sans-serif,BOLD)", "create(serif,NORMAL)", "create(serif,BOLD)",
            "create(monospace,NORMAL)", "create(monospace,BOLD)", "create(system-ui,NORMAL)", "create(system-ui,BOLD)",
            "create(serif-monospace,NORMAL)", "create(serif-monospace,BOLD)", "create(cursive,NORMAL)", "create(cursive,BOLD)",
            "create(DEFAULT,700,false)", "create(SANS_SERIF,700,false)", "create(SERIF,700,false)", "create(MONOSPACE,700,false)",
            "create(create(system-ui,NORMAL),700,false)", "create(create(serif-monospace,NORMAL),700,false)",
            "create(DEFAULT,400,false)", "create(SERIF,400,false)", "create(MONOSPACE,400,false)"};
        Typeface[] tfs = {Typeface.DEFAULT, Typeface.DEFAULT_BOLD, Typeface.SANS_SERIF, Typeface.SERIF, Typeface.MONOSPACE,
            Typeface.create("sans-serif", Typeface.NORMAL), Typeface.create("sans-serif", Typeface.BOLD),
            Typeface.create("serif", Typeface.NORMAL), Typeface.create("serif", Typeface.BOLD),
            Typeface.create("monospace", Typeface.NORMAL), Typeface.create("monospace", Typeface.BOLD),
            Typeface.create("system-ui", Typeface.NORMAL), Typeface.create("system-ui", Typeface.BOLD),
            Typeface.create("serif-monospace", Typeface.NORMAL), Typeface.create("serif-monospace", Typeface.BOLD),
            Typeface.create("cursive", Typeface.NORMAL), Typeface.create("cursive", Typeface.BOLD),
            Typeface.create(Typeface.DEFAULT, 700, false), Typeface.create(Typeface.SANS_SERIF, 700, false),
            Typeface.create(Typeface.SERIF, 700, false), Typeface.create(Typeface.MONOSPACE, 700, false),
            Typeface.create(Typeface.create("system-ui", Typeface.NORMAL), 700, false), Typeface.create(Typeface.create("serif-monospace", Typeface.NORMAL), 700, false),
            Typeface.create(Typeface.DEFAULT, 400, false), Typeface.create(Typeface.SERIF, 400, false), Typeface.create(Typeface.MONOSPACE, 400, false)};
        String[] flagNames = {"default", "antialias+subpixel", "antialias+subpixel+linear"};
        int[] flagVals = {0, Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG, Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG | Paint.LINEAR_TEXT_FLAG};
        JSONArray results = new JSONArray();
        for (int t = 0; t < tfs.length; t++) {
            Typeface tf = tfs[t];
            JSONObject tj = new JSONObject();
            tj.put("candidate", names[t]);
            tj.put("weight", tf.getWeight());
            tj.put("style", tf.getStyle());
            String sysName = null;
            try { sysName = tf.getSystemFontFamilyName(); } catch (Throwable ignore) {}
            tj.put("systemFontFamilyName", sysName == null ? JSONObject.NULL : sysName);
            JSONArray sizes = new JSONArray();
            for (int css : SIZES) {
                JSONObject sj = new JSONObject();
                float px = css * density;
                sj.put("cssPx", css); sj.put("devicePx", (double) px);
                JSONObject byFlags = new JSONObject();
                for (int fi = 0; fi < flagVals.length; fi++) {
                    Paint p = new Paint(flagVals[fi]);
                    p.setTypeface(tf); p.setTextSize(px);
                    JSONObject fj = new JSONObject();
                    fj.put("flags", p.getFlags());
                    Paint.FontMetrics fm = p.getFontMetrics();
                    JSONObject m = new JSONObject();
                    m.put("ascent", (double) fm.ascent); m.put("descent", (double) fm.descent); m.put("leading", (double) fm.leading);
                    m.put("top", (double) fm.top); m.put("bottom", (double) fm.bottom); m.put("fontSpacing", (double) p.getFontSpacing());
                    Paint.FontMetricsInt fmi = p.getFontMetricsInt();
                    m.put("int", new JSONArray(new int[]{fmi.top, fmi.ascent, fmi.descent, fmi.bottom, fmi.leading}));
                    fj.put("fontMetrics", m);
                    JSONArray lines = new JSONArray();
                    for (String s : STRINGS) {
                        JSONObject lj = new JSONObject();
                        int n = s.length();
                        lj.put("text", s);
                        lj.put("measureText", (double) p.measureText(s));
                        lj.put("runAdvance", (double) p.getRunAdvance(s, 0, n, 0, n, false, n));
                        float[] w = new float[n];
                        p.getTextWidths(s, w);
                        JSONArray wa = new JSONArray(); for (float x : w) wa.put((double) x);
                        lj.put("textWidths", wa);
                        JSONArray prefix = new JSONArray();
                        for (int i = 0; i <= n; i++) prefix.put((double) p.getRunAdvance(s, 0, n, 0, n, false, i));
                        lj.put("runAdvancePrefix", prefix);
                        if (true) {
                            PositionedGlyphs g = TextRunShaper.shapeTextRun(s, 0, n, 0, n, 0f, 0f, false, p);
                            JSONArray ids = new JSONArray(), xs = new JSONArray(), fonts = new JSONArray();
                            String lastFont = null;
                            for (int i = 0; i < g.glyphCount(); i++) {
                                ids.put(g.getGlyphId(i)); xs.put((double) g.getGlyphX(i));
                                Font f = g.getFont(i);
                                String fs = f.getFile() == null ? "?" : f.getFile().getPath() + "#" + f.getTtcIndex() + fontJson(f).getJSONArray("axes");
                                if (!fs.equals(lastFont)) {
                                    JSONObject fo = fontJson(f); fo.put("fromGlyph", i);
                                    Paint.FontMetrics ffm = new Paint.FontMetrics();
                                    f.getMetrics(p, ffm);
                                    fo.put("fontGetMetrics", new JSONArray(new double[]{ffm.top, ffm.ascent, ffm.descent, ffm.bottom, ffm.leading}));
                                    fonts.put(fo); lastFont = fs;
                                }
                            }
                            JSONObject shaped = new JSONObject();
                            shaped.put("glyphIds", ids); shaped.put("x", xs); shaped.put("advance", (double) g.getAdvance());
                            shaped.put("ascent", (double) g.getAscent()); shaped.put("descent", (double) g.getDescent());
                            shaped.put("fonts", fonts);
                            lj.put("shaped", shaped);
                        }
                        lines.put(lj);
                    }
                    fj.put("lines", lines);
                    byFlags.put(flagNames[fi], fj);
                }
                sj.put("byPaintFlags", byFlags);
                sizes.put(sj);
            }
            tj.put("sizes", sizes);
            results.put(tj);
        }
        root.put("results", results);
        return root;
    }
}
