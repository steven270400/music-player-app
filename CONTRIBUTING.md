# Contributing

Thanks for taking an interest in Music Player App. Before changing code, read the [architecture and system design](docs/architecture-and-system-design.md), [development and testing guide](docs/development-and-testing.md), and [privacy and security notes](docs/privacy-and-security.md).

## Local setup

The supported Android build path is Windows. Install the pinned toolchain described in [`build-toolchain.json`](build-toolchain.json), then follow the dependency and environment steps in [Development and testing](docs/development-and-testing.md).

## Changes

- Keep Android-specific behavior in the local Kotlin module or configuration plugins, not generated Android project files.
- Preserve the ownership boundary between SQLite collections and the native playback service.
- Do not use arbitrary paths or network URLs as audio sources.
- Keep source changes inside the directories included by the build workflow. If adding a new build input or root configuration, update the workflow allowlist and its tests deliberately.
- Use synthetic audio fixtures for tests. Do not commit personal music, app databases, signing material, APKs, or private device logs.
- Update user and architecture documentation when visible behavior, data ownership, permissions, or build instructions change.

## Checks before a change is ready

Run the relevant commands from the [development guide](docs/development-and-testing.md): TypeScript checking, the build-workflow tests, and the host regression tests. For Android or native-module changes, also run the Windows build workflow so the generated project, native unit tests, JavaScript bundle, and APK metadata are checked.

Device behavior must be described as device-tested only when a physical Android run was performed. Host tests and successful compilation are not evidence of background playback, permission prompts, or media-session behavior.

## Pull requests

Explain the behavior changed, the checks run, and any remaining limitations. Include screenshots only when they use synthetic media and contain no personal notifications, account details, file paths, or private device data. Keep claims about release readiness and Android compatibility aligned with the evidence in the repository documentation.
