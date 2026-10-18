import { requireNativeModule } from 'expo';
import type { MusicPlatform } from '../../core/platform/MusicPlatform';

export function getMusicPlatform(): MusicPlatform {
  return requireNativeModule<MusicPlatform>('MusicPlatform');
}
