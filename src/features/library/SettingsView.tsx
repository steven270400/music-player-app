import { Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Action, layout, Message, Panel } from '../../ui/Controls';
import type { Theme } from '../../ui/theme';
import type { usePreferences } from './usePreferences';
import { useState } from 'react';
export function SettingsView({ theme: t, preferences: p, granted, request }: {
  theme: Theme; preferences: ReturnType<typeof usePreferences>; granted: boolean; request: () => void;
}) {
  const [help, setHelp] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  return <ScrollView contentContainerStyle={layout.content}>
    <Text accessibilityRole="header" style={{ color: t.accent, fontSize: 13 }}>APPEARANCE</Text>
    {(['system', 'light', 'dark'] as const).map(theme => <Action key={theme} theme={t}
      label={theme[0].toUpperCase() + theme.slice(1)} role="radio" state={{ checked: p.value.theme === theme }}
      selected={p.value.theme === theme} disabled={!p.ready || p.saving}
      style={{ alignItems: 'flex-start', minHeight: 60, borderWidth: p.value.theme === theme ? 2 : 0, borderColor: t.accent }}
      onPress={() => void p.save({ ...p.value, theme })} />)}
    {!!p.error && <Message theme={t} title="Appearance could not be saved" detail={p.error} error>
      {!p.ready && <Action theme={t} label="Retry settings" onPress={() => void p.reload()} />}
    </Message>}
    <Text accessibilityRole="header" style={{ color: t.accent, fontSize: 13, marginTop: 20 }}>LIBRARY</Text>
    <Panel theme={t}><Pressable accessibilityRole="switch" accessibilityLabel="Artist subtitles" accessibilityState={{ checked: p.value.artistSubtitles, disabled: !p.ready || p.saving }}
      disabled={!p.ready || p.saving} onPress={() => void p.save({ ...p.value, artistSubtitles: !p.value.artistSubtitles })} style={[layout.row, { minHeight: 48 }]}><View style={{ flex: 1, gap: 10 }}>
      <Text style={{ color: t.text, fontSize: 17 }}>Artist subtitles</Text>
      <Text style={{ color: t.muted, fontSize: 14 }}>Show artists below filenames</Text>
    </View><View pointerEvents="none" importantForAccessibility="no-hide-descendants"><Switch value={p.value.artistSubtitles} disabled={!p.ready || p.saving}
      trackColor={{ false: t.border, true: t.accent }} /></View>
    </Pressable></Panel>
    <Panel theme={t}><Action theme={t} label="Music permission help" state={{ expanded: help }} onPress={() => setHelp(!help)} />
      {help && <View style={{ gap: 16 }}>
        <Text style={{ color: t.muted, fontSize: 16 }}>Audio access is {granted ? 'allowed' : 'not allowed'}. This app reads indexed music in internal storage. It never changes or uploads your audio files.</Text>
        {!granted && <Action theme={t} label="Allow audio access" onPress={request} primary />}
        <Action theme={t} label="Open Android settings" onPress={() => void Linking.openSettings().catch(() => setSettingsError('Open this app’s permissions from Android Settings.'))} />
        {!!settingsError && <Text accessibilityLiveRegion="polite" style={{ color: t.error }}>{settingsError}</Text>}
      </View>}
    </Panel>
  </ScrollView>;
}
