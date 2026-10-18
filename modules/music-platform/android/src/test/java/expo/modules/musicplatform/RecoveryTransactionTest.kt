package expo.modules.musicplatform

import org.junit.Assert.*
import org.junit.Test
import java.io.*

class RecoveryTransactionTest {
  private fun snapshot(position: Long = 5000): PlaybackContracts.Recovery {
    val song = PlaybackContracts.Song(PlaybackContracts.Binding("epoch", "1", "2"), "fixture.mp3", 12000, null, null)
    return PlaybackContracts.Recovery(listOf(PlaybackContracts.Entry("a", song)), listOf("a"), listOf("a"), "a", position, false)
  }
  /** Faults model the storage boundary; this does not emulate Android filesystem crash behavior. */
  private class FileDouble(initial: ByteArray, val fault: String? = null) : RecoveryFile {
    var committed = initial.copyOf()
    var started = false
    var rolledBack = false
    private var staged = ByteArrayOutputStream()
    override fun begin(): OutputStream {
      if (fault == "begin") throw IOException()
      started = true; staged = ByteArrayOutputStream()
      return object : OutputStream() {
        override fun write(value: Int) { if (fault == "write" && staged.size() >= 10) throw IOException(); staged.write(value) }
      }
    }
    override fun sync(stream: OutputStream) { if (fault == "sync") throw IOException() }
    override fun commit(stream: OutputStream) {
      if (fault == "commit") throw IOException()
      if (fault != "silent-commit") committed = staged.toByteArray()
    }
    override fun rollback(stream: OutputStream) { rolledBack = true; staged.reset() }
    override fun read(): InputStream { if (fault == "read") throw IOException(); return ByteArrayInputStream(committed) }
  }
  @Test fun successfulSaveProducesRecoverableNewContext() {
    val file = FileDouble(RecoveryCodec.encode(snapshot()))
    assertNull(RecoveryTransaction.save(file, snapshot(7000)))
    assertEquals(7000L, RecoveryCodec.decode(file.committed).positionMs)
    assertFalse(file.rolledBack)
  }
  @Test fun partialWriteSyncAndCommitFailuresRetainPreviousContext() {
    val old = RecoveryCodec.encode(snapshot())
    for (fault in listOf("write", "sync", "commit")) {
      val file = FileDouble(old, fault)
      assertEquals("RECOVERY_WRITE_FAILED", RecoveryTransaction.save(file, snapshot(7000)))
      assertTrue(file.rolledBack); assertArrayEquals(old, file.committed)
    }
  }
  @Test fun failedBeginDoesNotTouchOldFileOrRollbackAnUnopenedStream() {
    val old = RecoveryCodec.encode(snapshot()); val file = FileDouble(old, "begin")
    assertEquals("RECOVERY_WRITE_FAILED", RecoveryTransaction.save(file, snapshot(7000)))
    assertFalse(file.rolledBack); assertArrayEquals(old, file.committed)
  }
  @Test fun malformedNewSnapshotNeverStartsReplacement() {
    val old = RecoveryCodec.encode(snapshot()); val file = FileDouble(old)
    assertEquals("RECOVERY_WRITE_FAILED", RecoveryTransaction.save(file, snapshot().copy(positionMs = -1)))
    assertFalse(file.started); assertArrayEquals(old, file.committed)
  }
  @Test fun silentCommitFailureIsDetectedByReadback() {
    val old = RecoveryCodec.encode(snapshot()); val file = FileDouble(old, "silent-commit")
    assertEquals("RECOVERY_WRITE_FAILED", RecoveryTransaction.save(file, snapshot(7000)))
    assertArrayEquals(old, file.committed)
  }
  @Test fun verificationFailureDoesNotPretendSuccessOrRollbackACommittedFile() {
    val file = FileDouble(RecoveryCodec.encode(snapshot()), "read")
    assertEquals("RECOVERY_WRITE_FAILED", RecoveryTransaction.save(file, snapshot(7000)))
    assertFalse(file.rolledBack)
    assertEquals(7000L, RecoveryCodec.decode(file.committed).positionMs)
  }
}
