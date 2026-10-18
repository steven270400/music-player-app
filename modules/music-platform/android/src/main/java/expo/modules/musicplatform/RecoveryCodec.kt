package expo.modules.musicplatform

import java.io.*
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

/** Private versioned binary representation of RecoverySnapshotV1; never Java object deserialization. */
internal object RecoveryCodec {
  const val MAX_BYTES = 8 * 1024 * 1024
  private const val MAGIC = 0x4D505243
  private fun invalid(): Nothing = throw PlaybackContracts.Invalid()
  fun encode(value: PlaybackContracts.Recovery): ByteArray {
    val snapshot = PlaybackContracts.recovery(value.wire())
    val bytes = ByteArrayOutputStream()
    val bounded = object : OutputStream() {
      override fun write(value: Int) { if (bytes.size() >= MAX_BYTES) invalid(); bytes.write(value) }
      override fun write(data: ByteArray, offset: Int, length: Int) {
        if (length > MAX_BYTES - bytes.size()) invalid()
        bytes.write(data, offset, length)
      }
    }
    DataOutputStream(bounded).use { output ->
      fun text(value: String) {
        val encoded = try { Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(value)) }
          catch (_: Exception) { invalid() }
        val data = ByteArray(encoded.remaining()); encoded.get(data)
        output.writeInt(data.size); output.write(data)
      }
      fun optional(value: String?) { output.writeBoolean(value != null); if (value != null) text(value) }
      output.writeInt(MAGIC); output.writeInt(1)
      output.writeInt(snapshot.entries.size)
      snapshot.entries.forEach { entry ->
        text(entry.entryId)
        with(entry.song) {
          text(binding.providerVersion); text(binding.rowId); text(binding.generationAdded); text(filename)
          output.writeBoolean(durationMs != null); durationMs?.let { output.writeLong(it) }
          optional(artist); optional(title)
        }
      }
      fun order(ids: List<String>) { output.writeInt(ids.size); ids.forEach { text(it) } }
      order(snapshot.originalOrder); order(snapshot.playbackOrder)
      text(snapshot.currentEntryId); output.writeLong(snapshot.positionMs)
      text(snapshot.repeat); output.writeBoolean(snapshot.shuffle); output.writeBoolean(snapshot.ended)
    }
    return bytes.toByteArray()
  }
  fun readBounded(input: InputStream): ByteArray {
    val bytes = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val size = input.read(buffer)
      if (size < 0) break
      if (size > MAX_BYTES - bytes.size()) invalid()
      bytes.write(buffer, 0, size)
    }
    return bytes.toByteArray()
  }
  fun decode(bytes: ByteArray): PlaybackContracts.Recovery {
    if (bytes.size > MAX_BYTES) invalid()
    try {
      DataInputStream(ByteArrayInputStream(bytes)).use { input ->
        fun flag(): Boolean = when (input.readUnsignedByte()) { 0 -> false; 1 -> true; else -> invalid() }
        fun text(max: Int): String {
          val length = input.readInt()
          if (length < 0 || length > max * 4 || length > input.available()) invalid()
          val data = ByteArray(length); input.readFully(data)
          val decoded = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(data)).toString()
          return PlaybackContracts.text(decoded, max)
        }
        fun count(): Int = input.readInt().also { if (it !in 1..PlaybackContracts.MAX_ENTRIES) invalid() }
        if (input.readInt() != MAGIC || input.readInt() != 1) invalid()
        val entries = List(count()) {
          val id = text(128)
          val binding = PlaybackContracts.Binding(text(512), text(19), text(19))
          val name = text(4096)
          val duration = if (flag()) input.readLong() else null
          val artist = if (flag()) text(512) else null
          val title = if (flag()) text(512) else null
          PlaybackContracts.Entry(id, PlaybackContracts.Song(binding, name, duration, artist, title))
        }
        fun order(): List<String> = List(count()) { text(128) }
        val original = order(); val playback = order()
        val current = text(128); val position = input.readLong()
        val repeat = text(16); val shuffle = flag(); val ended = flag()
        if (input.available() != 0) invalid()
        return PlaybackContracts.recovery(mapOf("version" to 1, "entries" to entries.map { it.wire() },
          "originalOrder" to original, "playbackOrder" to playback, "currentEntryId" to current,
          "positionMs" to position, "repeat" to repeat, "shuffle" to shuffle, "ended" to ended))
      }
    } catch (_: Exception) { invalid() }
  }
}
