import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, FlatList, Keyboard, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Header, Icon, layout, SearchField } from '../../ui/Controls';
import { duration, type Theme } from '../../ui/theme';
import { type LibrarySong, type Playlist } from './libraryStore';
import { useReducedMotion } from './PlayerMotion';
import type { useLibrary } from './useLibrary';
import { audioDiscovery } from '../../infrastructure/native/audioDiscovery';
export type Editor = { kind: 'name'; playlist?: Playlist } | { kind: 'add' | 'reorder'; playlist: Playlist };
export function PlaylistEditor({ theme: t, editor, library, close }: { theme: Theme; editor: Editor; library: ReturnType<typeof useLibrary>; close: () => void }) {
  const [name, setName] = useState(editor.kind === 'name' ? editor.playlist?.name ?? '' : '');
  const [draft, setDraft] = useState(editor.kind === 'reorder' ? editor.playlist.songIds : [] as string[]);
  const [query, setQuery] = useState('');
  const saving = useRef(false);
  const byId = library.index.byId;
  const reducedMotion = useReducedMotion();
  const members = useMemo(() => new Set(editor.playlist?.songIds ?? []), [editor.playlist?.songIds]);
  const selected = useMemo(() => new Set(draft), [draft]);
  const dirty = editor.kind === 'name' ? name !== (editor.playlist?.name ?? '') : editor.kind === 'add' ? draft.length > 0 :
    JSON.stringify(draft) !== JSON.stringify(editor.playlist.songIds);
  function cancel() {
    if (Keyboard.isVisible() && TextInput.State.currentlyFocusedInput()) { Keyboard.dismiss(); return; }
    if (saving.current || library.saving) return;
    if (dirty) Alert.alert('Discard changes?', 'Your saved playlist will stay unchanged.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: close },
    ]); else close();
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    const ok = await library.save(store => editor.kind === 'name' ? store.savePlaylist(name, editor.playlist?.id) :
      editor.kind === 'reorder' ? store.reorder(editor.playlist.id, draft) :
      store.addSongs(editor.playlist.id, library.data.songs.filter(song => draft.includes(song.songId)).map(song => song.songId),
        async () => (await audioDiscovery.getAccess()).status === 'granted'));
    saving.current = false;
    if (ok) close();
  }
  useEffect(() => { library.clearSaveError(); }, []);
  const rows = useMemo(() => editor.kind === 'reorder' ? draft.map(id => byId.get(id)).filter((song): song is LibrarySong => !!song) :
    library.index.search(library.index.available, query), [editor.kind, draft, byId, library.index, query]);
  const title = editor.kind === 'name' ? editor.playlist ? 'Rename playlist' : 'Create playlist' : editor.kind === 'add' ? 'Add songs' : 'Reorder songs';
  function move(index: number, offset: number) {
    setDraft(current => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
    AccessibilityInfo.announceForAccessibility(`Moved to position ${index + offset + 1}`);
  }
  return <Modal visible onRequestClose={cancel} animationType={reducedMotion ? 'none' : 'slide'} statusBarTranslucent>
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Header theme={t} title={title} back={cancel} />
      {!!library.saveError && <Text accessibilityLiveRegion="polite" style={{ color: t.error, marginHorizontal: 24, marginBottom: 12 }}>{library.saveError}</Text>}
      {editor.kind === 'name' ? <View style={[layout.content, layout.fill]}>
        <Text style={{ color: t.muted }}>Use a unique name for this playlist.</Text>
        <TextInput accessibilityLabel="Playlist name" placeholder="Playlist name" placeholderTextColor={t.muted} value={name}
          onChangeText={setName} autoFocus editable={!library.saving} style={{ minHeight: 56, padding: 16, color: t.text, fontSize: 18, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, borderRadius: 4 }} />
      </View> : <>
        <Text style={{ color: t.muted, margin: 24 }}>{editor.playlist.name}{editor.kind === 'reorder' ? '\nUse the arrows to change the order. Changes apply when you save.' : ''}</Text>
        {editor.kind === 'add' && <SearchField theme={t} value={query} onChange={setQuery} label="Search songs to add" />}
        <FlatList data={rows} keyExtractor={song => song.songId} contentContainerStyle={{ padding: 24, flexGrow: 1 }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ color: t.muted }}>{query ? 'No matching songs.' : 'No available songs. Refresh your library first.'}</Text>}
          renderItem={({ item, index }) => {
            const member = members.has(item.songId);
            const checked = member || selected.has(item.songId);
            return <View style={[layout.row, { minHeight: 80, borderBottomWidth: 1, borderColor: t.border, paddingVertical: 12 }]}>
              {editor.kind === 'add' ? <Pressable accessibilityRole="checkbox" accessibilityLabel={item.filename}
                accessibilityState={{ checked, disabled: member || library.saving }} disabled={member || library.saving}
                onPress={() => setDraft(current => current.includes(item.songId) ? current.filter(id => id !== item.songId) : [...current, item.songId])}
                style={[layout.row, { flex: 1, minHeight: 48 }]}>
                <Icon name={checked ? 'check' : 'box'} color={checked && !member ? t.accent : t.muted} />
                <View style={{ flex: 1, gap: 8 }}><Text numberOfLines={2} style={{ color: t.text, fontSize: 16 }}>{item.filename}</Text>
                  {(member || checked) && <Text style={{ color: t.muted }}>{member ? 'Already added' : 'Selected'}</Text>}</View>
                <Text style={{ color: t.muted }}>{duration(item.durationMs)}</Text>
              </Pressable> : <>
                <Text style={{ color: t.muted }}>{index + 1}</Text><Text numberOfLines={2} style={{ flex: 1, color: t.text, fontSize: 16 }}>{item.filename}</Text>
                <Action theme={t} icon="up" label={`Move ${item.filename} up`} disabled={index === 0 || library.saving} onPress={() => move(index, -1)} />
                <Action theme={t} icon="down" label={`Move ${item.filename} down`} disabled={index === rows.length - 1 || library.saving} onPress={() => move(index, 1)} />
              </>}
            </View>;
          }} />
      </>}
      <View style={layout.content}>{editor.kind === 'add' && <Text style={{ color: t.accent }}>{draft.length} selected</Text>}
        <View style={layout.wrap}>
          <Action theme={t} label="Cancel" onPress={cancel} disabled={library.saving} style={{ flex: 1 }} />
          <Action theme={t} label={library.saving ? 'Saving…' : editor.kind === 'add' ? 'Add songs' : editor.kind === 'reorder' ? 'Save order' : 'Save'}
            primary onPress={() => void save()} disabled={library.saving || (editor.kind === 'add' && draft.length === 0)} style={{ flex: 1 }} />
        </View>
      </View>
    </SafeAreaView>
  </Modal>;
}
