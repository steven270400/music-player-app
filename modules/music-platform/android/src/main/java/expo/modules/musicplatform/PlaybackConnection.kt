package expo.modules.musicplatform

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicBoolean

/** Owns a connection only. Closing a JS runtime never releases the service's player. */
@UnstableApi
internal class PlaybackConnection(private val emit: (Map<String, Any?>) -> Unit) {
  private val main = Handler(Looper.getMainLooper())
  private var future: ListenableFuture<MediaController>? = null
  private var observed: MusicPlaybackService? = null
  private var unsubscribe: (() -> Unit)? = null
  private val closed = AtomicBoolean(false)
  private val requests = ConnectionRequests<Promise>()
  private var visible = true
  private var observing = false

  private fun updateObservation() {
    unsubscribe?.invoke(); unsubscribe = null
    if (!closed.get() && visible && observing) {
      unsubscribe = observed?.observe { if (!closed.get() && visible && observing) emit(it) }
    }
  }
  fun setVisible(value: Boolean) { main.post { visible = value; updateObservation() } }
  fun setObserving(value: Boolean) { main.post { observing = value; updateObservation() } }
  private fun reset(epoch: Long, message: String) {
    val abandoned = requests.retire(epoch) ?: return
    unsubscribe?.invoke(); unsubscribe = null; observed = null
    val previous = future
    future = null
    previous?.let { MediaController.releaseFuture(it) }
    abandoned.forEach { it.reject("SERVICE_UNAVAILABLE", message, null) }
  }

  fun request(context: Context, promise: Promise, action: (MusicPlaybackService) -> Any?) {
    check(Looper.myLooper() == main.looper)
    if (closed.get()) { promise.reject("SERVICE_UNAVAILABLE", "Playback connection is closed.", null); return }
    val epoch = requests.add(promise)
    val timeout = Runnable {
      if (requests.consume(epoch, promise)) {
        promise.reject("SERVICE_UNAVAILABLE", "Playback connection timed out. Try reconnecting.", null)
        if (requests.isEmpty) reset(epoch, "Playback connection timed out.")
      }
    }
    main.postDelayed(timeout, 10000)
    try {
      if (future == null) {
        future = MediaController.Builder(context.applicationContext,
          SessionToken(context, ComponentName(context, MusicPlaybackService::class.java)))
          .setListener(object : MediaController.Listener {
            override fun onDisconnected(controller: MediaController) {
              reset(epoch, "Playback disconnected. Try reconnecting.")
            }
          }).buildAsync()
      }
      val connection = requireNotNull(future)
      connection.addListener({
        if (closed.get() || !requests.consume(epoch, promise)) return@addListener
        main.removeCallbacks(timeout)
        try {
          connection.get()
          val service = requireNotNull(MusicPlaybackService.instance)
          if (observed !== service) {
            unsubscribe?.invoke(); unsubscribe = null
            observed = service
            updateObservation()
          }
          promise.resolve(action(service))
        } catch (_: Exception) {
          reset(epoch, "Playback service is unavailable. Try reconnecting.")
          promise.reject("SERVICE_UNAVAILABLE", "Playback service is unavailable. Try reconnecting.", null)
        }
      }, context.mainExecutor)
    } catch (_: Exception) {
      main.removeCallbacks(timeout)
      reset(epoch, "Could not connect to playback.")
    }
  }
  fun close() {
    closed.set(true)
    main.post {
      main.removeCallbacksAndMessages(null)
      reset(requests.epoch, "Playback connection closed.")
    }
  }
}
