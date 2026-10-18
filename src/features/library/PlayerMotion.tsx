import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Text, View, useWindowDimensions } from 'react-native';
import type { Theme } from '../../ui/theme';
import { marqueeMetrics } from './playerMotionMath';

const MotionContext = createContext({ reduced: true, ready: false, visible: false });
const ReducedMotionContext = createContext(true);
export const useMotionSettings = () => useContext(MotionContext);
export const useReducedMotion = () => useContext(ReducedMotionContext);
export function MotionProvider({ children }: { children: ReactNode }) {
  const settings = useSystemMotionSettings();
  // Library lists need only the accessibility preference, not foreground/focus ticks.
  return <ReducedMotionContext.Provider value={settings.reduced}>
    <MotionContext.Provider value={settings}>{children}</MotionContext.Provider>
  </ReducedMotionContext.Provider>;
}
function useSystemMotionSettings() {
  const [reduced, setReduced] = useState(true);
  const [ready, setReady] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    let disposed = false;
    let eventReceived = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      eventReceived = true; setReduced(value); setReady(true);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!disposed && !eventReceived) { setReduced(value); setReady(true); }
    }, () => { if (!disposed) setReady(true); });
    const state = AppState.addEventListener('change', value => setForeground(value === 'active'));
    const blur = AppState.addEventListener('blur', () => setFocused(false));
    const focus = AppState.addEventListener('focus', () => setFocused(true));
    return () => { disposed = true; motion.remove(); state.remove(); blur.remove(); focus.remove(); };
  }, []);
  return { reduced, ready, visible: foreground && focused };
}

/** Native-driven repeating phase. Stopping reads the actual native value, so
 * pause/resume and a queue resize cannot restart the disc or title. */
export function usePlaybackCycle(running: boolean, period: number, resetKey: string) {
  const phase = useRef(new Animated.Value(0)).current;
  const previousKey = useRef(resetKey);
  useEffect(() => {
    let disposed = false;
    const reset = previousKey.current !== resetKey;
    previousKey.current = resetKey;
    function run(from: number) {
      Animated.timing(phase, { toValue: 1, duration: Math.max(1, period * (1 - from)),
        easing: Easing.linear, useNativeDriver: true, isInteraction: false }).start(({ finished }) => {
        if (finished && !disposed) { phase.setValue(0); run(0); }
      });
    }
    phase.stopAnimation(current => {
      if (disposed) return;
      const from = reset ? 0 : Math.max(0, Math.min(1, current));
      phase.setValue(from);
      if (running) run(from);
    });
    return () => { disposed = true; phase.stopAnimation(); };
  }, [phase, running, period, resetKey]);
  return phase;
}

export function Filename({ name, playing, reduced, theme: t }: {
  name: string; playing: boolean; reduced: boolean; theme: Theme;
}) {
  const { fontScale } = useWindowDimensions();
  const [viewport, setViewport] = useState(0);
  const [measurement, setMeasurement] = useState({ key: '', width: 0, height: 0 });
  const key = `${name}:${fontScale}`;
  const measured = measurement.key === key;
  const metrics = marqueeMetrics(measured ? measurement.width : 0, viewport);
  const phase = usePlaybackCycle(playing && !reduced && metrics.overflow, metrics.duration, `${key}:${viewport}:${measurement.width}`);
  const textStyle = { color: t.text, fontSize: 22, lineHeight: 28, fontWeight: '600' as const };
  const moving = measured && metrics.overflow && !reduced;
  return <View accessible accessibilityLabel={name} accessibilityRole="text"
    onLayout={e => setViewport(e.nativeEvent.layout.width)} style={{ overflow: 'hidden' }}>
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      <Text key={key} numberOfLines={1} style={[textStyle, { position: 'absolute', width: 100000, opacity: 0 }]}
        onTextLayout={e => { const line = e.nativeEvent.lines[0]; if (line) setMeasurement(previous => previous.key === key && previous.width === line.width && previous.height === line.height ? previous : { key, width: line.width, height: line.height }); }}>{name}</Text>
      {moving ? <View style={{ height: Math.max(28 * fontScale, measurement.height) }}>
        <Animated.View style={{ flexDirection: 'row', width: metrics.distance * 2,
          transform: [{ translateX: phase.interpolate({ inputRange: [0, metrics.dwellFraction, 1], outputRange: [0, 0, -metrics.distance] }) }] }}>
          {[0, 1].map(copy => <Text key={copy} numberOfLines={1} style={[textStyle, { width: metrics.distance, paddingRight: 40 }]}>{name}</Text>)}
        </Animated.View>
      </View> : <Text numberOfLines={1} ellipsizeMode="tail" style={textStyle}>{name}</Text>}
    </View>
  </View>;
}
