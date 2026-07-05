"""Audio utility functions."""
import os
import subprocess
import tempfile
import json
from pathlib import Path
from typing import Optional, Tuple
import sys
# pylibs removed

def get_audio_info(file_path: str) -> dict:
    try:
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        info = {"duration": 0, "sample_rate": 0, "channels": 0,
                "bitrate": 0, "format": "", "size": 0}
        if "format" in data:
            fmt = data["format"]
            info["duration"] = float(fmt.get("duration", 0))
            info["bitrate"] = int(fmt.get("bit_rate", 0))
            info["format"] = fmt.get("format_name", "")
            info["size"] = int(fmt.get("size", 0))
        if "streams" in data:
            for stream in data["streams"]:
                if stream.get("codec_type") == "audio":
                    info["sample_rate"] = int(stream.get("sample_rate", 0))
                    info["channels"] = int(stream.get("channels", 0))
                    break
        return info
    except Exception as e:
        return {"error": str(e)}

def convert_to_wav(input_path: str, target_sr: int = 44100) -> Optional[str]:
    """Convert audio to WAV using miniaudio."""
    return _convert_to_wav_python(input_path, target_sr)

def _convert_to_wav_python(input_path: str, target_sr: int = 44100) -> Optional[str]:
    """Convert audio to WAV using miniaudio + numpy."""
    try:
        import miniaudio
        import numpy as np
        import shutil
        import wave as wv
        work_path = input_path
        safe_name = None
        if any(ord(c) > 127 for c in os.path.basename(input_path)):
            safe_name = "voicecraft_input_" + str(int(__import__("time").time())) + os.path.splitext(input_path)[1]
            work_path = os.path.join(tempfile.gettempdir(), safe_name)
            shutil.copy2(input_path, work_path)
        result = miniaudio.decode_file(work_path, output_format=miniaudio.SampleFormat.SIGNED16)
        sr = result.sample_rate
        nch = result.nchannels
        samples = np.frombuffer(result.samples, dtype=np.int16).astype(np.float64)
        if nch > 1:
            samples = samples.reshape(-1, nch).mean(axis=1)
        samples /= 32768.0
        if safe_name:
            try: os.unlink(work_path)
            except: pass
        if sr != target_sr:
            import scipy.signal
            target_len = int(len(samples) * target_sr / sr)
            samples = scipy.signal.resample(samples, target_len)
            sr = target_sr
        output_path = os.path.join(tempfile.gettempdir(), "voicecraft_" + os.path.basename(input_path) + ".wav")
        with wv.open(output_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(np.clip(samples * 32767, -32768, 32767).astype(np.int16).tobytes())
        return output_path
    except Exception as e:
        return None

def encode_audio(input_path: str, output_path: str,
                 fmt: str = "mp3", bitrate: int = 320) -> bool:
    try:
        cmd = ["ffmpeg", "-y", "-i", input_path]
        if fmt == "mp3":
            cmd.extend(["-acodec", "libmp3lame", "-b:a", f"{bitrate}k"])
        elif fmt == "flac":
            cmd.extend(["-acodec", "flac", "-compression_level", str(min(8, max(0, bitrate)))])
        elif fmt == "wav":
            bits = {16: "pcm_s16le", 24: "pcm_s24le", 32: "pcm_s32le"}
            codec = bits.get(bitrate, "pcm_s16le")
            cmd.extend(["-acodec", codec])
        cmd.append(output_path)
        subprocess.run(cmd, capture_output=True, check=True)
        return True
    except Exception:
        return False

def get_stem_display_name(stem_type: str) -> str:
    names = {
        "vocals": "Vocals", "accompaniment": "Accompaniment",
        "bass": "Bass", "drums": "Drums",
        "piano": "Piano", "guitar": "Guitar", "other": "Other",
    }
    return names.get(stem_type, stem_type)

SUPPORTED_EXTENSIONS = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"}

def validate_audio_file(file_path: str) -> Tuple[bool, str]:
    ext = Path(file_path).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return False, f"Unsupported format: {ext}"
    if not os.path.exists(file_path):
        return False, "File not found"
    size_mb = os.path.getsize(file_path) / (1024 * 1024)
    if size_mb > 200:
        return False, f"File too large ({size_mb:.0f}MB max 200MB)"
    return True, "ok"
