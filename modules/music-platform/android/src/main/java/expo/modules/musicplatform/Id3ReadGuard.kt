package expo.modules.musicplatform

import java.io.InputStream
import java.io.IOException

/** Bounds ID3 data before extractor allocation, including junk prefixes and consecutive tags. */
internal object Id3ReadGuard {
  const val MAX_TAG_BYTES = 8 * 1024 * 1024
  const val MAX_SEARCH_BYTES = 128 * 1024
  const val MAX_PREFIX_BYTES = 12 * 1024 * 1024
  fun check(input: InputStream) {
    val header = ByteArray(10)
    var tags = 0
    var totalTagBytes = 0
    while (true) {
      for (i in header.indices) { val value = input.read(); if (value < 0) return; header[i] = value.toByte() }
      var searched = 0
      while (true) {
        if (header[0] == 73.toByte() && header[1] == 68.toByte() && header[2] == 51.toByte()) break
        val bits = ((header[0].toInt() and 255) shl 24) or ((header[1].toInt() and 255) shl 16) or
          ((header[2].toInt() and 255) shl 8) or (header[3].toInt() and 255)
        val mpeg = bits ushr 21 == 0x7ff && (bits ushr 19 and 3) != 1 && (bits ushr 17 and 3) != 0 &&
          (bits ushr 12 and 15) in 1..14 && (bits ushr 10 and 3) != 3
        if (mpeg || searched++ >= MAX_SEARCH_BYTES) return
        header.copyInto(header, 0, 1, 10)
        val value = input.read(); if (value < 0) return; header[9] = value.toByte()
      }
      var length = 0
      for (index in 6..9) {
        val value = header[index].toInt() and 255
        if (value > 127) throw IOException("Invalid audio metadata.")
        length = (length shl 7) or value
      }
      if (++tags > 16 || length > MAX_TAG_BYTES - totalTagBytes) throw IOException("Audio metadata exceeds the supported bound.")
      totalTagBytes += length
      val chunk = ByteArray(8192)
      var remaining = length
      while (remaining > 0) {
        val read = input.read(chunk, 0, minOf(chunk.size, remaining))
        if (read < 0) throw IOException("Truncated audio metadata.")
        remaining -= read
      }
    }
  }
}
