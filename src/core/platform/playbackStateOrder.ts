import type { PlaybackState } from './M0Contracts';

type Cursor = Pick<PlaybackState, 'sessionId' | 'sequence' | 'queueRevision'>;
export function playbackStateOrder(current: Cursor | null, next: Cursor, source: 'read' | 'event' | 'command'): 'accept' | 'ignore' | 'resync' {
  if (!Number.isSafeInteger(next.sequence) || next.sequence < 0 || !Number.isSafeInteger(next.queueRevision) || next.queueRevision < 0) return 'ignore';
  if (!current || next.sessionId !== current.sessionId) return source === 'read' ? 'accept' : 'resync';
  if (next.sequence <= current.sequence) return 'ignore';
  if (next.queueRevision < current.queueRevision) return 'resync';
  if (source === 'event' && next.sequence > current.sequence + 1) return 'resync';
  return 'accept';
}
