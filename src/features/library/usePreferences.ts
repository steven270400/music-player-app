import { useEffect, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { openLibrary } from '../../infrastructure/libraryDatabase';
import { defaultPreferences, type Preferences } from './libraryStore';

export function usePreferences() {
  const system = useColorScheme();
  const [value, setValue] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(false);
  async function load() {
    try {
      const saved = await (await openLibrary()).readPreferences();
      if (mounted.current) { setValue(saved); setReady(true); setError(''); }
    } catch { if (mounted.current) setError('Could not load appearance. Retry without clearing app data.'); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  async function save(next: Preferences) {
    if (busy.current || !ready) return;
    busy.current = true; setSaving(true);
    try {
      await (await openLibrary()).savePreferences(next);
      if (mounted.current) { setValue(next); setError(''); }
    } catch { if (mounted.current) setError('Could not save appearance. Your previous setting is retained. Try again.'); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  }
  return { value, ready, saving, error, save, reload: load,
    dark: value.theme === 'dark' || (value.theme === 'system' && system === 'dark') };
}
