// Android emulator replay (T029): compiled by scripts/replay-device.ts with kotlin/src, dexed with d8 and run under
// app_process. Arguments: --lib <libdragon_hb.so> <transcript.json> <root>.
package dev.dragon.text

import kotlin.system.exitProcess

object DeviceMain {
    @JvmStatic
    fun main(args: Array<String>) {
        exitProcess(replayMain("kotlin (android, ${System.getProperty("os.arch")})", args))
    }
}
