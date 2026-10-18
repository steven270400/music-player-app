import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibraryStore, searchSongs } from '../src/features/library/libraryStore.ts';

function connect(path = ':memory:') {
  const native = new DatabaseSync(path);
  const db = {
    execAsync: async sql => { native.exec(sql); },
    runAsync: async (sql, ...args) => native.prepare(sql).run(...args),
    getAllAsync: async (sql, ...args) => native.prepare(sql).all(...args),
    getFirstAsync: async (sql, ...args) => native.prepare(sql).get(...args) ?? null,
    async withExclusiveTransactionAsync(work) {
      native.exec('BEGIN');
      try { await work(db); native.exec('COMMIT'); }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, close: () => native.close() };
}
function song(id, filename = `${id}.mp3`) {
  return { songId: id, filename, title: 'Music 音樂', artist: null, durationMs: 12000,
    binding: { volume: 'external_primary', providerVersion: 'epoch', rowId: id, generationAdded: '1' } };
}
const complete = songs => ({ status: 'complete', scanId: 'test', accessGeneration: 1, providerVersion: 'epoch', songs });
const valid = async () => true;

test('library, favourites and ordered playlists survive closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'music-library-test-'));
  const path = join(directory, 'library.db');
  let connection = connect(path);
  try {
    let store = await createLibraryStore(connection.db);
    await store.saveScan(complete([song('1', 'English.mp3'), song('2', '简体繁體.mp3')]), valid);
    await store.setFavourite('1', true);
    await store.savePlaylist('  My playlist  ');
    let id = (await store.read()).playlists[0].id;
    await store.addSongs(id, ['1', '2', '1'], valid);
    await store.reorder(id, ['2', '1']);
    connection.close(); connection = connect(path);
    store = await createLibraryStore(connection.db);
    const saved = await store.read();
    assert.equal(saved.songs.length, 2);
    assert.equal(saved.songs.find(s => s.songId === '1').favourite, true);
    assert.deepEqual(saved.playlists, [{ id, name: 'My playlist', songIds: ['2', '1'] }]);
    await store.savePlaylist('Renamed', id);
    assert.equal((await store.read()).playlists[0].name, 'Renamed');
    await store.removeSong(id, '2');
    assert.deepEqual((await store.read()).playlists[0].songIds, ['1']);
    await store.deletePlaylist(id);
    const after = await store.read();
    assert.equal(after.playlists.length, 0);
    assert.equal(after.songs.length, 2);
    assert.equal(after.songs.find(s => s.songId === '1').favourite, true);
  } finally {
    connection.close();
    unlinkSync(path);
    rmdirSync(directory);
  }
});

test('failed/cancelled refresh and lost access preserve the complete saved library', async () => {
  const connection = connect();
  try {
    const store = await createLibraryStore(connection.db);
    await store.saveScan(complete([song('1')]), valid);
    for (const status of ['failed', 'cancelled']) {
      assert.equal(await store.saveScan({ status, error: { message: 'Test failure' } }, valid), false);
    }
    let calls = 0;
    await assert.rejects(store.saveScan(complete([song('2')]), async () => ++calls === 1), /retained/);
    assert.deepEqual((await store.read()).songs.map(s => [s.songId, s.available]), [['1', true]]);
  } finally { connection.close(); }
});

test('refresh preserves memberships and does not link a new identity with the same filename', async () => {
  const connection = connect();
  try {
    const store = await createLibraryStore(connection.db);
    await store.saveScan(complete([song('1', 'same.mp3')]), valid);
    await store.setFavourite('1', true);
    await store.savePlaylist('Music');
    const id = (await store.read()).playlists[0].id;
    await store.addSongs(id, ['1'], valid);
    await store.saveScan(complete([song('1', 'renamed.mp3')]), valid);
    assert.equal((await store.read()).songs[0].favourite, true);
    await store.saveScan(complete([song('2', 'renamed.mp3')]), valid);
    const saved = await store.read();
    assert.equal(saved.songs.find(s => s.songId === '1').available, false);
    assert.equal(saved.songs.find(s => s.songId === '1').favourite, true);
    assert.equal(saved.songs.find(s => s.songId === '2').favourite, false);
    assert.deepEqual(saved.playlists[0].songIds, ['1']);
    await store.saveScan(complete([]), valid);
    assert.equal((await store.read()).songs.filter(s => s.available).length, 0);
  } finally { connection.close(); }
});

