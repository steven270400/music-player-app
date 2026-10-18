import type { DiscoveredSong, ScanResult } from '../../core/platform/M0Contracts';

type Value = string | number | null;
export interface LibrarySql {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...values: Value[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...values: Value[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...values: Value[]): Promise<T | null>;
}
export interface LibraryDatabase extends LibrarySql {
  withExclusiveTransactionAsync(work: (transaction: LibrarySql) => Promise<void>): Promise<void>;
}
export type LibrarySong = DiscoveredSong & { favourite: boolean; available: boolean };
export type Playlist = { id: number; name: string; songIds: string[] };
export type LibrarySnapshot = { songs: LibrarySong[]; playlists: Playlist[] };
export type Preferences = { theme: 'system' | 'light' | 'dark'; artistSubtitles: boolean };
export const defaultPreferences: Preferences = { theme: 'system', artistSubtitles: false };

export const textKey = (text: string) => text.normalize('NFC').toLowerCase();
export function searchSongs(songs: LibrarySong[], query: string) {
  const key = textKey(query.trim());
  if (!key) return songs;
  return songs.filter(song => [song.filename, song.title ?? '', song.artist ?? '']
    .some(value => textKey(value).includes(key)));
}
/** A single current index. Search result ownership belongs to the mounted view. */
export function createLibraryIndex(snapshot: LibrarySnapshot) {
  const byId = new Map(snapshot.songs.map(song => [song.songId, song]));
  const terms = new Map(snapshot.songs.map(song => [song.songId, [song.filename, song.title ?? '', song.artist ?? ''].map(textKey)]));
  const playlistSongs = new Map(snapshot.playlists.map(list => [list.id, list.songIds.map(id => byId.get(id)).filter((song): song is LibrarySong => !!song)]));
  const memberships = new Map(snapshot.playlists.map(list => [list.id, new Set(list.songIds)]));
  return { byId, playlistSongs, memberships, available: snapshot.songs.filter(song => song.available), favourites: snapshot.songs.filter(song => song.favourite),
    search(songs: LibrarySong[], query: string) {
      const key = textKey(query.trim());
      return key ? songs.filter(song => terms.get(song.songId)?.some(value => value.includes(key))) : songs;
    } };
}

/** Database reads can allocate identical objects; retain the previous committed value. */
export function retainLibrarySnapshot(previous: LibrarySnapshot, next: LibrarySnapshot): LibrarySnapshot {
  const sameSongs = previous.songs.length === next.songs.length && previous.songs.every((song, i) => {
    const other = next.songs[i];
    return song.songId === other.songId && song.filename === other.filename && song.title === other.title && song.artist === other.artist &&
      song.durationMs === other.durationMs && song.available === other.available && song.favourite === other.favourite &&
      song.binding.volume === other.binding.volume && song.binding.providerVersion === other.binding.providerVersion &&
      song.binding.rowId === other.binding.rowId && song.binding.generationAdded === other.binding.generationAdded;
  });
  const samePlaylists = previous.playlists.length === next.playlists.length && previous.playlists.every((list, i) => {
    const other = next.playlists[i];
    return list.id === other.id && list.name === other.name && list.songIds.length === other.songIds.length && list.songIds.every((id, j) => id === other.songIds[j]);
  });
  if (sameSongs && samePlaylists) return previous;
  return { songs: sameSongs ? previous.songs : next.songs, playlists: samePlaylists ? previous.playlists : next.playlists };
}
export function sortSongs(songs: LibrarySong[]) {
  const collator = new Intl.Collator(undefined, { numeric: true });
  return [...songs].sort((a, b) => collator.compare(a.filename, b.filename) || a.songId.localeCompare(b.songId));
}
function playlistName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a playlist name.');
  return { name: trimmed, key: textKey(trimmed) };
}

