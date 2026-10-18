package expo.modules.musicplatform

/** Main-thread ownership prevents expired connections from consuming replacement requests. */
internal class ConnectionRequests<T> {
  var epoch = 0L
    private set
  private val pending = linkedSetOf<T>()
  val isEmpty: Boolean get() = pending.isEmpty()
  fun add(request: T): Long { pending.add(request); return epoch }
  fun consume(expectedEpoch: Long, request: T): Boolean = expectedEpoch == epoch && pending.remove(request)
  fun retire(expectedEpoch: Long): List<T>? {
    if (expectedEpoch != epoch) return null
    val abandoned = pending.toList()
    pending.clear()
    epoch++
    return abandoned
  }
}
