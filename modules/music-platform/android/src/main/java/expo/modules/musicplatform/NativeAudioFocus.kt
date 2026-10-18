package expo.modules.musicplatform

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

/** Android focus/routing adapter; the policy has no dependency on Android or JS. */
internal class NativeAudioFocus(private val context: Context, private val isPlaying: () -> Boolean,
  private val pausePlayer: () -> Unit, private val resumePlayer: () -> Unit) {
  private val manager = context.getSystemService(AudioManager::class.java)
  private val main = Handler(Looper.getMainLooper())
  private val intent = PlaybackIntent()
  private var request: AudioFocusRequest? = null
  private var closed = false
  private var focusHeld = false
  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, event: Intent?) {
      if (!closed && event?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) disconnect()
    }
  }
  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      // Also invalidate a pending resume when disconnect happens during an interruption.
      val external = setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER)
      if (!closed && removedDevices.any { it.isSink && it.type in external }) disconnect()
    }
  }
  init {
    ContextCompat.registerReceiver(context, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
    manager.registerAudioDeviceCallback(devices, main)
  }
  fun play(): Boolean {
    if (closed) return false
    if (focusHeld && isPlaying()) return true
    pausePlayer()
    pause()
    val token = intent.begin()
    val next = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
      .setWillPauseWhenDucked(true).setAcceptsDelayedFocusGain(false)
      .setOnAudioFocusChangeListener({ change ->
        if (!closed && intent.current(token)) when (change) {
          AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
            focusHeld = false
            if (intent.transientLoss(token, isPlaying())) pausePlayer()
          }
          AudioManager.AUDIOFOCUS_LOSS -> disconnect()
          AudioManager.AUDIOFOCUS_GAIN -> { focusHeld = true; if (intent.gain(token)) resumePlayer() }
        }
      }, main).build()
    request = next
    val granted = try { manager.requestAudioFocus(next) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED } catch (_: RuntimeException) { false }
    focusHeld = granted
    if (!granted) pause()
    return granted
  }
  /** Explicit pause/stop/access loss invalidates focus callbacks before abandoning focus. */
  fun pause() {
    intent.cancel()
    focusHeld = false
    val previous = request; request = null
    previous?.let { manager.abandonAudioFocusRequest(it) }
  }
  private fun disconnect() { intent.cancel(); pausePlayer(); pause() }
  fun close() {
    closed = true
    pause()
    context.unregisterReceiver(noisy)
    manager.unregisterAudioDeviceCallback(devices)
  }
}
