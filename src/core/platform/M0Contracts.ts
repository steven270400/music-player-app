/** Contract version 1. Native methods return plain bridge-safe data, never platform handles. */
export const M0_CONTRACT_VERSION = 1 as const;

export type AccessState = {
  status: 'granted' | 'denied';
  androidApi: number;
  /** Changes when native code observes access changes; never infer access from a cached scan. */
  generation: number;
};

export interface SourceBinding {
  volume: 'external_primary';
  providerVersion: string;
  /** Decimal strings preserve Android's 64-bit IDs/generations across the JavaScript boundary. */
  rowId: string;
  generationAdded: string;
}

export interface DiscoveredSong {
  songId: string;
  binding: SourceBinding;
  filename: string;
  durationMs: number | null;
  artist: string | null;
  title: string | null;
}

export type PlatformErrorCode =
  | 'ACCESS_REQUIRED' | 'SOURCE_UNAVAILABLE' | 'PROVIDER_CHANGED'
  | 'SCAN_FAILED' | 'CANCELLED' | 'INVALID_COMMAND' | 'STALE_COMMAND'
  | 'LOAD_FAILED' | 'QUEUE_EXHAUSTED' | 'RECOVERY_INVALID'
  | 'RECOVERY_WRITE_FAILED' | 'SERVICE_UNAVAILABLE' | 'FOCUS_UNAVAILABLE';

export interface PlatformError {
  code: PlatformErrorCode;
  /** Safe fixed text. Do not include raw Android exceptions, filenames or URIs. */
  message: string;
  retryable: boolean;
}

export type ScanResult = {
  scanId: string;
  accessGeneration: number;
} & (
  | { status: 'complete'; songs: DiscoveredSong[]; providerVersion: string }
  | { status: 'failed' | 'cancelled'; error: PlatformError }
);

export interface DiscoveryPort {
  getAccess(): Promise<AccessState>;
  /** Native implementation enumerates off the UI thread; only complete snapshots are returned. */
  discoverAudio(scanId: string): Promise<ScanResult>;
  cancelScan(scanId: string): Promise<void>;
}

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type RepeatMode = 'off' | 'one' | 'all';

export interface QueueEntry {
  entryId: string;
  song: DiscoveredSong;
}

export interface PlaybackState {
  contractVersion: typeof M0_CONTRACT_VERSION;
  sessionId: string;
  queueRevision: number;
  sequence: number;
  status: PlaybackStatus;
  entries: QueueEntry[];
  originalOrder: string[];
  playbackOrder: string[];
  currentEntryId: string | null;
  positionMs: number;
  durationMs: number | null;
  repeat: RepeatMode;
  shuffle: boolean;
  error: PlatformError | null;
}

export type CommandResult =
  | { operationId: string; accepted: true; state: PlaybackState }
  | { operationId: string; accepted: false; error: PlatformError; state: PlaybackState };

export interface ReplaceQueueCommand {
  operationId: string;
  sessionId: string;
  expectedQueueRevision: number;
  entries: QueueEntry[];
  selectedEntryId: string;
}

export type PlaybackCommand = {
  operationId: string;
  sessionId: string;
  expectedQueueRevision: number;
} & PlaybackAction;

export type PlaybackAction =
  | { action: 'play' | 'pause' | 'stop' | 'previous' | 'next' }
  | { action: 'seek'; positionMs: number }
  | { action: 'select'; entryId: string }
  | { action: 'setRepeat'; repeat: RepeatMode }
  | { action: 'setShuffle'; shuffle: boolean }
;

export interface PlaybackPort {
  readLiveState(): Promise<PlaybackState>;
  replaceQueueAndPlay(command: ReplaceQueueCommand): Promise<CommandResult>;
  playbackCommand(command: PlaybackCommand): Promise<CommandResult>;
  /** Remove subscriptions on unmount; gaps/reconnects require readLiveState, not recovery restore. */
  subscribe(listener: (state: PlaybackState) => void): { remove(): void };
}

/** Native-owned disk contract only. JavaScript must not read/write this snapshot. */
export interface RecoverySnapshotV1 {
  version: 1;
  entries: QueueEntry[];
  originalOrder: string[];
  playbackOrder: string[];
  currentEntryId: string;
  positionMs: number;
  repeat: RepeatMode;
  shuffle: boolean;
  ended: boolean;
}
