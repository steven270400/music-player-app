import { requireNativeModule } from 'expo';
import type { PlaybackPort, PlaybackState } from '../../core/platform/M0Contracts';

type NativePlayback = Omit<PlaybackPort, 'subscribe'> & {
  addListener(event: 'playbackState', listener: (state: PlaybackState) => void): { remove(): void };
};
const native = () => requireNativeModule<NativePlayback>('MusicPlatform');
export const playback: PlaybackPort = {
  readLiveState: () => native().readLiveState(),
  replaceQueueAndPlay: command => native().replaceQueueAndPlay(command),
  playbackCommand: command => native().playbackCommand(command),
  subscribe: listener => native().addListener('playbackState', listener),
};
