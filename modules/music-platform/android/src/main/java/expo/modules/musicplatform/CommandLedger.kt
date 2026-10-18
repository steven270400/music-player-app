package expo.modules.musicplatform

/** Accepted-operation replay precedes all checks against mutable playback state. */
internal class CommandLedger<R>(private val capacity: Int = 256) {
  private data class Receipt<R>(val command: Any, val result: R)
  private val receipts = LinkedHashMap<String, Receipt<R>>()
  init { require(capacity > 0) }
  fun dispatch(id: String, command: Any, isCurrent: () -> Boolean, validate: () -> String?,
    apply: () -> R, reject: (String) -> R): R {
    receipts[id]?.let { return if (it.command == command) it.result else reject("INVALID_COMMAND") }
    if (!isCurrent()) return reject("STALE_COMMAND")
    validate()?.let { return reject(it) }
    val result = apply()
    receipts[id] = Receipt(command, result)
    if (receipts.size > capacity) receipts.remove(receipts.keys.first())
    return result
  }
}
