package expo.modules.musicplatform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.provider.MediaStore
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicReference

/** Queries only primary MediaStore audio. No source mutation API is exposed. */
class AudioDiscovery {
  private data class Scan(val id: String, val cancellation: CancellationSignal)
  private val active = AtomicReference<Scan?>(null)
  private var lastGranted: Boolean? = null
  private var accessGeneration = 0

  @Synchronized
  fun access(context: Context): Map<String, Any> {
    val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
    val granted = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    if (lastGranted != granted) { accessGeneration++; lastGranted = granted }
    return mapOf("status" to if (granted) "granted" else "denied", "androidApi" to Build.VERSION.SDK_INT, "generation" to accessGeneration)
  }
  fun cancel(id: String) { active.get()?.takeIf { it.id == id }?.cancellation?.cancel() }
  fun close() { active.getAndSet(null)?.cancellation?.cancel() }

  fun discover(context: Context, id: String, diagnosticScope: String? = null): Map<String, Any?> {
    val initial = access(context)
    val generation = initial.getValue("generation")
    fun failure(code: String, message: String, cancelled: Boolean = false) = mapOf(
      "scanId" to id, "accessGeneration" to generation, "status" to if (cancelled) "cancelled" else "failed",
      "error" to mapOf("code" to code, "message" to message, "retryable" to true))
    if (id.isBlank() || id.length > 128) return failure("INVALID_COMMAND", "Invalid scan identifier.")
    val fixturePrefix = when (diagnosticScope) {
      null -> null
      "queue" -> "Music/MusicPlayerM0/queue/"
      "fixtures" -> "Music/MusicPlayerM0/"
      else -> return failure("INVALID_COMMAND", "Invalid diagnostic scope.")
    }
    if (diagnosticScope != null && context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0)
      return failure("INVALID_COMMAND", "Diagnostic discovery requires a development build.")
    if (initial["status"] != "granted") return failure("ACCESS_REQUIRED", "Allow audio access to scan songs.")
    val scan = Scan(id, CancellationSignal())
    active.getAndSet(scan)?.cancellation?.cancel()
    try {
      val volume = MediaStore.VOLUME_EXTERNAL_PRIMARY
      val epoch = MediaStore.getVersion(context, volume)
        ?: return failure("PROVIDER_CHANGED", "Storage identity is unavailable. Try refreshing.")
      val providerGeneration = MediaStore.getGeneration(context, volume)
      val collection = MediaStore.Audio.Media.getContentUri(volume)
      val projection = arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME,
        MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.TITLE, MediaStore.MediaColumns.GENERATION_ADDED)
      val songs = ArrayList<Map<String, Any?>>()
      // Parameterized directory boundary; never infer fixture membership from a filename.
      val selection = fixturePrefix?.let { "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?" }
      val selectionArgs = fixturePrefix?.let { arrayOf("$it%") }
      val cursor = context.contentResolver.query(collection, projection, selection, selectionArgs, null, scan.cancellation)
        ?: return failure("SCAN_FAILED", "Storage did not return a complete scan.")
      cursor.use {
        val rowColumn = it.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
        val nameColumn = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
        val durationColumn = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
        val artistColumn = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
        val titleColumn = it.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
        val insertionColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.GENERATION_ADDED)
        while (it.moveToNext()) {
          scan.cancellation.throwIfCanceled()
          val row = it.getLong(rowColumn).toString()
          val insertion = it.getLong(insertionColumn).toString()
          val filename = it.getString(nameColumn) ?: return failure("SCAN_FAILED", "A storage entry has no filename.")
          if (filename.length > 4096) return failure("SCAN_FAILED", "A storage entry has invalid metadata.")
          fun metadata(column: Int): String? = it.getString(column)?.take(512)?.takeUnless { value -> value.isBlank() || value == "<unknown>" }
          val identity = listOf(volume, epoch, row, insertion).joinToString("\u0000")
          val songId = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
          songs.add(mapOf("songId" to songId,
            "binding" to mapOf("volume" to volume, "providerVersion" to epoch, "rowId" to row, "generationAdded" to insertion),
            "filename" to filename, "durationMs" to if (it.isNull(durationColumn)) null else it.getLong(durationColumn).takeIf { value -> value > 0 },
            "artist" to metadata(artistColumn), "title" to metadata(titleColumn)))
        }
      }
      scan.cancellation.throwIfCanceled()
      val currentAccess = access(context)
      if (currentAccess["status"] != "granted" || currentAccess["generation"] != generation)
        return failure("ACCESS_REQUIRED", "Audio access changed. Previous results were retained.")
      if (MediaStore.getVersion(context, volume) != epoch || MediaStore.getGeneration(context, volume) != providerGeneration)
        return failure("PROVIDER_CHANGED", "Storage changed during scanning. Refresh to try again.")
      if (active.get() !== scan) return failure("CANCELLED", "Scan was replaced.", true)
      return mapOf("scanId" to id, "accessGeneration" to generation, "status" to "complete", "providerVersion" to epoch, "songs" to songs)
    } catch (_: SecurityException) {
      access(context)
      return failure("ACCESS_REQUIRED", "Audio access is unavailable.")
    } catch (_: OperationCanceledException) {
      return failure("CANCELLED", "Scan cancelled. Previous results were retained.", true)
    } catch (_: Exception) {
      return failure("SCAN_FAILED", "Scan failed. Previous results were retained.")
    } finally { active.compareAndSet(scan, null) }
  }
}
