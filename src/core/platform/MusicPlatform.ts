export interface FoundationInfo {
  androidApi: number;
  storageVolume: string;
  contractVersion: number;
}

export interface MusicPlatform {
  getFoundationInfo(): FoundationInfo;
}
