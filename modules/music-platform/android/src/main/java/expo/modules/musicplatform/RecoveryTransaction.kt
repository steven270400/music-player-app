package expo.modules.musicplatform

import java.io.InputStream
import java.io.OutputStream
import java.io.IOException

/** Injectable transaction boundary; production uses Android AtomicFile. */
internal interface RecoveryFile {
  fun begin(): OutputStream
  fun sync(stream: OutputStream)
  fun commit(stream: OutputStream)
  fun rollback(stream: OutputStream)
  fun read(): InputStream
}
internal object RecoveryTransaction {
  fun save(file: RecoveryFile, snapshot: PlaybackContracts.Recovery): String? {
    var stream: OutputStream? = null
    return try {
      val bytes = RecoveryCodec.encode(snapshot)
      stream = file.begin()
      stream.write(bytes)
      file.sync(stream)
      file.commit(stream)
      stream = null
      if (!file.read().use { RecoveryCodec.readBounded(it) }.contentEquals(bytes)) throw IOException("Recovery verification failed.")
      null
    } catch (_: Exception) {
      stream?.let { try { file.rollback(it) } catch (_: Exception) { } }
      "RECOVERY_WRITE_FAILED"
    }
  }
}
