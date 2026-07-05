# -*- coding: utf-8 -*-
"""
混音引擎 - 使用 numpy 实现多轨混音
"""
import os
import wave
import numpy as np
from typing import List, Optional, Callable
from dataclasses import dataclass


@dataclass
class TrackConfig:
    """单个音轨的混音配置。"""
    file_path: str
    volume: float = 1.0  # 0.0 - 1.5
    pan: float = 0.0     # -1.0 (左) 到 1.0 (右)
    muted: bool = False
    solo: bool = False


class MixerEngine:
    """混音引擎 - 将多音轨混音为输出文件。"""

    def _read_wav(self, file_path: str) -> tuple:
        """读取 WAV 返回 (samples_float, sr, n_channels)。"""
        with wave.open(file_path, "r") as wf:
            sr = wf.getframerate()
            n_frames = wf.getnframes()
            n_channels = wf.getnchannels()
            frames = wf.readframes(n_frames)
            samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
            if n_channels > 1:
                samples = samples.reshape(-1, n_channels)
            else:
                samples = samples.reshape(-1, 1)
            return samples / 32768.0, sr, n_channels

    def _write_wav(self, samples: np.ndarray, sr: int, output_path: str, n_channels: int = 2):
        """写入 WAV。"""
        if samples.ndim == 1:
            samples = samples.reshape(-1, 1)
        if samples.shape[1] != n_channels:
            # 扩展通道
            if samples.shape[1] == 1 and n_channels == 2:
                samples = np.repeat(samples, 2, axis=1)
        samples_int = np.clip(samples * 32767, -32767, 32767).astype(np.int16)
        with wave.open(output_path, "w") as wf:
            wf.setnchannels(samples_int.shape[1])
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(samples_int.tobytes())

    def mix(
        self,
        tracks: List[TrackConfig],
        output_path: str,
        sample_rate: int = 44100,
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> bool:
        """混音并导出音频文件。"""
        if progress_callback:
            progress_callback(0, "正在混音...")

        active_tracks = [t for t in tracks if not t.muted]
        if not active_tracks:
            self._write_wav(np.zeros((44100 * 5, 2)), sample_rate, output_path)
            if progress_callback:
                progress_callback(100, "混音完成（无音轨）")
            return True

        try:
            mixed = None
            max_len = 0
            target_sr = sample_rate

            for track in active_tracks:
                if not os.path.exists(track.file_path):
                    print(f"Track not found: {track.file_path}")
                    continue

                samples, sr, n_ch = self._read_wav(track.file_path)

                # 重采样到目标采样率
                if sr != target_sr and len(samples) > 0:
                    from scipy import signal
                    ratio = target_sr / sr
                    new_len = int(len(samples) * ratio)
                    samples = signal.resample(samples, new_len, axis=0)

                # 应用音量
                vol = track.volume / 100.0 if track.volume > 1 else track.volume
                samples *= vol

                # 应用声像
                if track.pan < -50:
                    factor = 1 - abs(track.pan) / 200.0
                    samples *= factor
                elif track.pan > 50:
                    factor = 1 - track.pan / 200.0
                    samples *= factor

                # 确保立体声
                if samples.ndim == 1 or samples.shape[1] == 1:
                    samples = np.repeat(samples.reshape(-1, 1), 2, axis=1)

                max_len = max(max_len, len(samples))

                if mixed is None:
                    mixed = samples
                else:
                    # 对齐长度
                    if len(samples) > len(mixed):
                        mixed = np.pad(mixed, ((0, len(samples) - len(mixed)), (0, 0)))
                    elif len(samples) < len(mixed):
                        samples = np.pad(samples, ((0, len(mixed) - len(samples)), (0, 0)))
                    mixed += samples

            if mixed is None:
                self._write_wav(np.zeros((44100 * 5, 2)), sample_rate, output_path)
            else:
                # 归一化
                max_val = np.max(np.abs(mixed))
                if max_val > 1.0:
                    mixed /= max_val
                self._write_wav(mixed, sample_rate, output_path)

            if progress_callback:
                progress_callback(100, "混音完成")

            return True

        except Exception as e:
            print(f"Mix error: {e}")
            if active_tracks and os.path.exists(active_tracks[0].file_path):
                import shutil
                shutil.copy2(active_tracks[0].file_path, output_path)
            return True


# Singleton
mixer_engine = MixerEngine()
