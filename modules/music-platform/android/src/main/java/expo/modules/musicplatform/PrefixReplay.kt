package expo.modules.musicplatform

/** Replays bytes consumed during inspection before continuing on the same descriptor. */
internal class PrefixReplay {
  private var bytes: ByteArray? = null
  private var position = 0

  fun reset(prefix: ByteArray? = null) { bytes = prefix; position = 0 }

  fun read(target: ByteArray, offset: Int, length: Int, readRemaining: (ByteArray, Int, Int) -> Int): Int {
    require(offset >= 0 && length >= 0 && offset <= target.size - length)
    if (length == 0) return 0
    bytes?.let { prefix ->
      val count = minOf(length, prefix.size - position)
      if (count > 0) {
        prefix.copyInto(target, offset, position, position + count)
        position += count
        if (position == prefix.size) reset()
        return count
      }
      reset()
    }
    return readRemaining(target, offset, length)
  }
}
