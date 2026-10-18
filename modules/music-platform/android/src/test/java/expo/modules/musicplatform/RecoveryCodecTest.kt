package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class RecoveryCodecTest {
  private fun snapshot(): PlaybackContracts.Recovery {
    val song = PlaybackContracts.Song(PlaybackContracts.Binding("epoch", "9223372036854775807", "9007199254740993"),
      "繁體中文 简体中文 Cafe\u0301 🎵.mp3", 12000, null, "title")
    return PlaybackContracts.Recovery(listOf(PlaybackContracts.Entry("a", song)), listOf("a"), listOf("a"), "a", 8000, false)
  }
  @Test fun roundTripPreservesUnicodeIdentityAndPausedContext() {
    assertEquals(snapshot(), RecoveryCodec.decode(RecoveryCodec.encode(snapshot())))
  }
  @Test fun allTruncatedPrefixesAreRejected() {
    val bytes = RecoveryCodec.encode(snapshot())
    for (length in 0 until bytes.size) assertThrows(PlaybackContracts.Invalid::class.java) { RecoveryCodec.decode(bytes.copyOf(length)) }
  }
  @Test fun unknownVersionAndTrailingDataAreRejected() {
    val bytes = RecoveryCodec.encode(snapshot())
    val unknown = bytes.copyOf(); unknown[7] = 2
    assertThrows(PlaybackContracts.Invalid::class.java) { RecoveryCodec.decode(unknown) }
    assertThrows(PlaybackContracts.Invalid::class.java) { RecoveryCodec.decode(bytes + byteArrayOf(0)) }
  }
  @Test fun oversizedInputIsRejectedDuringRead() {
    assertThrows(PlaybackContracts.Invalid::class.java) { RecoveryCodec.readBounded(ByteArrayInputStream(ByteArray(RecoveryCodec.MAX_BYTES + 1))) }
  }
  @Test fun writeValidationRejectsCorruptMembership() {
    assertThrows(PlaybackContracts.Invalid::class.java) { RecoveryCodec.encode(snapshot().copy(currentEntryId = "missing")) }
  }
  @Test fun positionIsClampedAndEndedFlagSurvives() {
    val actual = RecoveryCodec.decode(RecoveryCodec.encode(snapshot().copy(positionMs = 99000, ended = true)))
    assertEquals(12000L, actual.positionMs)
    assertTrue(actual.ended)
  }
  @Test fun savedPlaybackOrderWinsOverEntrySerializationOrder() {
    val original = snapshot()
    val entries = original.entries + original.entries.first().copy(entryId = "b")
    val reordered = original.copy(entries = entries, originalOrder = listOf("b", "a"), playbackOrder = listOf("b", "a"))
    val actual = RecoveryCodec.decode(RecoveryCodec.encode(reordered))
    assertEquals(listOf("b", "a"), actual.orderedEntries().map { it.entryId })
    assertEquals("a", actual.currentEntryId)
  }
  @Test fun invalidUnicodeCannotSilentlyChangeSavedFilename() {
    val original = snapshot()
    val malformed = original.entries.first().let { it.copy(song = it.song.copy(filename = "bad\uD800.mp3")) }
    assertThrows(PlaybackContracts.Invalid::class.java) { RecoveryCodec.encode(original.copy(entries = listOf(malformed))) }
  }
  @Test fun invalidBooleanEncodingIsRejected() {
    val bytes = RecoveryCodec.encode(snapshot()); bytes[bytes.lastIndex] = 2
    assertThrows(PlaybackContracts.Invalid::class.java) { RecoveryCodec.decode(bytes) }
  }
}
