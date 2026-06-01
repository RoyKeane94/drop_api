#!/usr/bin/env python3
"""Convert input audio to 16 kHz mono WAV and apply stationary noise reduction."""

import subprocess
import sys
import tempfile
import os

import numpy as np
import noisereduce as nr
import soundfile as sf


def run_ffmpeg(args: list[str]) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", *args],
        check=True,
    )


def denoise(input_path: str, output_path: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        wav_in = os.path.join(tmp, "in.wav")
        run_ffmpeg(["-i", input_path, "-ar", "16000", "-ac", "1", wav_in])

        data, rate = sf.read(wav_in, dtype="float32")
        if data.ndim > 1:
            data = np.mean(data, axis=1)

        # Trim leading silence so the noise profile isn't mostly silence.
        threshold = 0.01
        speech_start = 0
        for i, sample in enumerate(data):
            if abs(sample) > threshold:
                speech_start = i
                break

        noise_end = min(len(data), speech_start + int(rate * 0.4))
        noise_clip = data[speech_start:noise_end]
        if len(noise_clip) < int(rate * 0.05):
            noise_clip = data[: int(rate * 0.3)]

        reduced = nr.reduce_noise(
            y=data,
            sr=rate,
            y_noise=noise_clip,
            prop_decrease=0.75,
            stationary=True,
        )

        sf.write(output_path, reduced, rate, subtype="PCM_16")


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: denoise_audio.py <input> <output.wav>", file=sys.stderr)
        return 1

    input_path, output_path = sys.argv[1], sys.argv[2]
    if not os.path.isfile(input_path):
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    try:
        denoise(input_path, output_path)
    except subprocess.CalledProcessError as exc:
        print(f"ffmpeg failed: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 — surface any denoise failure to Node
        print(f"denoise failed: {exc}", file=sys.stderr)
        return 3

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