test('playlist validation and failed multi-add never leave partial edits', async () => {
  const connection = connect();
  try {
    const store = await createLibraryStore(connection.db);
    await store.saveScan(complete([song('1'), song('2')]), valid);
    await assert.rejects(store.savePlaylist('   '), /name/);
    await store.savePlaylist("音乐 ' MIX");
    await assert.rejects(store.savePlaylist(" 音乐 ' mix "), /already exists/);
    const id = (await store.read()).playlists[0].id;
    await assert.rejects(store.addSongs(id, ['1', 'missing'], valid), /unavailable/);
    assert.deepEqual((await store.read()).playlists[0].songIds, []);
    await store.addSongs(id, ['1', '2'], valid);
    await assert.rejects(store.reorder(id, ['1', '1']), /changed/);
    assert.deepEqual((await store.read()).playlists[0].songIds, ['1', '2']);
  } finally { connection.close(); }
});

test('search preserves originals and handles Chinese, metadata, case, canonical accents and SQL-like text', () => {
  const original = [song('1', '简体繁體.mp3'), song('2', 'Cafe\u0301.MP3'), song('3', "'; DROP TABLE songs;--.mp3")]
    .map(s => ({ ...s, available: true, favourite: false }));
  assert.equal(searchSongs(original, '繁體')[0].songId, '1');
  assert.equal(searchSongs(original, 'CAFÉ')[0].songId, '2');
  assert.equal(searchSongs(original, 'DROP TABLE')[0].songId, '3');
  assert.equal(searchSongs(original, '音樂').length, 3);
  assert.equal(original[1].filename, 'Cafe\u0301.MP3');
});

test('M3 migrates a version-1 library without changing songs or collections and saves preferences across reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'music-m3-preferences-'));
  const path = join(directory, 'library.db');
  let connection = connect(path);
  try {
    let store = await createLibraryStore(connection.db);
    await store.saveScan(complete([song('1'), song('2')]), valid);
    await store.setFavourite('1', true);
    await store.savePlaylist('Keep me');
    const id = (await store.read()).playlists[0].id;
    await store.addSongs(id, ['2', '1'], valid);
    const before = await store.read();
    // Recreate the exact v1 schema: M3's only schema additions are this table and version.
    await connection.db.execAsync('DROP TABLE preferences; PRAGMA user_version = 1;');
    connection.close(); connection = connect(path);
    store = await createLibraryStore(connection.db);
    assert.deepEqual(await store.read(), before);
    assert.deepEqual(await store.readPreferences(), { theme: 'system', artistSubtitles: false });
    await store.savePreferences({ theme: 'dark', artistSubtitles: true });
    connection.close(); connection = connect(path);
    store = await createLibraryStore(connection.db);
    assert.deepEqual(await store.readPreferences(), { theme: 'dark', artistSubtitles: true });
    assert.deepEqual(await store.read(), before);
  } finally { connection.close(); unlinkSync(path); rmdirSync(directory); }
});

test('M3 failed preference writes retain saved values and serialized writes can recover', async () => {
  const connection = connect();
  try {
    const store = await createLibraryStore(connection.db);
    await store.savePreferences({ theme: 'light', artistSubtitles: true });
    await connection.db.execAsync("CREATE TRIGGER fail_preferences BEFORE UPDATE ON preferences BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    await assert.rejects(store.savePreferences({ theme: 'dark', artistSubtitles: false }), /injected failure/);
    assert.deepEqual(await store.readPreferences(), { theme: 'light', artistSubtitles: true });
    await connection.db.execAsync('DROP TRIGGER fail_preferences;');
    await assert.rejects(store.savePreferences({ theme: 'invalid', artistSubtitles: false }), /Invalid/);
    await store.savePreferences({ theme: 'system', artistSubtitles: false });
    assert.deepEqual(await store.readPreferences(), { theme: 'system', artistSubtitles: false });
  } finally { connection.close(); }
});

test('M3 failed migration rolls back and does not reset existing version-1 data', async () => {
  const connection = connect();
  try {
    const store = await createLibraryStore(connection.db);
    await store.saveScan(complete([song('1')]), valid);
    await store.setFavourite('1', true);
    await connection.db.execAsync('DROP TABLE preferences; PRAGMA user_version = 1;');
    const execute = connection.db.execAsync;
    connection.db.execAsync = async sql => {
      if (sql.includes('CREATE TABLE preferences')) {
        await execute('CREATE TABLE preferences(id INTEGER);');
        throw new Error('injected migration failure');
      }
      await execute(sql);
    };
    await assert.rejects(createLibraryStore(connection.db), /migration failure/);
    assert.equal((await connection.db.getFirstAsync('PRAGMA user_version')).user_version, 1);
    assert.equal((await connection.db.getFirstAsync('SELECT favourite FROM songs WHERE id = ?', '1')).favourite, 1);
    assert.equal(await connection.db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'preferences'"), null);
    connection.db.execAsync = execute;
    assert.deepEqual(await (await createLibraryStore(connection.db)).readPreferences(), { theme: 'system', artistSubtitles: false });
  } finally { connection.close(); }
});
