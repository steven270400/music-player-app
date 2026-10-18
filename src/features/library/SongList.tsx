import { FlatList, Pressable, Text, View } from 'react-native';
import { Action, layout } from '../../ui/Controls';
import { duration, type Theme } from '../../ui/theme';
import { useListOffset } from '../../ui/useListOffset';
import type { LibrarySong } from './libraryStore';
import { useEffect, useRef, type ReactNode } from 'react';
export function SongList({ theme: t, songs, currentId, granted, subtitles, play, favourite, remove, saving, empty, offset, onOffset, query }: {
  theme: Theme; songs: LibrarySong[]; currentId?: string; granted: boolean; subtitles: boolean;
  play: (song: LibrarySong) => void; favourite: (song: LibrarySong) => void; remove?: (song: LibrarySong) => void;
  saving: boolean; empty: ReactNode; offset: number; onOffset: (offset: number) => void; query: string;
}) {
  const { reset, ...scroll } = useListOffset<LibrarySong>(offset, onOffset);
  const initialQuery = useRef(query);
  useEffect(() => { if (initialQuery.current !== query) { initialQuery.current = query; reset(); } }, [query]);
  return <FlatList {...scroll} data={songs} keyExtractor={song => song.songId}
    contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, flexGrow: 1 }}
    keyboardShouldPersistTaps="handled" ListEmptyComponent={<>{empty}</>}
    renderItem={({ item }) => {
      const selected = item.songId === currentId;
      return <View style={[layout.row, { minHeight: 84, paddingVertical: 12, borderBottomWidth: 1, borderColor: t.border, backgroundColor: selected ? t.raised : 'transparent' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Play ${item.filename}`}
          accessibilityState={{ selected, disabled: !granted || !item.available }} disabled={!granted || !item.available}
          onPress={() => play(item)} style={{ flex: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 4, gap: 6 }}>
          <Text numberOfLines={2} style={{ color: t.text, fontSize: 17 }}>{item.filename}</Text>
          {subtitles && !!item.artist && <Text numberOfLines={1} style={{ color: t.muted, fontSize: 14 }}>{item.artist}</Text>}
          {!item.available && <Text style={{ color: t.error, fontSize: 13 }}>Unavailable · file not found</Text>}
          {selected && <Text style={{ color: t.accent, fontSize: 12 }}>Current song</Text>}
        </Pressable>
        <Text style={{ color: t.muted, fontSize: 14 }}>{duration(item.durationMs)}</Text>
        {remove ? <Action theme={t} icon="close" label={`Remove ${item.filename} from playlist`} disabled={saving} onPress={() => remove(item)} /> :
          <Action theme={t} icon={item.favourite ? 'heartFilled' : 'heart'} selected={item.favourite}
            label={`${item.favourite ? 'Unfavourite' : 'Favourite'} ${item.filename}`} disabled={saving} onPress={() => favourite(item)} />}
      </View>;
    }} />;
}
