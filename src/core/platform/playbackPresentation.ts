import type { PlaybackState } from './M0Contracts';

type Listener = () => void;
type Progress = Pick<PlaybackState, 'sessionId' | 'queueRevision' | 'currentEntryId' | 'positionMs' | 'durationMs'>;
type Queue = Pick<PlaybackState, 'sessionId' | 'queueRevision' | 'entries' | 'playbackOrder' | 'currentEntryId' | 'shuffle'>;
const equal = <T extends object>(a: T | null, b: T) => a !== null && Object.keys(b).every(key => Object.is(a[key as keyof T], b[key as keyof T]));

/** Accepted native snapshots only. Presentation snapshots are never command authority. */
export function createPlaybackPresentation() {
  let full: PlaybackState | null = null, presentation: PlaybackState | null = null;
  let progress: Progress | null = null, queue: Queue | null = null;
  const all = new Set<Listener>(), display = new Set<Listener>(), clocks = new Set<Listener>(), queues = new Set<Listener>();
  const subscribe = (listeners: Set<Listener>) => (listener: Listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const notify = (listeners: Set<Listener>) => listeners.forEach(listener => listener());
  return {
    getFull: () => full, getPresentation: () => presentation, getProgress: () => progress, getQueue: () => queue,
    subscribe: subscribe(all), subscribePresentation: subscribe(display), subscribeProgress: subscribe(clocks), subscribeQueue: subscribe(queues),
    publish(next: PlaybackState) {
      const sameQueue = full?.sessionId === next.sessionId && full.queueRevision === next.queueRevision;
      const sameError = full?.error?.code === next.error?.code && full?.error?.message === next.error?.message && full?.error?.retryable === next.error?.retryable;
      const state = { ...next, ...(sameQueue && full ? { entries: full.entries, originalOrder: full.originalOrder, playbackOrder: full.playbackOrder } : {}),
        error: sameError ? full?.error ?? null : next.error };
      const nextProgress = { sessionId: state.sessionId, queueRevision: state.queueRevision, currentEntryId: state.currentEntryId, positionMs: state.positionMs, durationMs: state.durationMs };
      const nextQueue = { sessionId: state.sessionId, queueRevision: state.queueRevision, entries: state.entries, playbackOrder: state.playbackOrder, currentEntryId: state.currentEntryId, shuffle: state.shuffle };
      const displayChanged = !presentation || !sameQueue || presentation.currentEntryId !== state.currentEntryId || presentation.status !== state.status ||
        presentation.repeat !== state.repeat || presentation.shuffle !== state.shuffle || presentation.error !== state.error;
      const progressChanged = !equal(progress, nextProgress), queueChanged = !equal(queue, nextQueue);
      full = state;
      if (displayChanged) presentation = state;
      if (progressChanged) progress = nextProgress;
      if (queueChanged) queue = nextQueue;
      // Publish all snapshots before notifying, so independent consumers see one state.
      notify(all); if (displayChanged) notify(display); if (progressChanged) notify(clocks); if (queueChanged) notify(queues);
    },
  };
}
