package expo.modules.musicplatform

/** An interruption may resume only the still-current, previously audible play intent. */
internal class PlaybackIntent {
  private var generation = 0L
  private var wantsPlay = false
  private var interrupted = false
  private var resume: Long? = null
  fun begin(): Long { cancel(); wantsPlay = true; return generation }
  fun cancel() { generation++; wantsPlay = false; interrupted = false; resume = null }
  fun current(token: Long): Boolean = token == generation && wantsPlay
  fun transientLoss(token: Long, wasPlaying: Boolean): Boolean {
    if (!current(token)) return false
    if (!interrupted) resume = token.takeIf { wasPlaying }
    interrupted = true
    return true
  }
  fun gain(token: Long): Boolean {
    if (!current(token) || resume != token) return false
    resume = null; interrupted = false
    return true
  }
}
