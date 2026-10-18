import type { ReactNode } from 'react';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View, type AccessibilityRole, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';
import type { Theme } from './theme';

const icons = {
  note: [require('../../assets/circuit/note.png'), 19, 21],
  list: [require('../../assets/circuit/list.png'), 20, 14],
  heart: [require('../../assets/circuit/heart.png'), 23, 20],
  heartFilled: [require('../../assets/circuit/heartFilled.png'), 23, 20],
  settings: [require('../../assets/circuit/settings.png'), 20, 20],
  search: [require('../../assets/circuit/search.png'), 19, 19],
  refresh: [require('../../assets/circuit/refresh.png'), 18, 20],
  pause: [require('../../assets/circuit/pause.png'), 10, 16],
  play: [require('../../assets/circuit/play.png'), 13, 16],
  previous: [require('../../assets/circuit/previous.png'), 16, 16],
  next: [require('../../assets/circuit/next.png'), 16, 16],
  shuffle: [require('../../assets/circuit/shuffle.png'), 20, 22],
  repeat: [require('../../assets/circuit/repeat.png'), 20, 22],
  back: [require('../../assets/circuit/back.png'), 9, 16],
  plus: [require('../../assets/circuit/plus.png'), 18, 18],
  down: [require('../../assets/circuit/down.png'), 14, 8],
  up: [require('../../assets/circuit/up.png'), 14, 8],
  more: [require('../../assets/circuit/more.png'), 4, 18],
  close: [require('../../assets/circuit/close.png'), 14, 14],
  check: [require('../../assets/circuit/check.png'), 16, 12],
  box: [require('../../assets/circuit/box.png'), 18, 18],
} as const;
export type IconName = keyof typeof icons;
export function Icon({ name, color }: { name: IconName; color: string }) {
  const [source, width, height] = icons[name];
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.icon}>
    <Image source={source} style={{ width, height, tintColor: color }} resizeMode="contain" />
  </View>;
}
export function Action({ theme: t, label, icon, onPress, disabled, selected, caption, primary, style, role = 'button', state }: {
  theme: Theme; label: string; icon?: IconName; onPress: () => void; disabled?: boolean; selected?: boolean;
  caption?: string; primary?: boolean; style?: StyleProp<ViewStyle>; role?: AccessibilityRole; state?: AccessibilityState;
}) {
  const color = primary ? t.onAccent : selected ? t.accent : t.text;
  return <Pressable accessibilityRole={role} accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled, ...(selected !== undefined ? { selected } : {}), ...state }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action,
      !icon && { paddingHorizontal: 18, backgroundColor: primary ? t.accent : t.surface, borderColor: t.border, borderWidth: primary ? 0 : 1, borderRadius: 4 },
      primary && { backgroundColor: t.accent }, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }, style]}>
    {icon ? <Icon name={icon} color={color} /> : <Text style={[s.buttonText, { color }]}>{label}</Text>}
    {role === 'radio' && selected && <Text style={{ color, fontSize: 13 }}>Selected</Text>}
    {!!caption && <Text style={{ color, fontSize: 13, textAlign: 'center', flexShrink: 1, fontWeight: selected ? '700' : '400', textDecorationLine: role === 'tab' && selected ? 'underline' : 'none' }}>{caption}</Text>}
  </Pressable>;
}
export function CircuitRule({ theme: t }: { theme: Theme }) {
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.rule}>
    <Image source={t.dark ? require('../../assets/circuit/headerDark.png') : require('../../assets/circuit/headerLight.png')}
      style={{ width: '100%', height: 15 }} resizeMode="stretch" />
    <Image source={t.dark ? require('../../assets/circuit/accentDark.png') : require('../../assets/circuit/accentLight.png')}
      style={{ position: 'absolute', left: 0, top: 0, width: 50, height: 16 }} />
  </View>;
}
export function Header({ theme: t, title, back, children }: { theme: Theme; title: string; back?: () => void; children?: ReactNode }) {
  return <View><CircuitRule theme={t} /><View style={s.header}>
    {back && <Action theme={t} label="Back" icon="back" onPress={back} />}
    <Text accessibilityRole="header" style={[s.title, { color: t.text }]}>{title}</Text>{children}
  </View></View>;
}
export function Panel({ theme: t, children, style }: { theme: Theme; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return <View style={[s.panel, style]} onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(current => current.width === width && current.height === height ? current : { width, height }); }}>
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }} importantForAccessibility="no-hide-descendants">
      <Image accessible={false} source={t.dark ? require('../../assets/circuit/panelDark.png') : require('../../assets/circuit/panelLight.png')}
        style={{ width: size.width, height: size.height }} resizeMode="stretch" />
    </View>
    {children}
  </View>;
}
export function Message({ theme: t, title, detail, children, error = false }: {
  theme: Theme; title: string; detail?: string; children?: ReactNode; error?: boolean;
}) {
  return <View style={s.message}>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ color: error ? t.error : t.text, fontSize: 21 }}>{title}</Text>
    {!!detail && <Text style={{ color: t.muted, fontSize: 16, lineHeight: 24 }}>{detail}</Text>}
    {children}
  </View>;
}
export function SearchField({ theme: t, value, onChange, label = 'Search songs' }: {
  theme: Theme; value: string; onChange: (value: string) => void; label?: string;
}) {
  return <View style={[s.search, { borderColor: t.border, backgroundColor: t.surface }]}>
    <Icon name="search" color={t.muted} />
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder="Search filename, title or artist"
      placeholderTextColor={t.muted} style={{ flex: 1, color: t.text, fontSize: 16, minHeight: 48 }} autoCorrect={false} />
    {!!value && <Action theme={t} label="Clear search" icon="close" onPress={() => onChange('')} />}
  </View>;
}
export const layout = StyleSheet.create({
  fill: { flex: 1 }, content: { padding: 24, gap: 16 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  muted: { fontSize: 14 },
});
const s = StyleSheet.create({
  icon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  action: { minWidth: 48, minHeight: 48, padding: 10, gap: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  buttonText: { fontSize: 15, textAlign: 'center' },
  rule: { marginHorizontal: 12, marginTop: 16, marginBottom: 8, height: 16 },
  header: { paddingHorizontal: 24, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontSize: 28, flex: 1, paddingVertical: 8 },
  panel: { padding: 20, minHeight: 72, gap: 8 },
  message: { padding: 24, gap: 16 },
  search: { marginHorizontal: 24, borderWidth: 1, borderRadius: 4, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
