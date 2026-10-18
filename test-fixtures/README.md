# Synthetic M0 audio

Generated on 2026-09-14 with portable FFmpeg 9.0.1 essentials. No personal audio was read or modified. The suite contains generated tones and silence only.

Run from the repository with Python 3.11+ and an explicit FFmpeg executable:

```powershell
python scripts/generate-audio-fixtures.py --ffmpeg .tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe
```

The generator refuses to overwrite an existing audio directory. Preserve/rename a previous generated suite deliberately before regeneration. It uses Python standard-library functions only; npm dependencies are unaffected. Files under audio/ and downloaded tools under .tools/ are ignored by Git and excluded from the app build.

manifest.json records filenames, codecs, channels, expected/probed durations, hashes, encoder version and host decoder results. All 16 valid fixtures were fully decoded on the desktop. All four invalid fixtures produced an expected host decoder failure. This is NOT proof that Android indexes, displays or plays them correctly.

The one-hour fixture is silence, intended for duration formatting and seeking, not a substitute for an hour of playback evidence. Duplicate filenames have different frequencies in separate folders. NFC/decomposed accented names are separate inputs for later canonical search tests. M0 does not implement full library search.

Access revocation, unavailable files and provider identity changes are runtime scenarios. Android may omit invalid files from its media index; do not assume every negative fixture will appear in Songs. An unknown duration should also be exercised by a contract-level injected result, since an ordinary valid file does not guarantee a null duration from MediaStore. Oversized metadata coverage will be expanded with the bounded metadata adapter checks.

Only the generated audio suite may be copied to the phone at the later device-validation stage. Neither tools nor personal music are bundled with the APK. Fixture transfer, ADB and device tests have not occurred.

## Tool provenance and initial error

The FFmpeg download page links to Gyan's Windows builds. The downloaded release essentials ZIP was checked against its publisher's SHA-256 before extraction. The executable hash is recorded in manifest.json; downloaded license/readme files remain with the tool. The tool is local test-data infrastructure and is not linked into or distributed in the Android app.

- https://ffmpeg.org/download.html
- https://www.gyan.dev/ffmpeg/builds/

The first attempt failed while printing a Chinese filename through Windows' CP1252 redirected stdout. Audio encoding itself had succeeded. The generator now configures stdout as UTF-8 using Python's documented TextIOWrapper.reconfigure API. The partial two-file attempt was preserved under audio-failed-console-encoding, and the complete generation succeeded after that correction. No app/tool dependency version changed.

- https://docs.python.org/3/library/io.html#io.TextIOWrapper.reconfigure
