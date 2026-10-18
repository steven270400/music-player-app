package expo.modules.musicplatform

import android.Manifest
import android.app.PendingIntent
import android.app.AppOpsManager
import android.content.ContentUris
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.UUID

/** All live state and commands are serialized on the service's main looper. */
@UnstableApi
class MusicPlaybackService : MediaSessionService() {
  companion object {
    internal var instance: MusicPlaybackService? = null
      private set
  }
  private lateinit var engine: ExoPlayer
  private lateinit var audioFocus: NativeAudioFocus
  private lateinit var controlledPlayer: SessionPlayer
  private var session: MediaSession? = null
  private val main = Handler(Looper.getMainLooper())
  private val access = AudioDiscovery()
  private val sessionId = UUID.randomUUID().toString()
  private var revision = 0L
  private var sequence = 0L
  private var entries = emptyList<PlaybackContracts.Entry>()
  private var queueWire = emptyList<Map<String, Any?>>()
  private var queueOrder = emptyList<String>()
  private var originalOrder = emptyList<String>()
  private var repeat = "off"
  private var shuffle = false
  private var changingQueue = false
  private var loadAttempt: QueuePolicy.LoadAttempt? = null
  private var error: Map<String, Any>? = null
  private var recoveryError: Map<String, Any>? = null
  private var restoring = true
  private var restoredEnded = false
  private var lastCheckpoint = 0L
  private var controlRevision = 0L
  private val observers = linkedSetOf<(Map<String, Any?>) -> Unit>()
  private val receipts = CommandLedger<Map<String, Any?>>()
  private val permissionListener = AppOpsManager.OnOpChangedListener { _, changedPackage ->
    if (changedPackage == null || changedPackage == packageName) main.post { if (instance === this) checkAccess() }
  }
  private val tick = object : Runnable {
    override fun run() {
      checkAccess()
      if (engine.isPlaying) {
        // A decoded song making progress ends a consecutive load-failure traversal.
        if (engine.currentPosition >= 1000) loadAttempt = null
        publish()
        if (SystemClock.elapsedRealtime() - lastCheckpoint >= 5000) checkpoint()
      }
      main.postDelayed(this, 1000)
    }
  }

