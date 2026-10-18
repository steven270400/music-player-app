import type { ReactNode } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Icon, layout, Panel } from '../../ui/Controls';
import type { Theme } from '../../ui/theme';
import { useListOffset } from '../../ui/useListOffset';
import type { Playlist } from './libraryStore';

export function PlaylistList({ theme: t, playlists, open, empty, offset, onOffset }: {
  theme: Theme; playlists: Playlist[]; open: (id: number) => void; empty: ReactNode;
  offset: number; onOffset: (value: number) => void;
}) {
  const scroll = useListOffset<Playlist>(offset, onOffset);
  return <FlatList {...scroll} data={playlists} keyExtractor={list => String(list.id)}
    contentContainerStyle={{ padding: 24, gap: 20, flexGrow: 1 }} ListEmptyComponent={<>{empty}</>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open playlist ${item.name}`} onPress={() => open(item.id)}>
      <Panel theme={t}><View style={layout.row}><View style={{ flex: 1, gap: 12 }}>
        <Text style={{ color: t.text, fontSize: 20 }}>{item.name}</Text>
        <Text style={{ color: t.muted }}>{item.songIds.length} songs</Text>
      </View><Icon name="down" color={t.text} /></View></Panel>
    </Pressable>} />;
}
