package expo.modules.musicplatform

import kotlin.random.Random

/** One ordering policy shared by app commands, system controls and recovery. */
internal object QueuePolicy {
  fun previousIndex(index: Int, positionMs: Long): Int = if (positionMs > 3000) index else (index - 1).coerceAtLeast(0)
  fun nextIndex(index: Int, size: Int, repeat: String = "off"): Int? =
    if (size == 0) null else (index + 1).takeIf { it in 0 until size } ?: 0.takeIf { repeat == "all" }

  fun shuffleRemaining(order: List<String>, current: String, random: Random = Random.Default): List<String> {
    val index = order.indexOf(current)
    require(index >= 0)
    return order.take(index + 1) + order.drop(index + 1).shuffled(random)
  }

  fun nextCycle(original: List<String>, shuffle: Boolean, random: Random = Random.Default): List<String> =
    if (shuffle) original.shuffled(random) else original.toList()

  /** Each candidate is visited once per load attempt, including when all sources fail. */
  class LoadAttempt(order: List<String>, initialEntryId: String, wrap: Boolean = false) {
    private val candidates: List<String>
    private var cursor = 0
    init {
      require(order.isNotEmpty() && order.toSet().size == order.size)
      val start = order.indexOf(initialEntryId)
      require(start >= 0)
      candidates = order.drop(start) + if (wrap) order.take(start) else emptyList()
    }
    fun next(): String? = if (cursor < candidates.size) candidates[cursor++] else null
  }
}
