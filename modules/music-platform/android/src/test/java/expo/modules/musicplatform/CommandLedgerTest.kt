package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test

class CommandLedgerTest {
  @Test fun acceptedReplayPrecedesChangedQueueAndPermissionChecks() {
    val ledger = CommandLedger<String>(); var effects = 0
    val command = listOf("select", "entry-a", "revision-1")
    val first = ledger.dispatch("id", command, { true }, { null }, { effects++; "accepted-state-1" }, { it })
    val replay = ledger.dispatch("id", command, { error("Must not read changed queue") },
      { error("Must not recheck permission on replay") }, { effects++; "wrong" }, { it })
    assertEquals(first, replay); assertEquals(1, effects)
  }
  @Test fun sameIdWithDifferentPayloadNeverExecutes() {
    val ledger = CommandLedger<String>()
    ledger.dispatch("id", "play", { true }, { null }, { "accepted" }, { it })
    assertEquals("INVALID_COMMAND", ledger.dispatch("id", "seek", { true }, { null }, { error("Unexpected effect") }, { it }))
  }
  @Test fun staleCommandDoesNotValidateOrExecute() {
    val ledger = CommandLedger<String>()
    assertEquals("STALE_COMMAND", ledger.dispatch("id", "next", { false }, { error("Unexpected validation") }, { error("Unexpected effect") }, { it }))
  }
  @Test fun deniedCommandCanBeRetriedAfterPermissionRecovery() {
    val ledger = CommandLedger<String>()
    assertEquals("ACCESS_REQUIRED", ledger.dispatch("id", "play", { true }, { "ACCESS_REQUIRED" }, { error("Unexpected effect") }, { it }))
    assertEquals("accepted", ledger.dispatch("id", "play", { true }, { null }, { "accepted" }, { it }))
  }
  @Test fun boundedHistoryEvictsOnlyOldestReceipt() {
    val ledger = CommandLedger<String>(2)
    for (id in listOf("a", "b", "c")) ledger.dispatch(id, id, { true }, { null }, { id }, { it })
    assertEquals("b", ledger.dispatch("b", "b", { false }, { null }, { error("Unexpected effect") }, { it }))
    assertEquals("STALE_COMMAND", ledger.dispatch("a", "a", { false }, { null }, { error("Unexpected effect") }, { it }))
  }
}
