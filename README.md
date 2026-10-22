# Music Player App

An Android music player for audio already indexed on your device. The app is built with React Native and Expo, with a small Kotlin module for Android media discovery and background playback.

This repository is the first source baseline for version **1.0.0**. It is a portfolio and personal-use project. There is no public APK or production release; the build workflow currently produces local development and test builds.

## What it does

- Finds audio indexed in Android shared internal storage and lets you search by filename, title, or artist.
- Plays selected songs in a queue, with previous/next, seeking, shuffle, and repeat controls.
- Saves playlists, favourites, and appearance preferences locally.
- Supports Light, Dark, and System appearance, with optional artist subtitles.
- Provides Android media-session controls for background playback.

The app does not include accounts, streaming, cloud sync, ads, or analytics. It does not change or upload audio files. See [Privacy and security](docs/privacy-and-security.md) for the data and permission details.

## Build from source

The supported Android build workflow runs on Windows. It requires the pinned Node.js and npm versions, Java 21, and the Android SDK components listed in [`build-toolchain.json`](build-toolchain.json). The build script checks these requirements.

```powershell
git clone https://github.com/steven270400/music-player-app.git
cd music-player-app
npm ci
npm run build:check
npm run build:android
```

`npm run build:android` compiles a debug APK and runs the project’s host and native checks. It does not install the APK or start an Android device. The debug app needs the Metro development server to run. Build output is written under the ignored `artifacts/` directory.

For test and development details, see [Development and testing](docs/development-and-testing.md). To understand the screens and controls, see the [User guide](docs/user-guide.md).

## Project status

The app implements the approved personal-use feature set, and the current source has build and device-validation evidence. Some validation remains incomplete, including longer playback and battery comparisons, broader device coverage, and full TalkBack review. Background callback attribution also remains under investigation. See [Development and testing](docs/development-and-testing.md) for the evidence boundaries and open limitations.

The optional standalone build is a locally signed test artifact. It is not a production release and is not offered for download from this repository.

## Project guides

- [User guide](docs/user-guide.md)
- [Architecture and system design](docs/architecture-and-system-design.md)
- [Development and testing](docs/development-and-testing.md)
- [Privacy and security](docs/privacy-and-security.md)
- [Contributing](CONTRIBUTING.md)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

## Preview App
<img width="1312" height="1199" alt="graphite_circuit_reference" src="https://github.com/user-attachments/assets/17ec15be-be2e-45f5-80da-a9476af2f8e4" /><img width="412" height="800" alt="vinyl-paused" src="https://github.com/user-attachments/assets/d77f8183-ed9d-4022-bf39-b1418be8d36c" />

