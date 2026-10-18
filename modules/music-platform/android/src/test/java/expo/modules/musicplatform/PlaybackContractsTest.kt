package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test

class PlaybackContractsTest {
  private val binding = PlaybackContracts.Binding("epoch", "9223372036854775807", "9007199254740993")
  private fun song() = PlaybackContracts.Song(binding, "简体中文 繁體中文 Cafe\u0301 🎵.mp3", 12000, null, null)
  private fun entries() = listOf(PlaybackContracts.Entry("a", song()), PlaybackContracts.Entry("b", song()))
  private fun replacement() = mapOf("operationId" to "op", "sessionId" to "session", "expectedQueueRevision" to 2.0,
    "entries" to entries().map { it.wire() }, "selectedEntryId" to "a")
  private fun snapshot() = PlaybackContracts.Recovery(entries(), listOf("a", "b"), listOf("a", "b"), "b", 5000, false).wire()
  private fun rejects(block: () -> Unit) { assertThrows(PlaybackContracts.Invalid::class.java) { block() } }

  @Test fun multilingualNamesAnd64BitBindingsRoundTripExactly() {
    val parsed = PlaybackContracts.replacement(replacement())
    assertEquals(song(), parsed.entries.first().song)
    assertEquals("9007199254740993", parsed.entries.first().song.binding.generationAdded)
  }
  @Test fun malformedNumbersCannotBecomePositionsOrRevisions() {
    listOf(null, "1", true, -1, Double.NaN, Double.POSITIVE_INFINITY, 1.5,
      9_007_199_254_740_992L, Long.MAX_VALUE).forEach { rejects { PlaybackContracts.integer(it) } }
    assertEquals(PlaybackContracts.MAX_SAFE_INTEGER, PlaybackContracts.integer(9_007_199_254_740_991L))
  }
  @Test fun arbitrarySourcesAndForgedIdentityAreRejected() {
    val source = binding.wire()
    listOf(source + ("volume" to "external"), source + ("rowId" to "../1"),
      source + ("rowId" to "01"), source + ("rowId" to "9223372036854775808"),
      source + ("providerVersion" to "a\u0000b")).forEach {
      rejects { PlaybackContracts.song(song().wire() + ("binding" to it)) }
    }
    rejects { PlaybackContracts.song(song().wire() + ("songId" to "forged")) }
  }
  @Test fun queueRequiresUniqueEntriesAndSelectedMembership() {
    val duplicate = listOf(entries()[0].wire(), entries()[0].wire())
    rejects { PlaybackContracts.replacement(replacement() + ("entries" to duplicate)) }
    rejects { PlaybackContracts.replacement(replacement() + ("entries" to emptyList<Any>())) }
    rejects { PlaybackContracts.replacement(replacement() + ("selectedEntryId" to "missing")) }
    // Same song can occur under distinct queue entry IDs.
    assertEquals(2, PlaybackContracts.replacement(replacement()).entries.size)
  }
  @Test fun boundedMetadataIsRejectedWithoutTruncatingFilename() {
    rejects { PlaybackContracts.song(song().wire() + ("filename" to "x".repeat(4097))) }
    rejects { PlaybackContracts.song(song().wire() + ("artist" to "x".repeat(513))) }
    assertEquals("x".repeat(4096), PlaybackContracts.song(song().wire() + ("filename" to "x".repeat(4096))).filename)
  }
  @Test fun commandPayloadsAndUnsupportedModesAreValidated() {
    val common = mapOf("operationId" to "op", "sessionId" to "s", "expectedQueueRevision" to 0)
    rejects { PlaybackContracts.command(common + ("action" to "repeat")) }
    rejects { PlaybackContracts.command(common + ("action" to "seek")) }
    rejects { PlaybackContracts.command(common + ("action" to "select")) }
    assertEquals(42L, PlaybackContracts.command(common + mapOf("action" to "seek", "positionMs" to 42)).positionMs)
  }
  @Test fun pauseSurvivesQueueChangesButNeverServiceReplacement() {
    val header = PlaybackContracts.Header("op", "s", 2)
    assertTrue(PlaybackContracts.isCurrent(header, "s", 3, "pause"))
    assertFalse(PlaybackContracts.isCurrent(header, "s", 3, "seek"))
    assertFalse(PlaybackContracts.isCurrent(header, "new", 2, "pause"))
  }
  @Test fun recoveryClampsPositionAndPreservesIdentity() {
    val recovered = PlaybackContracts.recovery(snapshot() + ("positionMs" to 99000))
    assertEquals(12000L, recovered.positionMs)
    assertEquals(entries(), recovered.entries)
    assertEquals(recovered, PlaybackContracts.recovery(recovered.wire()))
  }
  @Test fun recoveryRejectsUnknownSchemaModesAndCorruptOrders() {
    listOf(snapshot() + ("version" to 2), snapshot() + ("shuffle" to "true"),
      snapshot() + ("repeat" to "invalid"), snapshot() + ("originalOrder" to listOf("a", "a")),
      snapshot() + ("playbackOrder" to listOf("b", "a")), snapshot() + ("currentEntryId" to "missing"),
      snapshot() + ("positionMs" to Double.NaN)
    ).forEach { rejects { PlaybackContracts.recovery(it) } }
  }
  @Test fun previousUsesThreeSecondBoundaryAndFirstTrackRestarts() {
    assertEquals(1, QueuePolicy.previousIndex(2, 3000))
    assertEquals(2, QueuePolicy.previousIndex(2, 3001))
    assertEquals(0, QueuePolicy.previousIndex(0, 0))
    assertEquals(0, QueuePolicy.previousIndex(0, 4000))
  }
  @Test fun nextAtLastEntryCannotWrap() {
    assertEquals(1, QueuePolicy.nextIndex(0, 3))
    assertNull(QueuePolicy.nextIndex(2, 3))
    assertNull(QueuePolicy.nextIndex(0, 0))
  }
  @Test fun invalidSourcesAreTriedOnceWithoutWrappingOrMutatingQueue() {
    val queue = mutableListOf("a", "b", "c")
    val attempt = QueuePolicy.LoadAttempt(queue, "b")
    queue.clear()
    assertEquals("b", attempt.next())
    assertEquals("c", attempt.next())
    repeat(100) { assertNull(attempt.next()) }
  }
}
