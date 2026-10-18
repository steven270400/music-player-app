package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException

class Id3ReadGuardTest {
  private fun tag(length: Int) = byteArrayOf(73, 68, 51, 4, 0, 0,
    (length ushr 21 and 127).toByte(), (length ushr 14 and 127).toByte(),
    (length ushr 7 and 127).toByte(), (length and 127).toByte())
  @Test fun hugeAdvertisedTagFailsBeforePayloadAllocationOrRead() {
    val input = ByteArrayInputStream(tag(0x0fffffff) + byteArrayOf(1, 2, 3))
    assertThrows(IOException::class.java) { Id3ReadGuard.check(input) }
    assertEquals(3, input.available())
  }
  @Test fun junkPrefixCannotHideHugeId3Header() {
    assertThrows(IOException::class.java) { Id3ReadGuard.check(ByteArrayInputStream(ByteArray(4096) + tag(0x0fffffff))) }
  }
  @Test fun repeatedTagsHaveACountBound() {
    assertThrows(IOException::class.java) { Id3ReadGuard.check(ByteArrayInputStream((1..17).flatMap { tag(0).toList() }.toByteArray())) }
  }
  @Test fun validSmallTagAndMpegFrameAreAccepted() {
    val audio = byteArrayOf(0xff.toByte(), 0xfb.toByte(), 0x90.toByte(), 0) + ByteArray(20)
    Id3ReadGuard.check(ByteArrayInputStream(tag(4) + ByteArray(4) + audio))
  }
  @Test fun truncatedPayloadAndInvalidSizeEncodingAreRejected() {
    assertThrows(IOException::class.java) { Id3ReadGuard.check(ByteArrayInputStream(tag(100) + ByteArray(2))) }
    val invalid = tag(0); invalid[6] = 0xff.toByte()
    assertThrows(IOException::class.java) { Id3ReadGuard.check(ByteArrayInputStream(invalid)) }
  }
}
