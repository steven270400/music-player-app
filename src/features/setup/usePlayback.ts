import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { DiscoveredSong, PlaybackAction, PlaybackCommand, PlaybackState } from '../../core/platform/M0Contracts';
import { playback } from '../../infrastructure/native/playback';
import { playbackStateOrder } from '../../core/platform/playbackStateOrder';
import { createPlaybackPresentation } from '../../core/platform/playbackPresentation';

let operationCounter = 0;
const operationId = () => `ui-${Date.now()}-${++operationCounter}`;

/** UI observes native state; it never advances the queue or restores playback itself. */
export function usePlayback(includeProgress = true) {
  const [store] = useState(createPlaybackPresentation);
  const state = useSyncExternalStore(includeProgress ? store.subscribe : store.subscribePresentation,
    includeProgress ? store.getFull : store.getPresentation);
  const [message, setMessage] = useState('Connecting to playback…');
  const latest = useRef<PlaybackState | null>(null);
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const syncing = useRef(false);
  const resyncAgain = useRef(false);
  const accept = useCallback((next: PlaybackState, source: 'read' | 'command' = 'command') => {
    if (!mounted.current) return;
    if (playbackStateOrder(latest.current, next, source) !== 'accept') return;
    latest.current = next; store.publish(next);
  }, [store]);
  const reconnect = useCallback(async () => {
    if (syncing.current) { resyncAgain.current = true; return; }
    syncing.current = true;
    const owner = lifetime.current;
    try {
      do {
        resyncAgain.current = false;
        const next = await playback.readLiveState();
        if (!mounted.current || owner !== lifetime.current) return;
        accept(next, 'read');
        if (mounted.current) setMessage('');
      } while (mounted.current && resyncAgain.current);
    } catch {
      if (mounted.current && owner === lifetime.current) setMessage('Playback connection unavailable. Tap Reconnect.');
    } finally { if (owner === lifetime.current) syncing.current = false; }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    const owner = ++lifetime.current;
    syncing.current = false; resyncAgain.current = false;
    let subscription: { remove(): void } | undefined;
    function observe() {
      if (subscription) return;
      try { subscription = playback.subscribe(next => {
        if (!mounted.current || owner !== lifetime.current) return;
        if (playbackStateOrder(latest.current, next, 'event') === 'resync') {
          void reconnect(); return;
        }
        accept(next);
      }); } catch { setMessage('Native playback is unavailable in this build.'); }
    }
    if (AppState.currentState === 'active') observe();
    void reconnect();
    const appState = AppState.addEventListener('change', value => {
      if (value === 'active') { observe(); void reconnect(); }
      else { subscription?.remove(); subscription = undefined; }
    });
    return () => { mounted.current = false; lifetime.current++; subscription?.remove(); appState.remove(); };
  }, [accept, reconnect]);

  const control = useCallback(async (action: PlaybackAction) => {
    const owner = lifetime.current;
    const current = latest.current;
    if (!current) return;
    try {
      const command: PlaybackCommand = { operationId: operationId(), sessionId: current.sessionId,
        expectedQueueRevision: current.queueRevision, ...action };
      const result = await playback.playbackCommand(command);
      if (!mounted.current || owner !== lifetime.current) return;
      accept(result.state);
      if (mounted.current) setMessage(result.accepted ? '' : result.error.message);
      if (result.state.sessionId !== latest.current?.sessionId) void reconnect();
    } catch { if (mounted.current && owner === lifetime.current) setMessage('Playback command failed. Reconnect to check the current state.'); }
  }, [accept, reconnect]);
  const playList = useCallback(async (songs: DiscoveredSong[], selected: DiscoveredSong) => {
    const owner = lifetime.current;
    const current = latest.current;
    if (!current) { void reconnect(); return; }
    const id = operationId();
    const entries = songs.map((song, index) => ({ entryId: `${id}-${index}`, song }));
    const selectedEntry = entries.find(entry => entry.song.songId === selected.songId);
    if (!selectedEntry) return;
    try {
      const result = await playback.replaceQueueAndPlay({ operationId: id, sessionId: current.sessionId,
        expectedQueueRevision: current.queueRevision, entries, selectedEntryId: selectedEntry.entryId });
      if (!mounted.current || owner !== lifetime.current) return;
      accept(result.state);
      if (mounted.current) setMessage(result.accepted ? '' : result.error.message);
      if (result.state.sessionId !== latest.current?.sessionId) void reconnect();
    } catch { if (mounted.current && owner === lifetime.current) setMessage('Could not submit the queue. Reconnect to check playback.'); }
  }, [accept, reconnect]);
  return { state, message, control, playList, reconnect, store };
}

export function usePlaybackProgress(player: ReturnType<typeof usePlayback>) {
  return useSyncExternalStore(player.store.subscribeProgress, player.store.getProgress);
}

export function usePlaybackQueue(store: ReturnType<typeof createPlaybackPresentation>) {
  return useSyncExternalStore(store.subscribeQueue, store.getQueue);
}
