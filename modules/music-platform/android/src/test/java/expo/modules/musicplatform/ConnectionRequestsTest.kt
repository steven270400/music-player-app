package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test

class ConnectionRequestsTest {
  @Test fun timeoutPreventsLateCommandExecutionAndAllowsRetry() {
    val requests = ConnectionRequests<String>()
    val old = requests.add("play")
    assertTrue(requests.consume(old, "play"))
    assertEquals(emptyList<String>(), requests.retire(old))
    val retry = requests.add("retry")
    assertFalse(requests.consume(old, "play"))
    assertTrue(requests.consume(retry, "retry"))
  }
  @Test fun oldDisconnectCannotCancelNewConnectionRequests() {
    val requests = ConnectionRequests<String>()
    val old = requests.add("old")
    assertEquals(listOf("old"), requests.retire(old))
    val current = requests.add("new")
    assertNull(requests.retire(old))
    assertTrue(requests.consume(current, "new"))
  }
  @Test fun disconnectSettlesEveryPendingRequestExactlyOnce() {
    val requests = ConnectionRequests<String>()
    val epoch = requests.add("play")
    requests.add("pause")
    assertEquals(listOf("play", "pause"), requests.retire(epoch))
    assertFalse(requests.consume(epoch, "play"))
    assertFalse(requests.consume(epoch, "pause"))
    assertNull(requests.retire(epoch))
  }
  @Test fun oneTimeoutDoesNotConsumeOtherPendingWork() {
    val requests = ConnectionRequests<String>()
    val epoch = requests.add("read")
    requests.add("pause")
    assertTrue(requests.consume(epoch, "read"))
    assertFalse(requests.isEmpty)
    assertTrue(requests.consume(epoch, "pause"))
    assertTrue(requests.isEmpty)
  }
}
