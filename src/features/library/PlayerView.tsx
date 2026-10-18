import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Action, Icon, layout, Message, Panel } from '../../ui/Controls';
import { duration, type Theme } from '../../ui/theme';
import type { usePlayback } from '../setup/usePlayback';
import { usePlaybackProgress, usePlaybackQueue } from '../setup/usePlayback';
import { Filename, useMotionSettings, usePlaybackCycle } from './PlayerMotion';
import { queueGeometry, queueDuration, DISC_PERIOD_MS } from './playerMotionMath';
import { markVisualTransition } from '../../ui/transitionWork';
type Player = ReturnType<typeof usePlayback>;
export function currentEntry(player: Player) {
  return player.state?.entries.find(entry => entry.entryId === player.state?.currentEntryId);
}
export function CompactPlayer({ theme: t, player, granted, open }: { theme: Theme; player: Player; granted: boolean; open: () => void }) {
  const entry = currentEntry(player);
  if (!entry) return null;
  const active = player.state?.status === 'playing' || player.state?.status === 'loading';
  const last = player.state?.repeat !== 'all' && player.state?.currentEntryId === player.state?.playbackOrder.at(-1);
  return <Panel theme={t} style={{ marginHorizontal: 12, padding: 12 }}><View style={layout.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open Now playing: ${entry.song.filename}`} onPress={open}
      style={{ flex: 1, minHeight: 48, justifyContent: 'center', gap: 4 }}>
      <Text numberOfLines={2} style={{ color: t.text, fontSize: 16 }}>{entry.song.filename}</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>{player.state?.status === 'ended' ? 'Ended · Play to restart' : active ? 'Playing' : 'Paused'} · Queue</Text>
    </Pressable>
    <Action theme={t} label={active ? 'Pause' : 'Play'} icon={active ? 'pause' : 'play'} selected
      disabled={!granted && !active} onPress={() => void player.control({ action: active ? 'pause' : 'play' })} />
    <Action theme={t} label="Next" icon="next" disabled={!granted || last} onPress={() => void player.control({ action: 'next' })} />
  </View></Panel>;
}
function SeekBar({ theme: t, player, disabled }: { theme: Theme; player: Player; disabled: boolean }) {
  const state = usePlaybackProgress(player);
  const [width, setWidth] = useState(1);
  const [preview, setPreview] = useState<number | null>(null);
  const draft = useRef(0);
  const contextAtStart = useRef('');
  const seekContext = `${state?.sessionId}:${state?.queueRevision}:${state?.currentEntryId}`;
  const length = state?.durationMs ?? 0;
  const position = preview ?? state?.positionMs ?? 0;
  const unavailable = disabled || length <= 0;
  useEffect(() => { setPreview(null); }, [seekContext]);
  function update(x: number) { const next = Math.round(Math.max(0, Math.min(1, x / width)) * length); draft.current = next; setPreview(next); }
  return <View>
    <View accessible accessibilityRole="adjustable" accessibilityLabel="Playback position"
      accessibilityState={{ disabled: unavailable }} accessibilityValue={{ min: 0, max: Math.max(1, length), now: Math.min(length, position), text: `${duration(position)} of ${duration(length)}` }}
      accessibilityActions={[{ name: 'increment', label: 'Forward 15 seconds' }, { name: 'decrement', label: 'Back 15 seconds' }]}
      onAccessibilityAction={event => { if (!unavailable) void player.control({ action: 'seek', positionMs: Math.max(0, Math.min(length, position + (event.nativeEvent.actionName === 'increment' ? 15000 : -15000))) }); }}
      style={{ minHeight: 48, justifyContent: 'center' }} onLayout={e => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !unavailable} onMoveShouldSetResponder={() => !unavailable}
      onResponderGrant={e => { contextAtStart.current = seekContext; update(e.nativeEvent.locationX); }}
      onResponderMove={e => update(e.nativeEvent.locationX)}
      onResponderRelease={() => { if (!unavailable && contextAtStart.current === seekContext) void player.control({ action: 'seek', positionMs: draft.current }); setPreview(null); }}
      onResponderTerminate={() => setPreview(null)}>
      <View style={{ height: 4, backgroundColor: t.border, borderRadius: 2 }}>
        <View style={{ width: `${length ? Math.min(100, 100 * position / length) : 0}%`, height: 4, backgroundColor: t.accent }} />
        <View style={{ position: 'absolute', top: -5, left: Math.max(0, Math.min(width - 14, width * position / (length || 1) - 7)), width: 14, height: 14, borderRadius: 7, backgroundColor: t.accent }} />
      </View>
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: t.muted }}>{duration(position)}</Text><Text style={{ color: t.muted }}>{duration(state?.durationMs)}</Text>
    </View>
  </View>;
}
export function PlayerView({ theme: t, player, granted, back, browse, favourite, toggleFavourite, saving }: {
  theme: Theme; player: Player; granted: boolean; back: () => void; browse: () => void;
  favourite: boolean; toggleFavourite: () => void; saving: boolean;
}) {
  const window = useWindowDimensions();
  const entry = currentEntry(player);
  const state = player.state;
  const active = state?.status === 'playing' || state?.status === 'loading';
  const motion = useMotionSettings();
  const animating = state?.status === 'playing' && !state.error && motion.visible && !motion.reduced;
  const rotation = usePlaybackCycle(animating, DISC_PERIOD_MS, 'disc');
  const entrance = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueMounted, setQueueMounted] = useState(false);
  const requested = useRef(false);
  function toggleQueue() { if (!motion.reduced) markVisualTransition(220); requested.current = !requested.current; setQueueOpen(requested.current); setQueueMounted(true); }
  function closeOrBack() { if (requested.current) { if (!motion.reduced) markVisualTransition(220); requested.current = false; setQueueOpen(false); } else back(); }
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { closeOrBack(); return true; });
    return () => listener.remove();
  }, [back]);
  const [height, setHeight] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(320);
  const geometry = queueGeometry(height, controlsHeight, window.width);
  const geometryKey = `${height}:${controlsHeight}:${window.width}:${window.fontScale}`;
  const previousGeometry = useRef('');
  const last = state?.repeat !== 'all' && state?.currentEntryId === state?.playbackOrder.at(-1);
  const status = state?.status === 'ended' ? 'Ended · Play to restart' : state?.status === 'loading' ? 'Loading…' : active ? 'Playing' : 'Paused';
  useEffect(() => {
    if (!motion.ready) return;
    if (motion.reduced) { entrance.setValue(1); return; }
    markVisualTransition(240);
    const animation = Animated.timing(entrance, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false });
    animation.start(); return () => animation.stop();
  }, [entrance, motion.ready, motion.reduced]);
  useEffect(() => {
    if (!height) return;
    const changed = previousGeometry.current !== geometryKey;
    previousGeometry.current = geometryKey;
    let disposed = false;
    progress.stopAnimation(value => {
      if (disposed) return;
      const target = queueOpen ? 1 : 0;
      if (changed || motion.reduced || !motion.visible) { progress.setValue(target); return; }
      Animated.timing(progress, { toValue: target, duration: queueDuration(value, target),
        easing: Easing.inOut(Easing.cubic), useNativeDriver: true, isInteraction: false }).start();
    });
    return () => { disposed = true; progress.stopAnimation(); };
  }, [height, progress, geometryKey, queueOpen, motion.reduced, motion.visible]);
  const translateControls = progress.interpolate({ inputRange: [0, 1], outputRange: [geometry.travel, 0] });
  const artScale = progress.interpolate({ inputRange: [0, 1], outputRange: [geometry.closedScale, geometry.openScale] });
  return <Animated.View style={[layout.fill, { paddingHorizontal: 24, paddingBottom: 8, opacity: entrance,
      transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
    <View style={styles.header}>
      <Action theme={t} label="Back" icon="back" onPress={closeOrBack} />
      <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: t.text, fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>NOW PLAYING</Text>
      <Action theme={t} label={favourite ? 'Remove from favourites' : 'Add to favourites'} icon={favourite ? 'heartFilled' : 'heart'} selected={favourite}
        disabled={saving || !entry} onPress={toggleFavourite} />
    </View>
    {!entry ? <Message theme={t} title="No song selected" detail="Choose a song from your library to start listening.">
      <Action theme={t} label="Browse songs" primary onPress={browse} />
    </Message> : <View style={{ flex: 1, overflow: 'hidden' }} onLayout={e => setHeight(e.nativeEvent.layout.height)}>
      <Animated.View accessible={false} importantForAccessibility="no-hide-descendants"
        pointerEvents="none" style={{ position: 'absolute', top: -148, left: 0, right: 0, alignItems: 'center',
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [geometry.closed / 2, geometry.open / 2] }) }] }}>
        <Animated.View style={{ width: 296, height: 296, transform: [{ scale: artScale }] }}>
          <Animated.Image source={t.dark ? require('../../../assets/circuit/vinylDark.png') : require('../../../assets/circuit/vinylLight.png')}
            style={{ width: 296, height: 296, transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />
        </Animated.View>
      </Animated.View>
      <Animated.View onLayout={e => setControlsHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', top: geometry.open, left: 0, right: 0, gap: 8, transform: [{ translateY: translateControls }] }}>
        <View style={{ gap: 4 }}>
          <Filename key={entry.entryId} name={entry.song.filename} playing={animating} reduced={motion.reduced} theme={t} />
          {!!entry.song.artist && <Text numberOfLines={1} style={{ color: t.muted, fontSize: 14 }}>{entry.song.artist}</Text>}
          <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{status} · {(state?.playbackOrder.indexOf(entry.entryId) ?? 0) + 1} / {state?.playbackOrder.length}</Text>
          {!!state?.error && <Text accessibilityLiveRegion="polite" style={{ color: t.error, fontSize: 14 }}>{state.error.message}</Text>}
          {!granted && <Text style={{ color: t.error, fontSize: 14 }}>Audio access is needed to resume. Open Settings for permission help.</Text>}
        </View>
        <SeekBar theme={t} player={player} disabled={!granted} />
        <View style={styles.transport}>
          <Action theme={t} label={`Shuffle ${state?.shuffle ? 'on' : 'off'}`} icon="shuffle" selected={state?.shuffle}
            disabled={!granted} onPress={() => void player.control({ action: 'setShuffle', shuffle: !state?.shuffle })} />
          <Action theme={t} label="Previous" icon="previous" disabled={!granted} onPress={() => void player.control({ action: 'previous' })} />
          <Action theme={t} label={active ? 'Pause' : 'Play'} icon={active ? 'pause' : 'play'} disabled={!granted && !active} primary
            style={{ width: 72, height: 72, borderRadius: 36 }} onPress={() => void player.control({ action: active ? 'pause' : 'play' })} />
          <Action theme={t} label="Next" icon="next" disabled={!granted || last} onPress={() => void player.control({ action: 'next' })} />
          <View>
            <Action theme={t} label={`Repeat ${state?.repeat ?? 'off'}`} icon="repeat" selected={state?.repeat !== 'off'} disabled={!granted}
              onPress={() => void player.control({ action: 'setRepeat', repeat: state?.repeat === 'off' ? 'one' : state?.repeat === 'one' ? 'all' : 'off' })} />
            {state?.repeat === 'one' && <Text accessible={false} pointerEvents="none" style={{ position: 'absolute', right: 3, top: 0, color: t.accent, fontSize: 12 }}>1</Text>}
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Queue" accessibilityState={{ expanded: queueOpen }} onPress={toggleQueue}
          style={({ pressed }) => [styles.queueToggle, { backgroundColor: t.surface, opacity: pressed ? 0.65 : 1 }]}>
          <Icon name="list" color={queueOpen ? t.accent : t.text} />
          <Text style={{ flex: 1, color: t.text, fontSize: 14 }}>Queue</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{state?.playbackOrder.length ?? 0}</Text>
          <Icon name={queueOpen ? 'up' : 'down'} color={t.text} />
        </Pressable>
      </Animated.View>
      {queueMounted && <Animated.View pointerEvents={queueOpen ? 'auto' : 'none'} importantForAccessibility={queueOpen ? 'auto' : 'no-hide-descendants'}
        style={{ position: 'absolute', top: geometry.open + controlsHeight, left: 0, right: 0, height: geometry.queueHeight, overflow: 'hidden',
          opacity: progress, transform: [{ translateY: translateControls }] }}>
        <InlineQueue theme={t} store={player.store} control={player.control} granted={granted} />
      </Animated.View>}
    </View>}
  </Animated.View>;
}

const InlineQueue = memo(function InlineQueue({ theme: t, store, control, granted }: { theme: Theme; store: Player['store']; control: Player['control']; granted: boolean }) {
  const state = usePlaybackQueue(store);
  const entries = useMemo(() => new Map(state?.entries.map(e => [e.entryId, e])), [state?.sessionId, state?.queueRevision]);
  return <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
    <FlatList accessibilityLabel="Playback queue" style={{ flex: 1 }} data={state?.playbackOrder ?? []} extraData={state?.currentEntryId} keyExtractor={id => id}
      contentContainerStyle={{ paddingBottom: 8 }}
      ListHeaderComponent={<Text style={{ color: t.muted, fontSize: 12, paddingVertical: 8 }}>{state?.shuffle ? 'Shuffled order' : 'Playback order'}</Text>}
      ListEmptyComponent={<Text style={{ color: t.muted, paddingVertical: 16 }}>Your queue is empty</Text>}
      renderItem={({ item, index }) => {
        const entry = entries.get(item); const selected = item === state?.currentEntryId;
        return <Pressable accessibilityRole="button" accessibilityLabel={`Play queue song ${entry?.song.filename ?? 'Unavailable song'}`}
          accessibilityState={{ selected, disabled: !granted }} disabled={!granted} onPress={() => void control({ action: 'select', entryId: item })}
          style={[styles.queueRow, { borderColor: t.border, backgroundColor: selected ? t.raised : 'transparent' }]}>
          <Text style={{ color: selected ? t.accent : t.muted, fontSize: 12 }}>{index + 1}</Text>
          <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={{ color: t.text, fontSize: 15 }}>{entry?.song.filename ?? 'Unavailable song'}</Text>
            {selected && <Text style={{ color: t.accent, fontSize: 12 }}>Current song</Text>}
          </View><Text style={{ color: t.muted, fontSize: 12 }}>{duration(entry?.song.durationMs)}</Text>
        </Pressable>;
      }} />
  </View>;
});
const styles = StyleSheet.create({
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  transport: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 80 },
  queueToggle: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  queueRow: { minHeight: 64, paddingVertical: 12, paddingHorizontal: 8, gap: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
});
