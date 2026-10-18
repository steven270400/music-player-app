package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class PrefixReplayTest {
  @Test fun zeroLengthReadPreservesPendingBytesAndDoesNotReadDelegate() {
    val replay = PrefixReplay(); replay.reset(byteArrayOf(1, 2, 3))
    val target = ByteArray(3)
    val forbidden: (ByteArray, Int, Int) -> Int = { _, _, _ -> error("Unexpected delegate read") }
    assertEquals(0, replay.read(target, 3, 0, forbidden))
    assertEquals(3, replay.read(target, 0, 3, forbidden))
    assertArrayEquals(byteArrayOf(1, 2, 3), target)
    assertEquals(0, replay.read(target, 0, 0, forbidden))
  }

  @Test fun chunkedReadsReplayExactlyOnceThenContinueAtDescriptorPosition() {
    val replay = PrefixReplay(); replay.reset(byteArrayOf(1, 2, 3))
    val remaining = ByteArrayInputStream(byteArrayOf(4, 5))
    val target = ByteArray(7)
    assertEquals(2, replay.read(target, 1, 2, remaining::read))
    assertEquals(1, replay.read(target, 3, 3, remaining::read))
    assertEquals(2, replay.read(target, 4, 3, remaining::read))
    assertEquals(-1, replay.read(target, 0, 1, remaining::read))
    assertArrayEquals(byteArrayOf(0, 1, 2, 3, 4, 5, 0), target)
  }

  @Test fun resetDropsUnreadBytesBeforeReopenOrSeek() {
    val replay = PrefixReplay(); replay.reset(byteArrayOf(1, 2))
    replay.reset()
    val target = ByteArray(2)
    assertEquals(-1, replay.read(target, 0, 2) { _, _, _ -> -1 })
    replay.reset(byteArrayOf(9))
    assertEquals(1, replay.read(target, 0, 2) { _, _, _ -> error("Unexpected delegate read") })
    assertEquals(9, target[0].toInt())
  }

  @Test fun emptyPrefixFallsThroughAndInvalidRangeDoesNotConsumeBytes() {
    val replay = PrefixReplay(); replay.reset(byteArrayOf())
    assertEquals(-1, replay.read(ByteArray(1), 0, 1) { _, _, _ -> -1 })
    replay.reset(byteArrayOf(7))
    assertThrows(IllegalArgumentException::class.java) {
      replay.read(ByteArray(1), 1, 1) { _, _, _ -> error("Unexpected delegate read") }
    }
    val target = ByteArray(1)
    assertEquals(1, replay.read(target, 0, 1) { _, _, _ -> -1 })
    assertEquals(7, target[0].toInt())
  }
}
