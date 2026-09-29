// A minimal JSON reader for transcripts (the JVM has none built in). Numbers stay as their source text.
package dev.dragon.text

class JsonNumber(val text: String) {
    fun toLong(): Long = text.toLong()
    /** A JSON number as the shim's f32 argument: parsed as a double, then rounded to f32 (as JS ToFloat32 does). */
    fun toF32(): Float = text.toDouble().toFloat()
}

class JsonReader(private val s: String) {
    private var i = 0

    fun parse(): Any? {
        val v = value()
        ws()
        require(i == s.length) { "trailing data at $i" }
        return v
    }

    private fun ws() {
        while (i < s.length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++
    }

    private fun value(): Any? {
        ws()
        require(i < s.length) { "unexpected end" }
        return when (val c = s[i]) {
            '{' -> {
                i++
                val m = LinkedHashMap<String, Any?>()
                ws()
                if (s[i] == '}') { i++; return m }
                do {
                    ws()
                    val k = string()
                    ws()
                    require(s[i] == ':') { "expected : at $i" }
                    i++
                    m[k] = value()
                    ws()
                    val more = s[i] == ','
                    require(more || s[i] == '}') { "expected } at $i" }
                    i++
                } while (more)
                m
            }
            '[' -> {
                i++
                val a = ArrayList<Any?>()
                ws()
                if (s[i] == ']') { i++; return a }
                do {
                    a.add(value())
                    ws()
                    val more = s[i] == ','
                    require(more || s[i] == ']') { "expected ] at $i" }
                    i++
                } while (more)
                a
            }
            '"' -> string()
            't' -> { expectWord("true"); true }
            'f' -> { expectWord("false"); false }
            'n' -> { expectWord("null"); null }
            else -> {
                require(c == '-' || c in '0'..'9') { "unexpected $c at $i" }
                val start = i
                while (i < s.length && (s[i] in '0'..'9' || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++
                JsonNumber(s.substring(start, i))
            }
        }
    }

    private fun expectWord(w: String) {
        require(s.startsWith(w, i)) { "expected $w at $i" }
        i += w.length
    }

    private fun string(): String {
        require(s[i] == '"') { "expected string at $i" }
        i++
        val b = StringBuilder()
        while (true) {
            val c = s[i++]
            when (c) {
                '"' -> return b.toString()
                '\\' -> when (val e = s[i++]) {
                    '"' -> b.append('"')
                    '\\' -> b.append('\\')
                    '/' -> b.append('/')
                    'b' -> b.append('\b')
                    'f' -> b.append('\u000c')
                    'n' -> b.append('\n')
                    'r' -> b.append('\r')
                    't' -> b.append('\t')
                    'u' -> { b.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
                    else -> throw IllegalArgumentException("bad escape \\$e at $i")
                }
                else -> b.append(c)
            }
        }
    }
}
