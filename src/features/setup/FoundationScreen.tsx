import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Button, FlatList, Linking, PermissionsAndroid, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import type { AccessState, DiscoveredSong } from '../../core/platform/M0Contracts';
import { audioDiscovery, discoverM0Audio, requestAudioAccess } from '../../infrastructure/native/audioDiscovery';
import { usePlayback } from './usePlayback';

function duration(ms: number | null) {
  if (ms === null) return '—';
  const total = Math.floor(ms / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export function FoundationScreen() {
  const player = usePlayback();
  const dark = useColorScheme() === 'dark';
  const color = dark ? '#F2F4F8' : '#171B22';
  const [access, setAccess] = useState<AccessState | null>(null);
  const [songs, setSongs] = useState<DiscoveredSong[]>([]);
  const [message, setMessage] = useState('Checking audio access…');
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);
  const [selected, setSelected] = useState<DiscoveredSong | null>(null);
  const [scope, setScope] = useState<'queue' | 'fixtures' | 'library'>(__DEV__ ? 'queue' : 'library');
  const currentScan = useRef<string | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const requestRevision = ++revision.current;
    if (currentScan.current) await audioDiscovery.cancelScan(currentScan.current).catch(() => {});
    currentScan.current = null;
    try {
      const result = await audioDiscovery.getAccess();
      if (!mounted.current || requestRevision !== revision.current) return;
      setAccess(result);
      if (result.status !== 'granted') {
        setBusy(false); setMessage('Audio access is required. Your files will only be read.'); return;
      }
      setSettingsRequired(false);
      const scanId = `scan-${Date.now()}-${requestRevision}`;
      currentScan.current = scanId;
      setBusy(true); setMessage(scope === 'library' ? 'Scanning internal storage…' : 'Scanning the M0 test folder…');
      const scan = await (scope === 'library' ? audioDiscovery.discoverAudio(scanId) : discoverM0Audio(scanId, scope));
      if (!mounted.current || requestRevision !== revision.current) return;
      if (scan.status === 'complete') {
        const collator = new Intl.Collator(undefined, { numeric: true });
        setSongs([...scan.songs].sort((a, b) => collator.compare(a.filename, b.filename) || a.songId.localeCompare(b.songId)));
        setMessage(scan.songs.length ? `${scan.songs.length} audio files found in this view.` :
          scope === 'library' ? 'Scan completed. No indexed audio was found in internal storage.' : 'No indexed test audio found. Transfer the synthetic fixtures before testing.');
      } else {
        setMessage(scan.error.message);
        if (scan.error.code === 'ACCESS_REQUIRED') setAccess({ ...result, status: 'denied' });
      }
    } catch {
      if (mounted.current && requestRevision === revision.current) setMessage('Discovery is unavailable. Open the custom Android build and try again.');
    } finally {
      if (mounted.current && requestRevision === revision.current) { setBusy(false); currentScan.current = null; }
    }
  }, [scope]);

  function changeScope(next: typeof scope) {
    if (next === scope) return;
    revision.current++;
    if (currentScan.current) void audioDiscovery.cancelScan(currentScan.current).catch(() => {});
    currentScan.current = null;
    setSongs([]); setSelected(null); setBusy(true);
    void player.control({ action: 'stop' });
    setScope(next);
  }
  // A restored queue can belong to another view. Require a visible song selection before
  // diagnostic transport can start it; Pause/Stop always remain available.
  const visibleIds = new Set(songs.map(song => song.songId));
  const queueInView = !!player.state?.entries.length && player.state.entries.every(entry => visibleIds.has(entry.song.songId));
  const canStart = access?.status === 'granted' && (scope === 'library' ? !!player.state?.entries.length : queueInView);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => {
      mounted.current = false; revision.current++;
      if (currentScan.current) void audioDiscovery.cancelScan(currentScan.current).catch(() => {});
      subscription.remove();
    };
  }, [refresh]);

  async function requestAccess() {
    if (requesting) return;
    setRequesting(true);
    try {
      const result = await requestAudioAccess();
      if (!mounted.current) return;
      setSettingsRequired(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
      await refresh();
    } catch { if (mounted.current) setMessage('Permission request could not be completed. You can use system settings.'); }
    finally { if (mounted.current) setRequesting(false); }
  }

  return (
    <FlatList style={{ backgroundColor: dark ? '#171B22' : '#F2F4F8' }}
      contentContainerStyle={styles.container} data={access?.status === 'granted' ? songs : []}
      keyExtractor={song => song.songId}
      ListHeaderComponent={<View style={styles.header}>
        <Text style={[styles.title, { color }]}>Music player · M0</Text>
        <Text style={{ color }}>Native playback and recovery prototype · device validation pending.</Text>
        {__DEV__ && <>
          <Text style={{ color }}>View: {scope === 'queue' ? 'three short test tones' : scope === 'fixtures' ? 'all test fixtures' : 'all internal audio'}. Changing views stops playback.</Text>
          <Text style={{ color }}>Test location: Music/MusicPlayerM0/{scope === 'queue' ? 'queue/' : ''}</Text>
          <Button title="Short test queue" disabled={scope === 'queue'} onPress={() => changeScope('queue')} />
          <Button title="All test fixtures" disabled={scope === 'fixtures'} onPress={() => changeScope('fixtures')} />
          <Button title="All internal audio" disabled={scope === 'library'} onPress={() => changeScope('library')} />
        </>}
        <Text style={{ color }}>{player.message}</Text>
        <Button title="Reconnect playback" onPress={() => void player.reconnect()} />
        {player.state && <>
          <Text selectable style={{ color }}>{scope !== 'library' && !queueInView ? 'Select a test song to create a controlled queue.' :
            player.state.entries.find(entry => entry.entryId === player.state?.currentEntryId)?.song.filename ?? 'No song selected'}</Text>
          <Text style={{ color }}>{player.state.status} · {duration(player.state.positionMs)} / {duration(player.state.durationMs)}</Text>
          <Text style={{ color }}>Queue: {player.state.entries.length} songs · revision {player.state.queueRevision} · event {player.state.sequence}</Text>
          {player.state.error && <Text accessibilityLiveRegion="polite" style={{ color }}>{player.state.error.message}</Text>}
          <Button title="Play / Resume" disabled={!canStart} onPress={() => void player.control({ action: 'play' })} />
          <Button title="Pause" disabled={!['playing', 'loading'].includes(player.state.status)} onPress={() => void player.control({ action: 'pause' })} />
          <Button title="Previous" disabled={!canStart} onPress={() => void player.control({ action: 'previous' })} />
          <Button title="Next" disabled={!canStart || player.state.currentEntryId === player.state.playbackOrder.at(-1)} onPress={() => void player.control({ action: 'next' })} />
          <Button title="Seek forward 10 seconds" disabled={!canStart} onPress={() => void player.control({ action: 'seek', positionMs: (player.state?.positionMs ?? 0) + 10000 })} />
          <Button title="Stop" onPress={() => void player.control({ action: 'stop' })} />
        </>}
        <Text accessibilityLiveRegion="polite" style={{ color }}>{message}</Text>
        {access?.status === 'denied' && <>
          <Text style={{ color }}>Allow access to locate audio already on your phone. No files will be changed, uploaded or deleted.</Text>
          {!settingsRequired && <Button title="Allow audio access" disabled={requesting} onPress={() => void requestAccess()} />}
          <Button title="Open system settings" onPress={() => { void Linking.openSettings().catch(() => setMessage('Could not open system settings.')); }} />
        </>}
        <Button title={busy ? 'Restart scan' : 'Refresh'} disabled={requesting} onPress={() => void refresh()} />
        {busy && <Button title="Cancel scan" onPress={() => {
          revision.current++; setBusy(false); setMessage('Scan cancelled. Previous complete results were retained.');
          if (currentScan.current) void audioDiscovery.cancelScan(currentScan.current).catch(() => {});
          currentScan.current = null;
        }} />}
        {selected && <Text selectable style={{ color }}>Selected: {selected.filename}</Text>}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.filename}, ${duration(item.durationMs)}`}
        onPress={() => { setSelected(item); void player.playList(songs, item); }} style={styles.row}>
        <Text numberOfLines={2} style={[styles.filename, { color }]}>{item.filename}</Text>
        <Text style={{ color }}>{duration(item.durationMs)}</Text>
      </Pressable>}
    />
  );
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20 }, header: { gap: 14, marginBottom: 18 },
  title: { fontSize: 26, fontWeight: '600' },
  row: { paddingVertical: 14, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#7A808A', gap: 6 },
  filename: { fontSize: 16 },
});
