"""Create synthetic M0 audio only. Never reads or edits the user's music."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]


def run(command):
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(f"Tool failed ({result.returncode}): {result.stderr[-3000:]}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True, type=Path)
    args = parser.parse_args()
    encoder = args.ffmpeg.resolve()
    probe = encoder.with_name("ffprobe.exe")
    output = ROOT / "test-fixtures" / "audio"
    # Refuse to overwrite a previous suite: a failed/new attempt must use deliberate recovery.
    output.mkdir(parents=True, exist_ok=False)
    cases = [
        ("queue/01 English 440Hz.mp3", "libmp3lame", "mp3", ["-b:a", "128k"], 440, 12, 2, True),
        ("queue/02 简体中文 550Hz.mp3", "libmp3lame", "mp3", ["-q:a", "3"], 550, 12, 2, False),
        ("queue/03 繁體中文 660Hz.m4a", "aac", "aac", ["-b:a", "128k"], 660, 12, 2, True),
        ("formats/Mixed 英文中文.aac", "aac", "aac", ["-b:a", "128k", "-f", "adts"], 770, 8, 2, False),
        ("formats/Mono.flac", "flac", "flac", [], 330, 8, 1, True),
        ("formats/Stereo.flac", "flac", "flac", [], 385, 8, 2, False),
        ("formats/PCM mono.wav", "pcm_s16le", "pcm_s16le", [], 220, 8, 1, False),
        ("formats/PCM stereo.wav", "pcm_s16le", "pcm_s16le", [], 275, 8, 2, True),
        ("formats/Vorbis.ogg", "libvorbis", "vorbis", ["-q:a", "4"], 880, 8, 2, True),
        ("formats/Opus.ogg", "libopus", "opus", ["-b:a", "96k"], 990, 8, 2, False),
        ("names/Café 音乐 🎵.mp3", "libmp3lame", "mp3", ["-b:a", "128k"], 440, 8, 2, True),
        ("names/Cafe\u0301 音乐 🎵.mp3", "libmp3lame", "mp3", ["-b:a", "128k"], 550, 8, 2, True),
        ("names/" + "Long filename 很长的音乐文件名 " * 6 + ".mp3", "libmp3lame", "mp3", ["-b:a", "128k"], 660, 8, 2, False),
        ("duplicates/a/Same name 同名.mp3", "libmp3lame", "mp3", ["-b:a", "128k"], 440, 8, 2, False),
        ("duplicates/b/Same name 同名.mp3", "libmp3lame", "mp3", ["-b:a", "128k"], 660, 8, 2, False),
        ("duration/One hour silence.flac", "flac", "flac", [], 0, 3601, 1, False),
    ]
    manifest = {"schemaVersion": 1, "syntheticOnly": True,
                "generator": "scripts/generate-audio-fixtures.py",
                "encoderVersion": run([str(encoder), "-version"]).splitlines()[0],
                "encoderSha256": hashlib.sha256(encoder.read_bytes()).hexdigest(),
                "androidValidation": "NOT RUN", "files": []}
    for relative, codec, expected_codec, options, frequency, duration, channels, artist in cases:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        signal = f"sine=frequency={frequency}:sample_rate=44100:duration={duration}" if frequency else "anullsrc=r=44100:cl=mono"
        command = [str(encoder), "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", signal,
                   "-t", str(duration), "-ac", str(channels), "-map_metadata", "-1", "-c:a", codec, *options]
        if artist:
            command += ["-metadata", "artist=M0 Synthetic Artist 测试", "-metadata", "title=Synthetic tone"]
        command += [str(destination)]
        run(command)
        metadata = json.loads(run([str(probe), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(destination)]))
        streams = metadata["streams"]
        if len(streams) != 1 or streams[0]["codec_type"] != "audio" or streams[0]["codec_name"] != expected_codec:
            raise RuntimeError("Unexpected encoded stream: " + relative)
        actual_duration = float(metadata["format"]["duration"])
        if abs(actual_duration - duration) > 0.3:
            raise RuntimeError("Unexpected duration: " + relative)
        run([str(encoder), "-nostdin", "-v", "error", "-xerror", "-i", str(destination), "-f", "null", "-"])
        manifest["files"].append({"path": relative, "valid": True, "frequencyHz": frequency,
                                  "requestedDurationMs": duration * 1000, "probedDurationMs": round(actual_duration * 1000),
                                  "codec": expected_codec, "channels": channels, "artistPresent": artist,
                                  "encoderOptions": options, "hostDecode": "PASS",
                                  "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                                  "bytes": destination.stat().st_size})
        print("Verified:", relative, flush=True)
    invalid = {
        "invalid/Not audio.mp3": b"M0 deliberately invalid synthetic fixture\n",
        "invalid/Empty.wav": b"",
        "invalid/Truncated header.flac": b"fLaC\x00\x00\x00\x22\x00",
        "invalid/Malformed tag.mp3": b"ID3\x04\x00\x00\x7f\x7f\x7f\x7fM0 malformed tag",
    }
    for relative, content in invalid.items():
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        result = subprocess.run([str(encoder), "-nostdin", "-v", "error", "-xerror", "-i", str(destination), "-f", "null", "-"], capture_output=True)
        if result.returncode == 0:
            raise RuntimeError("Invalid fixture unexpectedly decoded: " + relative)
        manifest["files"].append({"path": relative, "valid": False, "hostDecode": "EXPECTED FAILURE",
                                  "indexing": "Android may omit this invalid file; do not assume discovery",
                                  "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
    manifest["runtimeScenarios"] = ["revoke permission", "delete or replace disposable fixture after queue capture",
        "provider epoch/row identity change", "inject unknown duration through contract test (no valid-file guarantee)",
        "oversized metadata must be bounded by discovery adapter; expand adversarial fixtures during native validation"]
    (output.parent / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Verified {len(cases)} valid and {len(invalid)} deliberately invalid fixtures.", flush=True)


if __name__ == "__main__":
    main()
