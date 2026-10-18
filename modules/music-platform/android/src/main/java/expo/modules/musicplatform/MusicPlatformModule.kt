package expo.modules.musicplatform

import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.ReadableMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import androidx.media3.common.util.UnstableApi

@UnstableApi
class MusicPlatformModule : Module() {
  private val discovery = AudioDiscovery()
  private val playback = PlaybackConnection { sendEvent("playbackState", it) }
  override fun definition() = ModuleDefinition {
    Name("MusicPlatform")

    AsyncFunction("getAccess") { discovery.access(requireNotNull(appContext.reactContext)) }
    AsyncFunction("discoverAudio") { scanId: String -> discovery.discover(requireNotNull(appContext.reactContext), scanId) }
    AsyncFunction("discoverM0Audio") { scanId: String, scope: String ->
      discovery.discover(requireNotNull(appContext.reactContext), scanId, scope)
    }
    Function("cancelScan") { scanId: String -> discovery.cancel(scanId) }
    Events("playbackState")
    OnStartObserving { playback.setObserving(true) }
    OnStopObserving { playback.setObserving(false) }
    OnActivityEntersBackground { playback.setVisible(false) }
    OnActivityEntersForeground { playback.setVisible(true) }
    AsyncFunction("readLiveState") { promise: Promise ->
      playback.request(requireNotNull(appContext.reactContext), promise) { it.readLiveState() }
    }.runOnQueue(Queues.MAIN)
    // ReadableMap preserves nested null metadata through JSI; generic Any conversion can
    // reject a null artist/title before our validated playback contract receives the queue.
    AsyncFunction("replaceQueueAndPlay") { command: ReadableMap, promise: Promise ->
      val data = command.toHashMap()
      playback.request(requireNotNull(appContext.reactContext), promise) { it.replaceQueue(data) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("playbackCommand") { command: ReadableMap, promise: Promise ->
      val data = command.toHashMap()
      playback.request(requireNotNull(appContext.reactContext), promise) { it.command(data) }
    }.runOnQueue(Queues.MAIN)
    OnDestroy { discovery.close(); playback.close() }

    Function("getFoundationInfo") {
      mapOf(
        "androidApi" to Build.VERSION.SDK_INT,
        "storageVolume" to MediaStore.VOLUME_EXTERNAL_PRIMARY,
        "contractVersion" to 1
      )
    }
  }
}
