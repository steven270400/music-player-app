import { requireNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';
import type { AccessState, DiscoveryPort, ScanResult } from '../../core/platform/M0Contracts';

type NativeDiscovery = {
  getAccess(): Promise<AccessState>;
  discoverAudio(scanId: string): Promise<ScanResult>;
  discoverM0Audio(scanId: string, scope: 'queue' | 'fixtures'): Promise<ScanResult>;
  cancelScan(scanId: string): void;
};
const native = () => requireNativeModule<NativeDiscovery>('MusicPlatform');
/** Development diagnostic only; the native side independently rejects non-debuggable builds. */
export const discoverM0Audio = (scanId: string, scope: 'queue' | 'fixtures') => native().discoverM0Audio(scanId, scope);
export const audioDiscovery: DiscoveryPort = {
  getAccess: () => native().getAccess(),
  discoverAudio: scanId => native().discoverAudio(scanId),
  cancelScan: async scanId => { native().cancelScan(scanId); },
};
/** Invoke only after an explicit user action on the permission explanation. */
export async function requestAudioAccess() {
  if (Platform.OS !== 'android') throw new Error('Android is required');
  return PermissionsAndroid.request(Number(Platform.Version) >= 33
    ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
}
