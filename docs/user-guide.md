# User guide

This guide describes the app as it exists in this repository. There is no public installer or APK. Running it requires building the Android project from source; see [Development and testing](development-and-testing.md).

## First launch and music access

The app asks for audio access when you choose to allow it. Android may show different permission wording depending on its version. Granting access lets the app read indexed audio in shared internal storage. The app does not edit, move, or upload your music.

The library refreshes when the app opens and can be refreshed from **Songs**. A refresh that fails keeps the previously saved library. If access is denied or later revoked, use **Settings → Music permission help** to review access or open Android Settings.

Only audio that Android has indexed appears in the library. If a file does not appear, confirm that it is in a location scanned by Android and then refresh. The app does not provide a folder picker or SD-card library support.

## Browse and search

The bottom navigation opens **Songs**, **Playlists**, **Now playing**, **Favourites**, and **Settings**. Songs are sorted by filename. Search matches filename, title, and artist text. Search state and list position are kept while switching between app sections during the session.

Tap a song to start playback. The visible, filtered song list becomes the new queue, with the selected song as the current entry. Later searches, library refreshes, or playlist edits do not silently replace the active queue.

## Playback

The compact player opens **Now playing**. Use Play/Pause, Previous, Next, and the seek bar to control playback. The queue shows its actual playback order; selecting an entry starts that song. Queue changes are made by choosing a new song list, not by editing the active queue.

Shuffle and Repeat (Off, One, All) are available in the player. Previous restarts the current song when it is more than three seconds in; otherwise it moves to the previous entry when one exists. At the end of a non-repeating queue, Next is unavailable. Pressing Play on an ended song starts that song again.

Playback is owned by the Android media service, so leaving the player screen does not itself stop playback. Android’s notification and connected media controls use the same playback service.

## Playlists and favourites

Create a playlist and give it a non-empty name that is unique without regard to letter case. Open a playlist to play its songs, search within it, add available songs, reorder entries, rename it, or delete it. Playlist changes are saved explicitly; cancelling an edit leaves the saved playlist unchanged. Deleting a playlist does not delete audio files or favourites.

Tap a song’s heart to add or remove it from Favourites. Removing a favourite briefly offers Undo. Favourites and playlists are stored on the device.

## Settings and saved data

Choose System, Light, or Dark appearance. **Artist subtitles** controls whether artist names appear under song filenames in lists.

The library, playlists, favourites, and preferences are stored in the app’s private local database. There is no export, cloud backup, or restore feature. Uninstalling the app, clearing its data, or losing the device can remove those saved collections and settings. Original audio files remain in their existing storage locations.

## Known limitations

- Android only; Android 12 (API 31) or newer is required.
- The app uses Android’s indexed media collection and does not browse folders or removable SD cards.
- No public release build is available from this repository.
- TalkBack and a broad range of devices and text sizes have not received complete review.
- Android background restrictions and device-specific playback behavior can vary.
