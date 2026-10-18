package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test

class PlaybackIntentTest {
  @Test fun previouslyPlayingCanResumeOnlyOnce() {
    val policy = PlaybackIntent(); val token = policy.begin()
    assertTrue(policy.transientLoss(token, true)); assertTrue(policy.gain(token)); assertFalse(policy.gain(token))
  }
  @Test fun loadingAtInterruptionDoesNotResumeAutomatically() {
    val policy = PlaybackIntent(); val token = policy.begin()
    policy.transientLoss(token, false); assertFalse(policy.gain(token))
  }
  @Test fun laterPauseOrDisconnectCancelsResume() {
    val policy = PlaybackIntent(); val token = policy.begin()
    policy.transientLoss(token, true); policy.cancel(); assertFalse(policy.gain(token))
  }
  @Test fun replacementQueueIgnoresOldFocusCallbacks() {
    val policy = PlaybackIntent(); val old = policy.begin()
    policy.transientLoss(old, true); val fresh = policy.begin()
    assertFalse(policy.gain(old)); assertFalse(policy.transientLoss(old, true)); assertTrue(policy.current(fresh))
  }
  @Test fun repeatedLossDoesNotEraseAnEligibleResume() {
    val policy = PlaybackIntent(); val token = policy.begin()
    policy.transientLoss(token, true); policy.transientLoss(token, false); assertTrue(policy.gain(token))
  }
  @Test fun gainWithoutInterruptionNeverStartsPlayback() {
    val policy = PlaybackIntent(); val token = policy.begin(); assertFalse(policy.gain(token))
  }
  @Test fun anotherInterruptionAfterResumeGetsANewEligibilityDecision() {
    val policy = PlaybackIntent(); val token = policy.begin()
    policy.transientLoss(token, true); assertTrue(policy.gain(token))
    policy.transientLoss(token, false); assertFalse(policy.gain(token))
  }
}
