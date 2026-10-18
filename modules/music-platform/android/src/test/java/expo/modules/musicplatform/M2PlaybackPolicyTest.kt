package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class M2PlaybackPolicyTest {
  private val order = listOf("a", "b", "c", "d", "e", "f")
  private val header = mapOf("operationId" to "mode", "sessionId" to "session", "expectedQueueRevision" to 4)

  @Test fun manualNextBypassesRepeatOneAndOnlyAllWraps() {
    for (mode in listOf("off", "one", "all")) {
      assertEquals(2, QueuePolicy.nextIndex(1, 3, mode))
      assertNull(QueuePolicy.nextIndex(0, 0, mode))
    }
    assertNull(QueuePolicy.nextIndex(2, 3, "off"))
    assertNull(QueuePolicy.nextIndex(2, 3, "one"))
    assertEquals(0, QueuePolicy.nextIndex(2, 3, "all"))
    assertEquals(0, QueuePolicy.nextIndex(0, 1, "all"))
  }

  @Test fun shuffleKeepsHistoryAndCurrentWithoutRepeatingRemainingSongs() {
    val permutations = (0..30).map { QueuePolicy.shuffleRemaining(order, "b", Random(it)) }
    permutations.forEach { shuffled ->
      assertEquals(listOf("a", "b"), shuffled.take(2))
      assertEquals(order.drop(2).toSet(), shuffled.drop(2).toSet())
      assertEquals(order.size, shuffled.distinct().size)
    }
    assertTrue(permutations.distinct().size > 1)
    assertEquals(order, QueuePolicy.shuffleRemaining(order, "f", Random(1)))
    assertEquals(listOf("a"), QueuePolicy.shuffleRemaining(listOf("a"), "a"))
  }

  @Test fun eachNewCycleIsACompletePermutation() {
    assertEquals(order, QueuePolicy.nextCycle(order, false))
    for (seed in 0..30) {
      val cycle = QueuePolicy.nextCycle(order, true, Random(seed))
      assertEquals(order.toSet(), cycle.toSet())
      assertEquals(order.size, cycle.distinct().size)
    }
  }

  @Test fun failureTraversalStopsEvenWhenRepeatAllWraps() {
    val attempt = QueuePolicy.LoadAttempt(order, "d", wrap = true)
    assertEquals(listOf("d", "e", "f", "a", "b", "c"), List(6) { attempt.next() })
    repeat(100) { assertNull(attempt.next()) }
    val single = QueuePolicy.LoadAttempt(listOf("a"), "a", wrap = true)
    assertEquals("a", single.next())
    assertNull(single.next())
  }

  @Test fun modesHaveStrictBridgePayloadsAndParticipateInStaleChecks() {
    for (mode in listOf("off", "one", "all")) {
      assertEquals(mode, PlaybackContracts.command(header + mapOf("action" to "setRepeat", "repeat" to mode)).repeat)
    }
    assertEquals(true, PlaybackContracts.command(header + mapOf("action" to "setShuffle", "shuffle" to true)).shuffle)
    for (payload in listOf(mapOf("action" to "setShuffle", "shuffle" to "true"),
      mapOf("action" to "setRepeat", "repeat" to "random"), mapOf("action" to "setRepeat"))) {
      assertThrows(PlaybackContracts.Invalid::class.java) { PlaybackContracts.command(header + payload) }
    }
    val command = PlaybackContracts.command(header + mapOf("action" to "setRepeat", "repeat" to "all"))
    assertFalse(PlaybackContracts.isCurrent(command.header, "session", 5, command.action))
  }

  @Test fun savedModesAndActualOrderRoundTripWithoutReshuffling() {
    val song = PlaybackContracts.Song(PlaybackContracts.Binding("epoch", "1", "1"), "tone.mp3", 12000, null, null)
    for (mode in listOf("off", "one", "all")) {
      val shuffled = listOf("a", "d", "f", "b", "c", "e")
      val snapshot = PlaybackContracts.Recovery(order.map { PlaybackContracts.Entry(it, song) }, order,
        shuffled, "f", 5000, false, mode, true)
      val restored = RecoveryCodec.decode(RecoveryCodec.encode(snapshot))
      assertEquals(snapshot, restored)
      assertEquals(shuffled, restored.orderedEntries().map { it.entryId })
    }
  }

  @Test fun endedContextSurvivesChangingModesOrRestoringOriginalOrder() {
    val song = PlaybackContracts.Song(PlaybackContracts.Binding("epoch", "1", "1"), "tone.mp3", 12000, null, null)
    val snapshot = PlaybackContracts.Recovery(order.map { PlaybackContracts.Entry(it, song) }, order, order,
      "b", 12000, true, "all", false)
    assertEquals(snapshot, RecoveryCodec.decode(RecoveryCodec.encode(snapshot)))
  }

  @Test fun positionAtKnownEndRestoresEndedEvenWhenCheckpointFlagWasNotYetSet() {
    val song = PlaybackContracts.Song(PlaybackContracts.Binding("epoch", "1", "1"), "tone.mp3", 12000, null, null)
    val snapshot = PlaybackContracts.Recovery(listOf(PlaybackContracts.Entry("a", song)), listOf("a"), listOf("a"),
      "a", 12000, false, "all", false)
    assertTrue(RecoveryCodec.decode(RecoveryCodec.encode(snapshot)).ended)
    assertEquals(12000L, RecoveryCodec.decode(RecoveryCodec.encode(snapshot.copy(positionMs = 99000))).positionMs)
    assertFalse(RecoveryCodec.decode(RecoveryCodec.encode(snapshot.copy(positionMs = 11999))).ended)
  }
}
