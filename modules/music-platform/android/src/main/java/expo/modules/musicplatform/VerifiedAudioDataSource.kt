package expo.modules.musicplatform

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ContentDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.IOException
import java.io.InputStream
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream

/** Runs on Media3's loading thread. Only the native-derived primary audio URI can be opened. */
@UnstableApi
internal class VerifiedAudioDataSource(private val context: Context, private val binding: PlaybackContracts.Binding) : DataSource {
  class SourceFailure(val code: String) : IOException("Local audio source is unavailable.")
  private val delegate = ContentDataSource(context)
  private val access = AudioDiscovery()
  private val replay = PrefixReplay()
  private val expectedUri = ContentUris.withAppendedId(MediaStore.Audio.Media.getContentUri("external_primary"), binding.rowId.toLong())
  private fun verify() {
    if (access.access(context)["status"] != "granted") throw SourceFailure("ACCESS_REQUIRED")
    if (MediaStore.getVersion(context, "external_primary") != binding.providerVersion) throw SourceFailure("PROVIDER_CHANGED")
    context.contentResolver.query(expectedUri, arrayOf(MediaStore.MediaColumns.GENERATION_ADDED), null, null, null)?.use {
      if (!it.moveToFirst() || it.isNull(0) || it.getLong(0).toString() != binding.generationAdded)
        throw SourceFailure("SOURCE_UNAVAILABLE")
    } ?: throw SourceFailure("SOURCE_UNAVAILABLE")
    if (MediaStore.getVersion(context, "external_primary") != binding.providerVersion) throw SourceFailure("PROVIDER_CHANGED")
  }
  override fun open(dataSpec: DataSpec): Long {
    replay.reset()
    if (dataSpec.uri != expectedUri) throw SourceFailure("SOURCE_UNAVAILABLE")
    try {
      verify()
      val length = delegate.open(dataSpec)
      // Recheck after obtaining the descriptor so a changed provider binding is not accepted.
      verify()
      if (dataSpec.position == 0L) {
        val captured = ByteArrayOutputStream()
        val input = object : InputStream() {
          private val one = ByteArray(1)
          override fun read(): Int = if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 255
          override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            val size = delegate.read(buffer, offset, length)
            if (size > 0) {
              if (size > Id3ReadGuard.MAX_PREFIX_BYTES - captured.size()) throw SourceFailure("LOAD_FAILED")
              captured.write(buffer, offset, size)
            }
            return size
          }
        }
        Id3ReadGuard.check(BufferedInputStream(input))
        replay.reset(captured.toByteArray())
      }
      return length
    } catch (error: Exception) {
      try { delegate.close() } catch (_: IOException) { }
      throw when {
        error is SourceFailure -> error
        generateSequence<Throwable>(error) { it.cause }.any { it is SecurityException } -> SourceFailure("ACCESS_REQUIRED")
        else -> SourceFailure("SOURCE_UNAVAILABLE")
      }
    }
  }
  override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
    replay.read(buffer, offset, length, delegate::read)
  override fun getUri(): Uri? = delegate.uri
  override fun close() { replay.reset(); delegate.close() }
  override fun addTransferListener(transferListener: TransferListener) = delegate.addTransferListener(transferListener)
}
