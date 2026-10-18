# Development and testing

## Supported build environment

The repository’s Android build workflow currently supports Windows only. Use the exact tool versions in [`build-toolchain.json`](../build-toolchain.json): Node.js 24.14.1, npm 11.11.0, Java 21, and the listed Android SDK packages. Android Studio’s bundled Java is used by default. Set `MUSIC_JAVA_HOME` or `ANDROID_HOME` only when using a different valid installation.

The app targets Android 12 (API 31) or newer. Builds produce the `arm64-v8a` architecture. This workflow is not a Linux/macOS CI setup or a store-release pipeline.

## Install dependencies and check the environment

From the repository root in PowerShell:

```powershell
npm ci
npm run build:check
```

`npm ci` installs the committed lockfile exactly. `build:check` checks the build prerequisites without compiling the app.

## Build Android

```powershell
npm run build:android
```

The workflow synchronizes approved source files into a managed short-path workspace, validates dependencies, type-checks, runs host regression tests, bundles JavaScript, runs the native unit-test task, compiles a debug APK, and inspects its metadata. It does not install the APK or connect to a device. Reports and build outputs are placed under `artifacts/`, which is ignored by Git.

The debug APK requires the Expo development client and a running Metro server. Start Metro with:

```powershell
npm start
```

The compile command does not configure a phone or emulator. Device installation and playback validation require a separately configured Android device.

### Standalone local test build

```powershell
npm run build:android -- --standalone
```

This produces a locally signed test APK with the JavaScript bundle included. It is not production-signed, is not a public release, and must not be presented as a store-ready artifact. The workflow checks the generated APK for expected permissions, embedded JavaScript, signing, and absence of development-client registration.

## Tests

Run the checks from the repository root:

```powershell
npm run typecheck
npm run test:build
node --test scripts/playback-state-order.test.mjs scripts/library.test.mjs scripts/ui-format.test.mjs scripts/player-motion.test.mjs scripts/ui-performance.test.mjs
```

The first command runs TypeScript without emitting files. `test:build` covers the build workflow’s path safety, synchronization, locking, and artifact rules. The explicit Node test command covers library, playback-order, formatting, motion, and presentation-performance logic. The full Android build also runs the `:music-platform:testDebugUnitTest` native test task.

Host tests do not replace Android behavior tests. They cannot prove MediaStore access, audio focus, notification controls, long-duration playback, or device-specific background behavior.

## Validation summary and open work

The current source has passed the repository’s host and native test suites, Windows Android build gates, standalone artifact checks, and selected on-device personal-use scenarios. Performance and cross-feature regression checks also passed on the tested device configurations. This is targeted evidence, not a guarantee across all Android devices.

The two-hour playback soak and matched battery comparison remain deferred. Full TalkBack review, broader device and extreme text-size coverage, controlled database/preference failure injection, and attribution of recurring background frame callbacks remain open. Historical background CPU exits have no confirmed cause; no claim is made that they are resolved.

The detailed local session logs and raw device evidence are intentionally not included in this repository. This summary retains their outcomes and evidence limits without personal device identifiers or local paths.
