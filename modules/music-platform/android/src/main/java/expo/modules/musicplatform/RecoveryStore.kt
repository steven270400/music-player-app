package expo.modules.musicplatform

import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.concurrent.Executors

/** One process-wide executor serializes AtomicFile access across service recreation. */
internal object RecoveryStore {
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "music-recovery") }
  private val main = Handler(Looper.getMainLooper())
  private data class Save(val directory: File, val snapshot: PlaybackContracts.Recovery, val done: (String?) -> Unit)
  private var pending: Save? = null
  private var scheduled = false
  private fun file(directory: File) = AtomicFile(File(directory, "playback-v1.bin"))
  private fun target(directory: File) = object : RecoveryFile {
    private val atomic = file(directory)
    override fun begin() = atomic.startWrite()
    override fun sync(stream: OutputStream) = (stream as FileOutputStream).fd.sync()
    override fun commit(stream: OutputStream) = atomic.finishWrite(stream as FileOutputStream)
    override fun rollback(stream: OutputStream) = atomic.failWrite(stream as FileOutputStream)
    override fun read() = atomic.openRead()
  }

  fun read(directory: File, done: (PlaybackContracts.Recovery?, String?) -> Unit) {
    io.execute {
      var snapshot: PlaybackContracts.Recovery? = null
      var error: String? = null
      try { snapshot = file(directory).openRead().use { RecoveryCodec.decode(RecoveryCodec.readBounded(it)) } }
      catch (_: FileNotFoundException) { }
      catch (_: Exception) { error = "RECOVERY_INVALID" }
      main.post { done(snapshot, error) }
    }
  }
  @Synchronized
  fun save(directory: File, snapshot: PlaybackContracts.Recovery, done: (String?) -> Unit) {
    pending = Save(directory, snapshot, done)
    if (scheduled) return
    scheduled = true
    io.execute {
      while (true) {
        val save = synchronized(this) {
          val next = pending
          pending = null
          if (next == null) scheduled = false
          next
        } ?: break
        val error = RecoveryTransaction.save(target(save.directory), save.snapshot)
        main.post { save.done(error) }
      }
    }
  }
}
