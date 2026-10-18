import { useMemo, useState } from 'react';
import { Button, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { usePlayback } from '../setup/usePlayback';

function time(ms: number | null | undefined) {
  if (ms == null) return '—';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Functional M2 controls. All displayed state and queue order come from the service. */
export function PlaybackPanel({ player, granted, ink, surface }: {
  player: ReturnType<typeof usePlayback>; granted: boolean; ink: string; surface: string;
}) {
  const [queueOpen, setQueueOpen] = useState(false);
  const state = player.state;
  const entriesById = useMemo(() => new Map(state?.entries.map(entry => [entry.entryId, entry])), [state?.entries]);
  const current = state?.currentEntryId ? entriesById.get(state.currentEntryId) : undefined;
  const disabled = !current || !granted;
  const active = state?.status === 'playing' || state?.status === 'loading';
  return <View style={[styles.panel, { backgroundColor: surface }]}>
    <Text numberOfLines={2} style={{ color: ink }}>{current?.song.filename ?? 'No song selected'}</Text>
    {!!state?.error && <Text accessibilityLiveRegion="polite" style={{ color: ink }}>{state.error.message}</Text>}
    <Text style={{ color: ink }}>{state?.status ?? 'Connecting'} · {time(state?.positionMs)} / {time(state?.durationMs)}</Text>
    <View style={styles.controls}>
      <Button title="Previous" disabled={disabled} onPress={() => void player.control({ action: 'previous' })} />
      <Button title={active ? 'Pause' : 'Play'} disabled={!current || (!granted && !active)}
        onPress={() => void player.control({ action: active ? 'pause' : 'play' })} />
      <Button title="Next" disabled={disabled || (state?.repeat !== 'all' && state?.currentEntryId === state?.playbackOrder.at(-1))}
        onPress={() => void player.control({ action: 'next' })} />
    </View>
    <View style={styles.controls}>
      <Button title={`Shuffle: ${state?.shuffle ? 'on' : 'off'}`} disabled={disabled}
        onPress={() => void player.control({ action: 'setShuffle', shuffle: !state?.shuffle })} />
      <Button title={`Repeat: ${state?.repeat ?? 'off'}`} disabled={disabled}
        onPress={() => void player.control({ action: 'setRepeat', repeat: state?.repeat === 'off' ? 'one' : state?.repeat === 'one' ? 'all' : 'off' })} />
      <Button title="Queue" disabled={!current} onPress={() => setQueueOpen(true)} />
    </View>
    <View style={styles.controls}>
      <Button title="−15 sec" accessibilityLabel="Seek back 15 seconds" disabled={disabled}
        onPress={() => void player.control({ action: 'seek', positionMs: Math.max(0, (state?.positionMs ?? 0) - 15000) })} />
      <Button title="+15 sec" accessibilityLabel="Seek forward 15 seconds" disabled={disabled}
        onPress={() => void player.control({ action: 'seek', positionMs: Math.min(state?.durationMs ?? Number.MAX_SAFE_INTEGER, (state?.positionMs ?? 0) + 15000) })} />
    </View>
    <Text style={{ color: ink, fontSize: 12 }}>{player.message}</Text>
    {!state && <Button title="Reconnect playback" onPress={() => void player.reconnect()} />}
    <Modal visible={queueOpen} onRequestClose={() => setQueueOpen(false)} animationType="slide">
      <SafeAreaView style={[styles.queue, { backgroundColor: surface }]}>
        <Button title="Close queue" onPress={() => setQueueOpen(false)} />
        <Text style={{ color: ink }}>Playback order · {state?.playbackOrder.length ?? 0} songs</Text>
        <FlatList data={state?.playbackOrder ?? []} keyExtractor={id => id} renderItem={({ item, index }) => {
          const entry = entriesById.get(item);
          return <Pressable accessibilityRole="button" accessibilityLabel={`Play queue song ${entry?.song.filename ?? ''}`}
            accessibilityState={{ selected: item === state?.currentEntryId, disabled: !granted }}
            disabled={!granted} style={styles.row} onPress={() => void player.control({ action: 'select', entryId: item })}>
            <Text style={{ color: ink }}>{item === state?.currentEntryId ? '▶ ' : ''}{index + 1}. {entry?.song.filename ?? 'Unavailable song'}</Text>
          </Pressable>;
        }} />
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 10, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#79818E' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  queue: { flex: 1, padding: 16, gap: 12 },
  row: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#79818E' },
});
