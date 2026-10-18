import { useRef } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

/** Restore session-only scroll after a virtualized list has measured its content. */
export function useListOffset<T>(offset: number, onOffset: (value: number) => void) {
  const list = useRef<FlatList<T>>(null);
  const target = useRef(offset);
  const restoring = useRef(offset > 0);
  function restore() {
    // The first layout may be shorter than the requested offset. Reapply after
    // measurement until reached; an explicit drag always takes precedence.
    if (restoring.current) list.current?.scrollToOffset({ offset: target.current, animated: false });
  }
  return {
    reset: () => { target.current = 0; restoring.current = false; list.current?.scrollToOffset({ offset: 0, animated: false }); onOffset(0); },
    ref: list,
    onContentSizeChange: restore,
    onLayout: restore,
    onScrollBeginDrag: () => { restoring.current = false; },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      if (restoring.current && Math.abs(y - target.current) < 1) restoring.current = false;
      if (!restoring.current) onOffset(Math.max(0, y));
    },
    scrollEventThrottle: 100,
  };
}
