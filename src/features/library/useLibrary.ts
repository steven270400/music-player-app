import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { openLibrary } from '../../infrastructure/libraryDatabase';
import { audioDiscovery } from '../../infrastructure/native/audioDiscovery';
import type { AccessState } from '../../core/platform/M0Contracts';
import type { LibrarySnapshot, LibraryStore } from './libraryStore';
import { createLibraryIndex, retainLibrarySnapshot } from './libraryStore';
import { afterVisualTransition } from '../../ui/transitionWork';

export function useLibrary() {
  const [data, setData] = useState<LibrarySnapshot>({ songs: [], playlists: [] });
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [message, setMessage] = useState('Opening saved library…');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [saveError, setSaveError] = useState('');
  const mounted = useRef(false);
  const scanning = useRef(false);
  const writing = useRef(false);
  const scanId = useRef<string | null>(null);
  const deferred = useRef<(() => void) | null>(null);

  const reload = useCallback(async () => {
    const snapshot = await (await openLibrary()).read();
    if (mounted.current) { setData(previous => retainLibrarySnapshot(previous, snapshot)); setReady(true); }
  }, []);
  const refresh = useCallback(async () => {
    deferred.current?.(); deferred.current = null;
    if (scanning.current) return;
    scanning.current = true;
    if (mounted.current) { setRefreshing(true); setRefreshError(''); }
    const id = `library-${Date.now()}`;
    scanId.current = id;
    try {
      const store = await openLibrary();
      const permission = await audioDiscovery.getAccess();
      if (!mounted.current || scanId.current !== id) return;
      setAccess(permission);
      if (permission.status !== 'granted') {
        setMessage('Allow audio access to refresh and play. Your saved collections are retained.'); return;
      }
      setMessage('Refreshing library…');
      const result = await audioDiscovery.discoverAudio(id);
      if (!mounted.current || scanId.current !== id) return;
      if (result.status !== 'complete') {
        setMessage(result.error.message);
        if (result.status === 'failed') setRefreshError(result.error.message);
        if (result.error.code === 'ACCESS_REQUIRED') setAccess({ ...permission, status: 'denied' });
        return;
      }
      await store.saveScan(result, async () => {
        const current = await audioDiscovery.getAccess();
        return mounted.current && scanId.current === id && current.status === 'granted' && current.generation === result.accessGeneration;
      });
      await reload();
      if (mounted.current) setMessage(result.songs.length ? `${result.songs.length} songs · library saved` : 'No indexed audio found in internal storage. Add music, then refresh.');
    } catch {
      if (mounted.current && scanId.current === id) {
        setMessage('Refresh could not be saved. Your previous library is retained. Try again.');
        setRefreshError('Refresh failed. Your previous library is retained. Try again.');
      }
    } finally {
      scanning.current = false;
      if (scanId.current === id) scanId.current = null;
      if (mounted.current) setRefreshing(false);
    }
  }, [reload]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false, permissionRequest = 0;
    async function resume() {
      const request = ++permissionRequest;
      deferred.current?.(); deferred.current = null;
      try {
        const permission = await audioDiscovery.getAccess();
        if (disposed || request !== permissionRequest || AppState.currentState !== 'active') return;
        setAccess(permission);
        if (permission.status === 'granted') deferred.current = afterVisualTransition(() => { if (!disposed) void refresh(); });
      } catch { if (!disposed) setRefreshError('Could not check audio access. Retry refresh.'); }
    }
    void reload().then(resume).catch(() => {
      if (mounted.current) { setMessage('Could not open the saved library. Retry without clearing app data.'); setRefreshError('Could not open the saved library. Retry without clearing app data.'); }
    });
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void resume();
      else { permissionRequest++; deferred.current?.(); deferred.current = null; }
    });
    return () => {
      mounted.current = false;
      disposed = true; deferred.current?.(); deferred.current = null;
      if (scanId.current) void audioDiscovery.cancelScan(scanId.current).catch(() => {});
      scanId.current = null;
      listener.remove();
    };
  }, [reload, refresh]);

  async function save(action: (store: LibraryStore) => Promise<void>) {
    if (writing.current) return false;
    writing.current = true; setSaving(true); setSaveError('');
    let committed = false;
    try {
      await action(await openLibrary());
      committed = true;
      await reload();
      if (mounted.current) setMessage('Changes saved.');
      return true;
    } catch (error) {
      if (mounted.current) {
        const message = committed ? 'Saved, but the display could not reload. Refresh to see the change.' :
          error instanceof Error && !/sqlite|database|native/i.test(error.message) ? error.message : 'Could not save. Previous saved data retained. Try again.';
        setMessage(message); setSaveError(message);
      }
      return committed;
    } finally {
      writing.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function cancelRefresh() {
    if (scanId.current) void audioDiscovery.cancelScan(scanId.current).catch(() => {});
    scanId.current = null;
    setMessage('Refresh cancelled. Saved library retained.');
  }
  const index = useMemo(() => createLibraryIndex(data), [data]);
  return { data, index, ready, access, message, refreshError, saveError, refreshing, saving, refresh, cancelRefresh, save, clearSaveError: () => setSaveError('') };
}