  override fun onCreate() {
    super.onCreate()
    engine = ExoPlayer.Builder(this).build().apply {
      setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), false)
      setHandleAudioBecomingNoisy(false)
      setWakeMode(C.WAKE_MODE_LOCAL)
      repeatMode = Player.REPEAT_MODE_OFF
    }
    audioFocus = NativeAudioFocus(this, { engine.isPlaying },
      { controlRevision++; engine.pause(); checkpoint(); publish() },
      { if (checkAccess()) { engine.play(); checkpoint(); publish() } })
    controlledPlayer = SessionPlayer(engine)
    val builder = MediaSession.Builder(this, controlledPlayer).setCallback(object : MediaSession.Callback {
      override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
        if (!controller.isTrusted) return MediaSession.ConnectionResult.reject()
        return MediaSession.ConnectionResult.AcceptedResultBuilder(session, controller)
          .setAvailablePlayerCommands(Player.Commands.Builder().addAllCommands()
            .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS).remove(Player.COMMAND_SET_MEDIA_ITEM).build()).build()
      }
    })
    packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
      builder.setSessionActivity(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    session = builder.build()
    engine.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) {
        if (changingQueue) return
        if (playbackState == Player.STATE_ENDED) {
          if (repeat == "all" && engine.playWhenReady && checkAccess()) startNextCycle()
          else { engine.pause(); audioFocus.pause() }
        }
      }
      override fun onEvents(player: Player, events: Player.Events) {
        publish()
        if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) || events.contains(Player.EVENT_POSITION_DISCONTINUITY) ||
          events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED) || events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)) checkpoint()
      }
      override fun onPlayerError(failure: PlaybackException) { handleFailure(failure) }
    })
    instance = this
    val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
    AppOpsManager.permissionToOp(permission)?.let { getSystemService(AppOpsManager::class.java).startWatchingMode(it, packageName, permissionListener) }
    main.post(tick)
    RecoveryStore.read(noBackupFilesDir) { saved, failure ->
      if (instance !== this) return@read
      restoring = false
      if (revision != 0L) return@read // A new user-selected queue always wins over startup recovery.
      recoveryError = failure?.let { problem(it) }
      if (saved != null) {
        repeat = saved.repeat
        shuffle = saved.shuffle
        installQueue(saved.orderedEntries(), saved.currentEntryId, saved.positionMs, saved.originalOrder)
        restoredEnded = saved.ended
      }
      publish()
    }
  }
  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
    session.takeIf { controllerInfo.isTrusted }

  override fun onDestroy() {
    checkpoint()
    instance = null
    main.removeCallbacksAndMessages(null)
    getSystemService(AppOpsManager::class.java).stopWatchingMode(permissionListener)
    observers.clear()
    engine.pause()
    audioFocus.close()
    session?.release()
    controlledPlayer.release()
    session = null
    super.onDestroy()
  }
  private fun requireMain() = check(Looper.myLooper() == main.looper)
  private fun problem(code: String) = mapOf<String, Any>("code" to code, "message" to when (code) {
    "ACCESS_REQUIRED" -> "Allow audio access before playing."
    "STALE_COMMAND" -> "Playback changed. Refresh the current state."
    "INVALID_COMMAND" -> "This playback command is invalid."
    "QUEUE_EXHAUSTED" -> "No remaining song could be played."
    "PROVIDER_CHANGED" -> "Storage identity changed. Refresh your songs."
    "FOCUS_UNAVAILABLE" -> "Audio focus is unavailable. Try Play again when the interruption ends."
    "RECOVERY_INVALID" -> "Saved playback could not be restored. Your music and collections are unchanged."
    "RECOVERY_WRITE_FAILED" -> "Playback progress could not be saved. The previous recovery file was retained where possible."
    else -> "A song could not be played."
  }, "retryable" to true)
  private fun checkAccess(): Boolean {
    val granted = access.access(this)["status"] == "granted"
    if (!granted && entries.isNotEmpty() && (engine.playWhenReady || error?.get("code") != "ACCESS_REQUIRED")) {
      engine.pause(); audioFocus.pause()
      error = problem("ACCESS_REQUIRED")
      publish()
    }
    return granted
  }
  internal fun readLiveState(): Map<String, Any?> {
    requireMain()
    val current = entries.find { it.entryId == engine.currentMediaItem?.mediaId }
    val duration = engine.duration.takeIf { it >= 0 && it != C.TIME_UNSET } ?: current?.song?.durationMs
    val status = when {
      entries.isEmpty() -> "idle"
      engine.isPlaying -> "playing"
      engine.playbackState == Player.STATE_ENDED || restoredEnded -> "ended"
      error != null && engine.playerError != null -> "error"
      engine.playbackState == Player.STATE_BUFFERING && engine.playWhenReady -> "loading"
      else -> "paused"
    }
    return mapOf("contractVersion" to 1, "sessionId" to sessionId, "queueRevision" to revision, "sequence" to sequence,
      "status" to status, "entries" to queueWire, "originalOrder" to originalOrder,
      "playbackOrder" to queueOrder, "currentEntryId" to current?.entryId,
      "positionMs" to engine.currentPosition.coerceAtLeast(0), "durationMs" to duration,
      "repeat" to repeat, "shuffle" to shuffle, "error" to (error ?: recoveryError))
  }
  private fun checkpoint() {
    if (changingQueue || entries.isEmpty() || (restoring && revision == 0L)) return
    val current = entries.getOrNull(engine.currentMediaItemIndex) ?: return
    val snapshot = PlaybackContracts.Recovery(entries, originalOrder, queueOrder, current.entryId,
      engine.currentPosition.coerceAtLeast(0), restoredEnded || engine.playbackState == Player.STATE_ENDED, repeat, shuffle)
    lastCheckpoint = SystemClock.elapsedRealtime()
    val savedRevision = revision
    RecoveryStore.save(noBackupFilesDir, snapshot) { failure ->
      if (instance === this && revision == savedRevision) {
        val updated = failure?.let { problem(it) }
        if (updated != recoveryError) { recoveryError = updated; publish() }
      }
    }
  }
  private fun installQueue(items: List<PlaybackContracts.Entry>, selectedId: String, positionMs: Long,
    savedOriginalOrder: List<String>? = null) {
    changingQueue = true
    controlRevision++
    loadAttempt = null
    engine.pause()
    audioFocus.pause()
    originalOrder = savedOriginalOrder ?: items.map { it.entryId }
    val order = if (savedOriginalOrder == null && shuffle) QueuePolicy.shuffleRemaining(originalOrder, selectedId) else items.map { it.entryId }
    val byId = items.associateBy { it.entryId }
    entries = order.map { byId.getValue(it) }
    queueWire = entries.map { it.wire() }
    queueOrder = entries.map { it.entryId }
    revision++
    restoredEnded = false
    error = null
    val sources = entries.map { entry ->
      val binding = entry.song.binding
      val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.getContentUri("external_primary"), binding.rowId.toLong())
      val item = MediaItem.Builder().setMediaId(entry.entryId).setUri(uri)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(entry.song.filename).build()).build()
      ProgressiveMediaSource.Factory { VerifiedAudioDataSource(applicationContext, binding) }.createMediaSource(item)
    }
    engine.setMediaSources(sources, entries.indexOfFirst { it.entryId == selectedId }, positionMs)
    engine.repeatMode = if (repeat == "one") Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    changingQueue = false
    // Preparing/playing is a separate explicit action. Fresh restoration only installs context.
  }
  private fun publish() {
    if (changingQueue) return
    controlledPlayer.refresh()
    sequence++
    if (observers.isNotEmpty()) {
      val state = readLiveState()
      observers.toList().forEach { it(state) }
    }
  }
  internal fun observe(observer: (Map<String, Any?>) -> Unit): () -> Unit {
    requireMain()
    observers.add(observer)
    return { requireMain(); observers.remove(observer); Unit }
  }
  private fun reject(operationId: String, code: String) = mapOf<String, Any?>("operationId" to operationId,
    "accepted" to false, "error" to problem(code), "state" to readLiveState())
  private fun execute(header: PlaybackContracts.Header, command: Any, action: String, validate: () -> Boolean = { true }, operation: () -> Unit): Map<String, Any?> {
    requireMain()
    return receipts.dispatch(header.operationId, command,
      isCurrent = { PlaybackContracts.isCurrent(header, sessionId, revision, action) },
      validate = {
        when {
          !validate() -> "INVALID_COMMAND"
          action !in setOf("pause", "stop") && !checkAccess() -> "ACCESS_REQUIRED"
          else -> null
        }
      }, apply = {
        operation(); checkpoint(); publish()
        mapOf("operationId" to header.operationId, "accepted" to true, "state" to readLiveState())
      }, reject = { reject(header.operationId, it) })
  }
  internal fun replaceQueue(raw: Map<String, Any?>): Map<String, Any?> {
    requireMain()
    val command = try { PlaybackContracts.replacement(raw) } catch (_: PlaybackContracts.Invalid) {
      return reject((raw["operationId"] as? String)?.take(128) ?: "invalid", "INVALID_COMMAND")
    }
    return execute(command.header, command, "replace") {
      installQueue(command.entries, command.selectedEntryId, 0)
      perform("play")
    }
  }
  internal fun command(raw: Map<String, Any?>): Map<String, Any?> {
    requireMain()
    val command = try { PlaybackContracts.command(raw) } catch (_: PlaybackContracts.Invalid) {
      return reject((raw["operationId"] as? String)?.take(128) ?: "invalid", "INVALID_COMMAND")
    }
    return execute(command.header, command, command.action, validate = {
      (command.action != "select" || entries.any { it.entryId == command.entryId }) &&
        (entries.isNotEmpty() || command.action in setOf("pause", "stop"))
    }) {
      when (command.action) {
        "setRepeat" -> setRepeat(requireNotNull(command.repeat))
        "setShuffle" -> setShuffle(requireNotNull(command.shuffle))
        else -> perform(command.action, command.positionMs, command.entryId)
      }
    }
  }
  /** Move existing sources so changing order does not reload, rewind or resume the current song. */
  private fun reorder(order: List<String>) {
    changingQueue = true
    val byId = entries.associateBy { it.entryId }
    val working = queueOrder.toMutableList()
    for ((target, id) in order.withIndex()) {
      val from = working.indexOf(id)
      if (from != target) {
        engine.moveMediaItem(from, target)
        working.add(target, working.removeAt(from))
      }
    }
    entries = order.map { byId.getValue(it) }
    queueWire = entries.map { it.wire() }
    queueOrder = order
    revision++
    changingQueue = false
  }
  private fun setRepeat(mode: String) {
    if (repeat == mode) return
    val wasEnded = restoredEnded || engine.playbackState == Player.STATE_ENDED
    repeat = mode
    revision++
    engine.repeatMode = if (mode == "one") Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    restoredEnded = wasEnded
    checkpoint(); publish()
    engine.playerError?.let(::handleFailure)
  }
  private fun setShuffle(enabled: Boolean) {
    if (shuffle == enabled || entries.isEmpty()) return
    val current = engine.currentMediaItem?.mediaId ?: return
    val wasEnded = restoredEnded || engine.playbackState == Player.STATE_ENDED
    shuffle = enabled
    reorder(if (enabled) QueuePolicy.shuffleRemaining(queueOrder, current) else originalOrder)
    restoredEnded = wasEnded
    checkpoint(); publish()
    engine.playerError?.let(::handleFailure)
  }
  private fun startNextCycle() {
    reorder(QueuePolicy.nextCycle(originalOrder, shuffle))
    restoredEnded = false
    loadAttempt = null
    engine.seekTo(0, 0)
    if (engine.playbackState == Player.STATE_IDLE) engine.prepare()
    checkpoint(); publish()
  }
  private fun perform(action: String, position: Long? = null, entryId: String? = null) {
    if (entries.isEmpty() && action !in setOf("pause", "stop")) return
    controlRevision++
    loadAttempt = null
    when (action) {
      "pause" -> { engine.pause(); audioFocus.pause() }
      "stop" -> { engine.pause(); audioFocus.pause(); engine.stop() }
      "play" -> {
        if (!checkAccess()) return
        error = null
        if (engine.playbackState == Player.STATE_ENDED || restoredEnded) engine.seekTo(engine.currentMediaItemIndex, 0)
        restoredEnded = false
        if (engine.playbackState == Player.STATE_IDLE) engine.prepare()
        if (audioFocus.play()) engine.play()
        else { engine.pause(); error = problem("FOCUS_UNAVAILABLE") }
      }
      "previous" -> { restoredEnded = false; engine.seekTo(QueuePolicy.previousIndex(engine.currentMediaItemIndex, engine.currentPosition), 0) }
      "next" -> QueuePolicy.nextIndex(engine.currentMediaItemIndex, entries.size, repeat)?.let {
        if (it == 0) startNextCycle() else { restoredEnded = false; engine.seekTo(it, 0) }
      }
      "select" -> { restoredEnded = false; engine.seekTo(entries.indexOfFirst { it.entryId == entryId }, 0); perform("play") }
      "seek" -> { restoredEnded = false; engine.seekTo(requireNotNull(position).let { value -> engine.duration.takeIf { it >= 0 }?.let { value.coerceAtMost(it) } ?: value }) }
    }
    checkpoint()
    publish()
  }
  private fun handleFailure(failure: PlaybackException) {
    if (engine.playerError !== failure) return
    val code = generateSequence<Throwable>(failure) { it.cause }.filterIsInstance<VerifiedAudioDataSource.SourceFailure>().firstOrNull()?.code
    if (code == "ACCESS_REQUIRED" || !checkAccess()) { engine.pause(); audioFocus.pause(); error = problem("ACCESS_REQUIRED"); publish(); return }
    if (code == "PROVIDER_CHANGED") { engine.pause(); audioFocus.pause(); error = problem(code); publish(); return }
    error = problem("LOAD_FAILED")
    val attempt = loadAttempt ?: QueuePolicy.LoadAttempt(queueOrder, queueOrder[engine.currentMediaItemIndex], repeat == "all").also {
      it.next() // The current candidate has already failed.
      loadAttempt = it
    }
    val failedRevision = revision
    val failedControlRevision = controlRevision
    val failedIndex = engine.currentMediaItemIndex
    val resume = engine.playWhenReady
    main.post {
      if (instance !== this || revision != failedRevision || controlRevision != failedControlRevision ||
        engine.currentMediaItemIndex != failedIndex || engine.playerError !== failure) return@post
      val next = attempt.next()?.let { queueOrder.indexOf(it) }
      if (next == null) { engine.pause(); audioFocus.pause(); error = problem("QUEUE_EXHAUSTED") }
      else { engine.seekTo(next, 0); engine.prepare(); engine.playWhenReady = resume && engine.playWhenReady }
      publish()
    }
  }
  /** System transport and modes follow exactly the same policy as app commands. */
  private inner class SessionPlayer(player: Player) : ForwardingSimpleBasePlayer(player) {
    fun refresh() = invalidateState()
    override fun getState(): State = super.getState().let { state ->
      val commands = state.availableCommands.buildUpon()
        .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS).remove(Player.COMMAND_SET_MEDIA_ITEM)
      if (entries.isNotEmpty()) {
        commands.add(Player.COMMAND_SEEK_TO_PREVIOUS).add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        if (QueuePolicy.nextIndex(engine.currentMediaItemIndex, entries.size, repeat) != null)
          commands.add(Player.COMMAND_SEEK_TO_NEXT).add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        else commands.remove(Player.COMMAND_SEEK_TO_NEXT).remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
      }
      state.buildUpon().setAvailableCommands(commands.build())
        .setRepeatMode(when (repeat) { "one" -> Player.REPEAT_MODE_ONE; "all" -> Player.REPEAT_MODE_ALL; else -> Player.REPEAT_MODE_OFF })
        .setShuffleModeEnabled(shuffle).build()
    }
    override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
      setRepeat(when (repeatMode) { Player.REPEAT_MODE_ONE -> "one"; Player.REPEAT_MODE_ALL -> "all"; else -> "off" })
      return Futures.immediateVoidFuture()
    }
    override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> {
      setShuffle(shuffleModeEnabled)
      return Futures.immediateVoidFuture()
    }
    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
      perform(if (playWhenReady) "play" else "pause")
      return Futures.immediateVoidFuture()
    }
    override fun handleStop(): ListenableFuture<*> { perform("stop"); return Futures.immediateVoidFuture() }
    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
      when (seekCommand) {
        Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> perform("previous")
        Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> perform("next")
        else -> {
          // A session seek is allowed to change position, never to start paused playback.
          if (mediaItemIndex !in entries.indices) return Futures.immediateVoidFuture()
          controlRevision++; loadAttempt = null; restoredEnded = false
          engine.seekTo(mediaItemIndex, if (positionMs == C.TIME_UNSET) 0 else positionMs.coerceAtLeast(0))
          checkpoint(); publish()
        }
      }
      return Futures.immediateVoidFuture()
    }
  }
}
