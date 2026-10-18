import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, BackHandler, Keyboard, Linking, Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { requestAudioAccess } from '../../infrastructure/native/audioDiscovery';
import { Action, CircuitRule, Header, layout, Message, Panel, SearchField, type IconName } from '../../ui/Controls';
import { dark, light } from '../../ui/theme';
import { type LibrarySong, type Playlist } from './libraryStore';
import { pruneContexts, retainNavigationContexts } from './navigationCache';
import { useLibrary } from './useLibrary';
import { usePlayback } from '../setup/usePlayback';
import { usePreferences } from './usePreferences';
import { CompactPlayer, currentEntry, PlayerView } from './PlayerView';
import { SettingsView } from './SettingsView';
import { PlaylistEditor, type Editor } from './PlaylistEditor';
import { SongList } from './SongList';
import { PlaylistList } from './PlaylistList';
import { MotionProvider, useReducedMotion } from './PlayerMotion';

type Tab = 'songs' | 'playlists' | 'favourites' | 'settings';
type Undo = { songId: string; revision: number };
const sections: { key: Tab | 'player'; label: string; icon: IconName }[] = [
  { key: 'songs', label: 'Songs', icon: 'note' }, { key: 'playlists', label: 'Playlists', icon: 'list' },
  { key: 'player', label: 'Now playing', icon: 'note' }, { key: 'favourites', label: 'Favourites', icon: 'heart' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];
export function LibraryScreen() {
  return <MotionProvider><LibraryScreenContent /></MotionProvider>;
}
function LibraryScreenContent() {
  const library = useLibrary();
  const player = usePlayback(false);
  const preferences = usePreferences();
  const reducedMotion = useReducedMotion();
  const t = preferences.dark ? dark : light;
  const [tab, setTab] = useState<Tab>('songs');
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [route, setRoute] = useState<'root' | 'player'>('root');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [menu, setMenu] = useState<Playlist | null>(null);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [searches, setSearches] = useState<Record<string, boolean>>({});
  const offsets = useRef<Record<string, number>>({});
  const recentContexts = useRef<string[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState('');
  const [undo, setUndo] = useState<Undo | null>(null);
  const revisions = useRef(new Map<string, number>());
  const favouriteBusy = useRef(false);
  const playlist = library.data.playlists.find(list => list.id === playlistId);
  const context = tab === 'playlists' && playlist ? `playlist-${playlist.id}` : tab;
  const query = queries[context] ?? '';
  const searchOpen = searches[context] ?? false;
  const { byId, available } = library.index;
  const baseSongs = tab === 'favourites' ? library.index.favourites :
    tab === 'playlists' && playlist ? library.index.playlistSongs.get(playlist.id)! : available;
  const visible = useMemo(() => library.index.search(baseSongs, query), [library.index, baseSongs, query]);
  useEffect(() => {
    const retained = retainNavigationContexts(recentContexts.current, context, library.data.playlists.map(list => list.id));
    recentContexts.current = retained.recent;
    offsets.current = pruneContexts(offsets.current, retained.allowed);
    setQueries(current => pruneContexts(current, retained.allowed));
    setSearches(current => pruneContexts(current, retained.allowed));
  }, [context, library.data.playlists]);
  const entry = currentEntry(player);
  const currentSong = entry ? byId.get(entry.song.songId) : undefined;
  const granted = library.access?.status === 'granted';
  const showPlaylists = tab === 'playlists' && !playlist;

  function closeSearch() {
    Keyboard.dismiss();
    offsets.current[context] = 0;
    setQueries(current => ({ ...current, [context]: '' }));
    setSearches(current => ({ ...current, [context]: false }));
  }

  function back() {
    if (route === 'player') { setRoute('root'); return true; }
    // Android IMEs can leave Keyboard's last-known visibility stale after blur.
    // Only a focused input may consume a Back press as keyboard dismissal.
    if (Keyboard.isVisible() && TextInput.State.currentlyFocusedInput()) { Keyboard.dismiss(); return true; }
    if (searchOpen) { closeSearch(); return true; }
    if (tab === 'playlists' && playlistId !== null) { setPlaylistId(null); return true; }
    if (tab !== 'songs') { setTab('songs'); return true; }
    return false;
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => route === 'player' ? false : back());
    return () => subscription.remove();
  }, [route, tab, playlistId, searchOpen, context]);
  useEffect(() => {
    if (!undo) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => { if (!cancelled) timer = setTimeout(() => setUndo(current => current === undo ? null : current), ms); };
    if (Platform.OS === 'android') void AccessibilityInfo.getRecommendedTimeoutMillis(6000).then(schedule, () => schedule(10000));
    else schedule(10000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [undo]);
  async function toggleFavourite(song: LibrarySong) {
    if (favouriteBusy.current || library.saving) return;
    favouriteBusy.current = true;
    const revision = (revisions.current.get(song.songId) ?? 0) + 1;
    revisions.current.set(song.songId, revision);
    setUndo(current => current?.songId === song.songId ? null : current);
    const ok = await library.save(store => store.setFavourite(song.songId, !song.favourite));
    if (ok && song.favourite) setUndo({ songId: song.songId, revision });
    favouriteBusy.current = false;
  }
  async function undoFavourite() {
    if (!undo || favouriteBusy.current || library.saving) return;
    const target = undo;
    if (revisions.current.get(target.songId) !== target.revision) { setUndo(null); return; }
    favouriteBusy.current = true;
    const ok = await library.save(store => store.setFavourite(target.songId, true));
    if (ok) { revisions.current.set(target.songId, target.revision + 1); setUndo(null); }
    favouriteBusy.current = false;
  }
  async function allowAudio() {
    if (requesting) return;
    setRequesting(true);
    try { await requestAudioAccess(); await library.refresh(); setPermissionMessage(''); }
    catch { setPermissionMessage('Could not request audio access. Open Android settings to allow it.'); }
    finally { setRequesting(false); }
  }
  function openEditor(value: Editor) { library.clearSaveError(); setEditor(value); }
  function playlistMenu(list: Playlist) {
    setMenu(list);
  }
  function deletePlaylist(list: Playlist) {
    setMenu(null);
    Alert.alert('Delete playlist?', 'Only this playlist is deleted. Your music files and favourites are kept.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
          void library.save(store => store.deletePlaylist(list.id)).then(ok => { if (ok) setPlaylistId(null); });
        } },
    ]);
  }
  const permission = <Message theme={t} title="Allow music access" detail="Read music in internal storage. Your audio files are never changed or uploaded.">
    <Action theme={t} label="Allow audio access" primary disabled={requesting} onPress={() => void allowAudio()} />
    <Action theme={t} label="Open Android settings" onPress={() => void Linking.openSettings().catch(() => setPermissionMessage('Open this app’s permissions in Android Settings.'))} />
    {!!permissionMessage && <Text accessibilityLiveRegion="polite" style={{ color: t.error }}>{permissionMessage}</Text>}
  </Message>;
  const empty = !library.ready ? <Message theme={t} title={library.refreshError ? 'Library unavailable' : 'Opening library…'} detail={library.refreshError || 'Your saved music will appear here.'} /> :
    query ? <Message theme={t} title="No matching songs" detail="Try a different filename, title or artist." /> :
    tab === 'favourites' ? <Message theme={t} title="No favourites yet" detail="Tap a song’s heart to save it here." /> :
    playlist ? <Message theme={t} title="This playlist is empty" detail="Add songs from your library to begin." /> :
    library.access?.status === 'denied' ? permission :
    library.refreshError ? <Message theme={t} title="Refresh failed" detail="Your saved library has been retained. Use Retry refresh above." error /> :
    <Message theme={t} title={library.refreshing ? 'Finding your music…' : 'No songs found'} detail="This app reads indexed audio from internal storage. Add music, then refresh." />;
  const title = tab === 'songs' ? 'Songs' : tab === 'playlists' ? playlist?.name ?? 'Playlists' : tab === 'favourites' ? 'Favourites' : 'Settings';
  if (!preferences.ready && !preferences.error) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}><Message theme={t} title="Opening library…" detail="Loading your saved appearance and music." /></SafeAreaView>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
    <StatusBar style={t.dark ? 'light' : 'dark'} />
    {!!preferences.error && !preferences.ready && <Message theme={t} title="Appearance unavailable" detail={preferences.error}><Action theme={t} label="Retry appearance" onPress={() => void preferences.reload()} /></Message>}
    <View style={{ flex: 1, display: route === 'root' ? 'flex' : 'none' }} importantForAccessibility={route === 'root' ? 'auto' : 'no-hide-descendants'}>
      <Header theme={t} title={title} back={tab === 'playlists' && !!playlist ? () => setPlaylistId(null) : undefined}>
        {tab !== 'settings' && !showPlaylists && <Action theme={t} label="Search" icon="search" selected={searchOpen} onPress={() => searchOpen ? closeSearch() : setSearches(current => ({ ...current, [context]: true }))} />}
        {tab === 'songs' && <Action theme={t} label="Refresh library" icon="refresh" disabled={library.refreshing} onPress={() => void library.refresh()} />}
        {showPlaylists && <Action theme={t} label="Create playlist" icon="plus" disabled={!library.ready || library.saving} onPress={() => openEditor({ kind: 'name' })} />}
        {tab === 'playlists' && playlist && <Action theme={t} label="Playlist options" icon="more" disabled={library.saving} onPress={() => playlistMenu(playlist)} />}
      </Header>
      {tab === 'settings' ? <SettingsView theme={t} preferences={preferences} granted={granted} request={() => void allowAudio()} /> : <>
        <View style={{ paddingHorizontal: 24, paddingVertical: 12, gap: 8 }}>
          <Text style={{ color: t.muted, fontSize: 15 }}>{showPlaylists ? `${library.data.playlists.length} playlists` : `${visible.length} songs${query ? ' · Filtered' : tab === 'playlists' && playlist ? ' · Playlist order' : ''}`}</Text>
          {library.refreshing && <View style={layout.wrap}><Text accessibilityLiveRegion="polite" style={{ color: t.muted }}>Refreshing library…</Text><Action theme={t} label="Cancel refresh" onPress={library.cancelRefresh} /></View>}
          {!!library.refreshError && <View style={{ gap: 8 }}><Text accessibilityLiveRegion="polite" style={{ color: t.error }}>{library.refreshError}</Text><Action theme={t} label="Retry refresh" onPress={() => void library.refresh()} disabled={library.refreshing} /></View>}
          {!editor && !!library.saveError && <Text accessibilityLiveRegion="polite" style={{ color: t.error }}>{library.saveError}</Text>}
          {library.access?.status === 'denied' && (baseSongs.length > 0 || tab !== 'songs') && <Action theme={t} label="Audio access needed · Permission help" onPress={() => setTab('settings')} />}
          {tab === 'playlists' && playlist && <Action theme={t} label="Add songs" primary disabled={!granted || library.saving} onPress={() => openEditor({ kind: 'add', playlist })} />}
        </View>
        {searchOpen && (route === 'root' ? <SearchField theme={t} value={query} onChange={value => { offsets.current[context] = 0; setQueries(current => ({ ...current, [context]: value })); }} /> : <View style={{ height: 50 }} />)}
        {showPlaylists ? <PlaylistList theme={t} playlists={library.data.playlists} open={setPlaylistId}
          offset={offsets.current.playlists ?? 0} onOffset={offset => { offsets.current.playlists = offset; }}
          empty={<Message theme={t} title="No playlists yet" detail="Create your first playlist to collect songs for a mood or a moment."><Action theme={t} label="Create playlist" primary disabled={!library.ready} onPress={() => openEditor({ kind: 'name' })} /></Message>} /> :
          <SongList key={context} query={query} theme={t} songs={visible} currentId={entry?.song.songId} granted={granted} subtitles={preferences.value.artistSubtitles}
            play={song => void player.playList(visible.filter(item => item.available), song)} favourite={song => void toggleFavourite(song)}
            remove={tab === 'playlists' && playlist ? song => void library.save(store => store.removeSong(playlist.id, song.songId)) : undefined}
            saving={library.saving} empty={empty} offset={offsets.current[context] ?? 0} onOffset={offset => { offsets.current[context] = offset; }} />}
      </>}
      <CompactPlayer theme={t} player={player} granted={granted} open={() => { Keyboard.dismiss(); setRoute('player'); }} />
      <CircuitRule theme={t} />
      <View style={{ flexDirection: 'row', paddingHorizontal: 4, alignItems: 'center' }}>
        {sections.map(section => <Action key={section.key} theme={t} label={section.label} icon={section.icon} caption={section.key === 'player' ? undefined : section.label}
          role={section.key === 'player' ? 'button' : 'tab'} selected={section.key === tab}
          style={section.key === 'player' ? { width: 64, height: 64, borderWidth: 2, borderColor: t.accent, borderRadius: 32, marginHorizontal: 4, backgroundColor: t.surface } : { flex: 1, paddingHorizontal: 0, minHeight: 68 }}
          onPress={() => { Keyboard.dismiss(); if (section.key === 'player') setRoute('player'); else setTab(section.key); }} />)}
      </View>
    </View>
    {route === 'player' && <PlayerView theme={t} player={player} granted={granted} back={back}
      browse={() => { setTab('songs'); setRoute('root'); }} favourite={currentSong?.favourite ?? false} saving={library.saving || !currentSong}
      toggleFavourite={() => { if (currentSong) void toggleFavourite(currentSong); }} />}
    {route !== 'root' && !!library.saveError && <Text accessibilityLiveRegion="polite" style={{ color: t.error, padding: 16 }}>{library.saveError}</Text>}
    {route !== 'player' && !!player.state?.error && <Text accessibilityLiveRegion="polite" style={{ color: t.error, padding: 16 }}>{player.state.error.message}</Text>}
    {!!player.message && <View style={{ paddingHorizontal: 24, paddingVertical: 8 }}><Text accessibilityLiveRegion="polite" style={{ color: t.error }}>{player.message}</Text>
      <Action theme={t} label="Reconnect playback" onPress={() => void player.reconnect()} />
    </View>}
    {undo && <Panel theme={t} style={{ margin: 12 }}><View style={layout.row}><Text accessibilityLiveRegion="polite" style={{ color: t.text, flex: 1 }}>Removed from favourites</Text>
      <Action theme={t} label="Undo" onPress={() => void undoFavourite()} disabled={library.saving} /><Action theme={t} label="Dismiss Undo" icon="close" onPress={() => setUndo(null)} />
    </View></Panel>}
    {editor && <PlaylistEditor theme={t} editor={editor} library={library} close={() => setEditor(null)} />}
    <Modal visible={!!menu} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => setMenu(null)}>
      <View style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'center', padding: 24 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <View accessibilityViewIsModal style={{ padding: 24, gap: 16, backgroundColor: t.surface, borderRadius: 8 }}>
            <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24 }}>{menu?.name}</Text>
            <Action theme={t} label="Rename playlist" onPress={() => { if (menu) openEditor({ kind: 'name', playlist: menu }); setMenu(null); }} />
            <Action theme={t} label="Reorder songs" onPress={() => { if (menu) openEditor({ kind: 'reorder', playlist: menu }); setMenu(null); }} />
            <Action theme={t} label="Delete playlist" onPress={() => { if (menu) deletePlaylist(menu); }} />
            <Action theme={t} label="Cancel" onPress={() => setMenu(null)} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  </SafeAreaView>;
}
