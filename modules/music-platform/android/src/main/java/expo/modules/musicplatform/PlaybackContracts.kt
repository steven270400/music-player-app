package expo.modules.musicplatform

import java.security.MessageDigest

/** Runtime validation shared by bridge commands and recovery. No Android or player dependency. */
internal object PlaybackContracts {
  const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
  const val MAX_ENTRIES = 10_000

  class Invalid : IllegalArgumentException("Invalid playback data.")
  private fun invalid(): Nothing = throw Invalid()
  fun objectValue(value: Any?): Map<*, *> = value as? Map<*, *> ?: invalid()
  fun text(value: Any?, max: Int = 128): String =
    (value as? String)?.takeIf { it.isNotBlank() && it.length <= max && '\u0000' !in it } ?: invalid()
  fun integer(value: Any?): Long {
    val number = value as? Number ?: invalid()
    // Check integral JVM values before conversion to Double to avoid rounding near 2^53.
    if (number is Long || number is Int || number is Short || number is Byte) {
      return number.toLong().takeIf { it in 0..MAX_SAFE_INTEGER } ?: invalid()
    }
    val double = number.toDouble()
    if (!double.isFinite() || double < 0 || double > MAX_SAFE_INTEGER.toDouble() || double % 1.0 != 0.0) invalid()
    return double.toLong()
  }
  private fun decimal(value: Any?): String {
    val string = text(value, 19)
    if (!Regex("0|[1-9][0-9]*").matches(string) || string.toLongOrNull() == null) invalid()
    return string
  }
  private fun optionalText(value: Any?): String? = if (value == null) null else text(value, 512)

  data class Binding(val providerVersion: String, val rowId: String, val generationAdded: String) {
    val songId: String by lazy { MessageDigest.getInstance("SHA-256")
      .digest(listOf("external_primary", providerVersion, rowId, generationAdded).joinToString("\u0000").toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it.toInt() and 0xff) } }
    fun wire(): Map<String, Any> = mapOf("volume" to "external_primary", "providerVersion" to providerVersion,
      "rowId" to rowId, "generationAdded" to generationAdded)
  }
  data class Song(val binding: Binding, val filename: String, val durationMs: Long?, val artist: String?, val title: String?) {
    fun wire(): Map<String, Any?> = mapOf("songId" to binding.songId, "binding" to binding.wire(),
      "filename" to filename, "durationMs" to durationMs, "artist" to artist, "title" to title)
  }
  data class Entry(val entryId: String, val song: Song) {
    fun wire(): Map<String, Any?> = mapOf("entryId" to entryId, "song" to song.wire())
  }
  fun song(raw: Any?): Song {
    val data = objectValue(raw)
    val source = objectValue(data["binding"])
    if (source["volume"] != "external_primary") invalid()
    val binding = Binding(text(source["providerVersion"], 512), decimal(source["rowId"]), decimal(source["generationAdded"]))
    if (data["songId"] != binding.songId) invalid()
    return Song(binding, text(data["filename"], 4096), data["durationMs"]?.let(::integer),
      optionalText(data["artist"]), optionalText(data["title"]))
  }
  fun entries(raw: Any?): List<Entry> {
    val list = raw as? List<*> ?: invalid()
    if (list.isEmpty() || list.size > MAX_ENTRIES) invalid()
    val entries = list.map { value ->
      val data = objectValue(value)
      Entry(text(data["entryId"]), song(data["song"]))
    }
    if (entries.map { it.entryId }.toSet().size != entries.size) invalid()
    return entries
  }
  data class Header(val operationId: String, val sessionId: String, val expectedQueueRevision: Long)
  private fun header(data: Map<*, *>) = Header(text(data["operationId"]), text(data["sessionId"]), integer(data["expectedQueueRevision"]))
  data class Replacement(val header: Header, val entries: List<Entry>, val selectedEntryId: String)
  fun replacement(raw: Any?): Replacement {
    val data = objectValue(raw)
    val entries = entries(data["entries"])
    val selected = text(data["selectedEntryId"])
    if (entries.none { it.entryId == selected }) invalid()
    return Replacement(header(data), entries, selected)
  }
  fun repeat(value: Any?): String = (value as? String)?.takeIf { it in setOf("off", "one", "all") } ?: invalid()
  data class Command(val header: Header, val action: String, val positionMs: Long? = null, val entryId: String? = null,
    val repeat: String? = null, val shuffle: Boolean? = null)
  fun command(raw: Any?): Command {
    val data = objectValue(raw)
    val action = text(data["action"])
    if (action !in setOf("play", "pause", "stop", "previous", "next", "seek", "select", "setRepeat", "setShuffle")) invalid()
    return Command(header(data), action, if (action == "seek") integer(data["positionMs"]) else null,
      if (action == "select") text(data["entryId"]) else null,
      if (action == "setRepeat") repeat(data["repeat"]) else null,
      if (action == "setShuffle") data["shuffle"] as? Boolean ?: invalid() else null)
  }
  /** Session identity always matters. Pause may cross a queue revision as a safety intent. */
  fun isCurrent(header: Header, sessionId: String, revision: Long, action: String): Boolean =
    header.sessionId == sessionId && (action == "pause" || header.expectedQueueRevision == revision)

  data class Recovery(val entries: List<Entry>, val originalOrder: List<String>, val playbackOrder: List<String>,
    val currentEntryId: String, val positionMs: Long, val ended: Boolean,
    val repeat: String = "off", val shuffle: Boolean = false) {
    fun orderedEntries(): List<Entry> {
      val byId = entries.associateBy { it.entryId }
      return playbackOrder.map { byId.getValue(it) }
    }
    fun wire(): Map<String, Any?> = mapOf("version" to 1, "entries" to entries.map { it.wire() },
      "originalOrder" to originalOrder, "playbackOrder" to playbackOrder, "currentEntryId" to currentEntryId,
      "positionMs" to positionMs, "repeat" to repeat, "shuffle" to shuffle, "ended" to ended)
  }
  fun recovery(raw: Any?): Recovery {
    val data = objectValue(raw)
    if (integer(data["version"]) != 1L) invalid()
    val repeat = repeat(data["repeat"])
    val shuffle = data["shuffle"] as? Boolean ?: invalid()
    val entries = entries(data["entries"])
    val ids = entries.map { it.entryId }.toSet()
    fun order(rawOrder: Any?): List<String> {
      val list = rawOrder as? List<*> ?: invalid()
      if (list.size != entries.size) invalid()
      val result = list.map { text(it) }
      if (result.toSet() != ids) invalid()
      return result
    }
    val original = order(data["originalOrder"])
    val playback = order(data["playbackOrder"])
    if (!shuffle && original != playback) invalid()
    val current = text(data["currentEntryId"])
    val selected = entries.find { it.entryId == current } ?: invalid()
    val position = integer(data["positionMs"])
    val ended = data["ended"] as? Boolean ?: invalid()
    // An ended track can move away from the last index when shuffle is switched off.
    val clamped = selected.song.durationMs?.let { position.coerceAtMost(it) } ?: position
    val atEnd = selected.song.durationMs?.let { it > 0 && clamped >= it } == true
    return Recovery(entries, original, playback, current, clamped, ended || atEnd, repeat, shuffle)
  }
}