/** One small store owns collection writes. It has no file-write or playback API. */
export async function createLibraryStore(db: LibraryDatabase) {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((version?.user_version ?? 0) > 2) throw new Error('This library was saved by a newer app version.');
  if (!version?.user_version) {
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.execAsync(`
        CREATE TABLE songs (
          id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL,
          filename TEXT NOT NULL, title TEXT, artist TEXT, duration_ms REAL,
          available INTEGER NOT NULL DEFAULT 1, favourite INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE playlists (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE
        );
        CREATE TABLE playlist_songs (
          playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          song_id TEXT NOT NULL REFERENCES songs(id), position INTEGER NOT NULL,
          PRIMARY KEY (playlist_id, song_id)
        );
        CREATE INDEX playlist_order ON playlist_songs(playlist_id, position);
        PRAGMA user_version = 1;
      `);
    });
  }
  if ((version?.user_version ?? 0) < 2) {
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.execAsync(`CREATE TABLE preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        theme TEXT NOT NULL CHECK (theme IN ('system', 'light', 'dark')),
        artist_subtitles INTEGER NOT NULL CHECK (artist_subtitles IN (0, 1))
      );
      INSERT INTO preferences VALUES (1, 'system', 0);
      PRAGMA user_version = 2;`);
    });
  }
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>) {
    const operation = pending.then(work);
    pending = operation.catch(() => {});
    return operation;
  }
  function write(work: (tx: LibrarySql) => Promise<void>) {
    return serial(() => db.withExclusiveTransactionAsync(work));
  }
  async function requirePlaylist(tx: LibrarySql, id: number) {
    if (!await tx.getFirstAsync('SELECT id FROM playlists WHERE id = ?', id)) {
      throw new Error('This playlist is no longer available.');
    }
  }
  return {
    readPreferences(): Promise<Preferences> {
      return serial(async () => {
        const row = await db.getFirstAsync<{ theme: Preferences['theme']; artist_subtitles: number }>(
          'SELECT theme, artist_subtitles FROM preferences WHERE id = 1');
        if (!row) throw new Error('Saved appearance settings are unavailable. Retry without clearing app data.');
        return { theme: row.theme, artistSubtitles: !!row.artist_subtitles };
      });
    },
    savePreferences(value: Preferences) {
      if (!['system', 'light', 'dark'].includes(value.theme) || typeof value.artistSubtitles !== 'boolean') {
        return Promise.reject(new Error('Invalid appearance preference.'));
      }
      return write(async tx => {
        await tx.runAsync('UPDATE preferences SET theme = ?, artist_subtitles = ? WHERE id = 1',
          value.theme, value.artistSubtitles ? 1 : 0);
      });
    },
    read(): Promise<LibrarySnapshot> {
      return serial(async () => {
      const rows = await db.getAllAsync<{
        id: string; source: string; filename: string; title: string | null;
        artist: string | null; duration_ms: number | null; available: number; favourite: number;
      }>('SELECT * FROM songs');
      const playlists = await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM playlists ORDER BY name_key, id');
      const entries = await db.getAllAsync<{ playlist_id: number; song_id: string }>(
        'SELECT playlist_id, song_id FROM playlist_songs ORDER BY playlist_id, position');
      const membership = new Map<number, string[]>();
      for (const entry of entries) { const ids = membership.get(entry.playlist_id) ?? []; ids.push(entry.song_id); membership.set(entry.playlist_id, ids); }
      return {
        songs: sortSongs(rows.map(row => ({ songId: row.id, binding: JSON.parse(row.source),
          filename: row.filename, title: row.title, artist: row.artist, durationMs: row.duration_ms,
          available: !!row.available, favourite: !!row.favourite }))),
        playlists: playlists.map(list => ({ ...list, songIds: membership.get(list.id) ?? [] })),
      };
      });
    },
    async saveScan(scan: ScanResult, stillValid: () => Promise<boolean>) {
      if (scan.status !== 'complete') return false;
      await write(async tx => {
        if (!await stillValid()) throw new Error('Refresh cancelled. Saved library retained.');
        await tx.runAsync('UPDATE songs SET available = 0');
        for (const song of scan.songs) {
          await tx.runAsync(`INSERT INTO songs(id, source, filename, title, artist, duration_ms, available)
            VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET
            source=excluded.source, filename=excluded.filename, title=excluded.title,
            artist=excluded.artist, duration_ms=excluded.duration_ms, available=1`,
          song.songId, JSON.stringify(song.binding), song.filename, song.title, song.artist, song.durationMs);
        }
        if (!await stillValid()) throw new Error('Audio access or refresh changed. Saved library retained.');
      });
      return true;
    },
    setFavourite(songId: string, favourite: boolean) {
      return write(async tx => {
        if (!await tx.getFirstAsync('SELECT id FROM songs WHERE id = ?', songId)) throw new Error('Song is no longer in the saved library.');
        await tx.runAsync('UPDATE songs SET favourite = ? WHERE id = ?', favourite ? 1 : 0, songId);
      });
    },
    savePlaylist(name: string, id?: number) {
      return write(async tx => {
        const normalized = playlistName(name);
        if (await tx.getFirstAsync('SELECT id FROM playlists WHERE name_key = ? AND id != ?', normalized.key, id ?? -1)) {
          throw new Error('A playlist with that name already exists.');
        }
        if (id !== undefined) {
          await requirePlaylist(tx, id);
          await tx.runAsync('UPDATE playlists SET name = ?, name_key = ? WHERE id = ?', normalized.name, normalized.key, id);
        } else await tx.runAsync('INSERT INTO playlists(name, name_key) VALUES (?, ?)', normalized.name, normalized.key);
      });
    },
    addSongs(id: number, songIds: string[], hasAccess: () => Promise<boolean>) {
      return write(async tx => {
        await requirePlaylist(tx, id);
        if (!await hasAccess()) throw new Error('Allow audio access before adding songs.');
        const last = await tx.getFirstAsync<{ position: number | null }>('SELECT MAX(position) AS position FROM playlist_songs WHERE playlist_id = ?', id);
        let position = (last?.position ?? -1) + 1;
        for (const songId of new Set(songIds)) {
          if (!await tx.getFirstAsync('SELECT id FROM songs WHERE id = ? AND available = 1', songId)) {
            throw new Error('A selected song is unavailable. Refresh and try again.');
          }
          await tx.runAsync('INSERT OR IGNORE INTO playlist_songs(playlist_id, song_id, position) VALUES (?, ?, ?)', id, songId, position++);
        }
        if (!await hasAccess()) throw new Error('Audio access changed. No songs were added.');
      });
    },
    removeSong(id: number, songId: string) {
      return write(async tx => { await tx.runAsync('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?', id, songId); });
    },
    reorder(id: number, songIds: string[]) {
      return write(async tx => {
        await requirePlaylist(tx, id);
        const current = await tx.getAllAsync<{ song_id: string }>('SELECT song_id FROM playlist_songs WHERE playlist_id = ?', id);
        if (new Set(songIds).size !== current.length || songIds.length !== current.length ||
            current.some(row => !songIds.includes(row.song_id))) throw new Error('Playlist changed. Open reorder again.');
        for (const [position, songId] of songIds.entries()) {
          await tx.runAsync('UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND song_id = ?', position, id, songId);
        }
      });
    },
    deletePlaylist(id: number) {
      return write(async tx => {
        // Explicit membership deletion also works on SQLite connections without FK cascade enabled.
        await tx.runAsync('DELETE FROM playlist_songs WHERE playlist_id = ?', id);
        await tx.runAsync('DELETE FROM playlists WHERE id = ?', id);
      });
    },
  };
}
export type LibraryStore = Awaited<ReturnType<typeof createLibraryStore>>;
