# Privacy and security

## Data and permissions

The app requests Android audio-read permission so it can find indexed music in shared internal storage. It reads filenames and available media metadata for library display, search, playlists, and playback. Collection operations do not edit or delete original audio files.

The app stores its library catalogue, playlists, favourites, preferences, and playback recovery state in app-private local storage. There are no accounts, backend, streaming service, ads, analytics, cloud sync, or export feature in this version. Android system media surfaces may show the current track’s ordinary metadata while playback is active.

Saved collections and settings are tied to the local app installation. Uninstalling the app, clearing app data, or losing the device can remove them. There is no supported backup or recovery promise. This does not remove the original shared audio files.

## Network behavior

The app has no remote music or metadata service. The development client uses Metro during development and may need a local network connection to the development machine. The standalone test-build workflow applies and checks a restricted permission set intended for offline playback. These development and test-build statements are not a certification of every future distribution artifact.

## Security boundaries

Audio access follows Android’s permission model and applies to media indexed and accessible to the app. Local storage is app-private, but this does not protect data on a rooted, compromised, or unlocked device, nor can the app prevent other authorized applications from changing shared audio files.

Media metadata and provider results are treated as input. Playback uses native source bindings and revalidation rather than accepting arbitrary paths or network URLs. The native module bounds metadata reading and playback recovery work; malformed media can still expose platform or decoder defects.

Do not commit real music, database files, signing keys, private device evidence, or generated APKs. The repository ignores build outputs, generated Android projects, local tools, and generated audio fixtures. Review `git status --ignored` before publishing local build artifacts or test data.

## Known limitations

- There is no user-facing backup, export, or restore mechanism.
- Device vendors and Android versions can apply different background-execution limits.
- Rooted or compromised devices and shared-storage changes by other applications are outside the security guarantees.
- This document describes the current source and build workflow; it is not a security certification or a store-policy compliance statement.
